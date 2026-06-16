import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Inject, Logger } from '@nestjs/common';
import { Server, WebSocket } from 'ws';
import type { RawData } from 'ws';
import type { IncomingMessage } from 'node:http';
import type Redis from 'ioredis';
import { HumanMessage, type AIMessageChunk } from '@langchain/core/messages';
import { PrismaService } from '../../core/database/prisma.service';
import { REDIS_CLIENT } from '../../core/redis/redis.module';
import { ModelFactoryService } from '../../core/llm/model-factory.service';
import { CheckpointerService } from '../../core/llm/checkpointer.service';
import { buildRoleplayGraph } from '../../core/llm/roleplay-graph';
import { ScoringService } from '../../core/llm/scoring.service';
import { SessionRegistry } from './session-registry';

const END_SENTINEL = '[CONVERSATION_ENDED]';

@WebSocketGateway({ path: '/api/v1/realtime/chat' })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() readonly server: Server;

  private readonly logger = new Logger(ChatGateway.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: SessionRegistry,
    private readonly models: ModelFactoryService,
    private readonly checkpointer: CheckpointerService,
    private readonly scoringService: ScoringService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async handleConnection(client: WebSocket, req: IncomingMessage): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const ticket = url.searchParams.get('ticket');
    const sessionUid = url.searchParams.get('sessionId');

    if (!ticket || !sessionUid) {
      this.close(client, 4400, 'Missing ticket or sessionId');
      return;
    }

    const userIdStr = await this.redis.getdel(`rt_ticket:${ticket}`);
    if (!userIdStr) {
      this.close(client, 4401, 'Invalid or expired ticket');
      return;
    }
    const userId = parseInt(userIdStr, 10);

    const session = await this.prisma.session.findUnique({
      where: { uid: sessionUid },
      include: {
        persona: {
          select: {
            id: true,
            name: true,
            systemPrompt: true,
            conversationModelId: true,
          },
        },
      },
    });

    if (!session || session.status !== 'ACTIVE') {
      this.close(client, 4404, 'Session not found or not active');
      return;
    }
    if (session.userId !== userId) {
      this.close(client, 4403, 'Forbidden');
      return;
    }

    // Build the per-session roleplay graph: registry model (+ fallbacks) + system
    // prompt, durable state via the shared PostgresSaver (thread_id = session uid).
    let graph;
    try {
      const resolved = await this.models.resolve(session.persona.conversationModelId);
      graph = buildRoleplayGraph(
        resolved.chat,
        session.persona.systemPrompt,
        this.checkpointer.saver,
      );
    } catch {
      this.close(
        client,
        4503,
        'No LLM model configured. Admin must register and promote a model via /llm.',
      );
      return;
    }

    const wsClient = this.registry.add(client, userId);
    this.registry.attachSession(
      wsClient,
      session.id,
      session.uid,
      session.persona.name,
      graph,
    );

    this.send(client, {
      type: 'joined',
      sessionId: session.uid,
      personaName: session.persona.name,
      systemPrompt: session.persona.systemPrompt,
    });

    client.on('message', (raw: RawData) => void this.onMessage(client, raw));
  }

  handleDisconnect(client: WebSocket): void {
    this.registry.remove(client);
  }

  private async onMessage(client: WebSocket, raw: RawData): Promise<void> {
    let frame: Record<string, unknown>;
    try {
      frame = JSON.parse(raw.toString()) as Record<string, unknown>;
    } catch {
      this.sendError(client, 'PARSE_ERROR', 'Invalid JSON');
      return;
    }

    switch (frame['type']) {
      case 'message':
        await this.handleTurn(client, frame);
        break;
      case 'control':
        await this.handleControl(client, frame);
        break;
      case 'resume':
        await this.handleResume(client, frame);
        break;
      case 'ping':
        this.send(client, { type: 'pong' });
        break;
      default:
        this.sendError(client, 'UNKNOWN_TYPE', `Unknown message type: ${String(frame['type'])}`);
    }
  }

  private async handleTurn(
    client: WebSocket,
    frame: Record<string, unknown>,
  ): Promise<void> {
    const wsClient = this.registry.get(client);
    if (!wsClient?.sessionDbId || !wsClient.sessionUid || !wsClient.graph) {
      this.sendError(client, 'NOT_JOINED', 'No active session');
      return;
    }

    const content = frame['content'];
    if (typeof content !== 'string' || !content.trim()) {
      this.sendError(client, 'INVALID_PAYLOAD', 'content required');
      return;
    }

    await this.prisma.chatMessage.create({
      data: { sessionId: wsClient.sessionDbId, role: 'user', content },
    });

    // The checkpointer (thread_id = session uid) carries prior turns, so we append
    // only the new message; tokens stream via streamMode "messages". We hold back a
    // short tail so the end sentinel is detected and stripped before it reaches the
    // client (it can split across chunks), never streamed as visible text.
    let fullContent = '';
    let ended = false;
    const hold = END_SENTINEL.length - 1;
    let buffer = '';
    const emit = (text: string): void => {
      if (!text) return;
      fullContent += text;
      this.send(client, { type: 'token', delta: text });
    };

    try {
      const stream = (await wsClient.graph.stream(
        { messages: [new HumanMessage(content)] },
        { configurable: { thread_id: wsClient.sessionUid }, streamMode: 'messages' },
      )) as AsyncIterable<[AIMessageChunk, unknown]>;

      for await (const [chunk] of stream) {
        const delta = typeof chunk.content === 'string' ? chunk.content : '';
        if (!delta) continue;
        buffer += delta;
        if (buffer.includes(END_SENTINEL)) {
          ended = true;
          buffer = buffer.replace(END_SENTINEL, '');
        }
        if (buffer.length > hold) {
          emit(buffer.slice(0, buffer.length - hold));
          buffer = buffer.slice(buffer.length - hold);
        }
      }
    } catch (err) {
      this.logger.error({ err }, 'LLM stream error');
      this.sendError(client, 'PROVIDER_ERROR', 'LLM unavailable');
      return;
    }

    if (buffer.includes(END_SENTINEL)) {
      ended = true;
      buffer = buffer.replace(END_SENTINEL, '');
    }
    emit(buffer);

    const saved = await this.prisma.chatMessage.create({
      data: { sessionId: wsClient.sessionDbId, role: 'assistant', content: fullContent.trim() },
    });

    this.send(client, {
      type: 'message_done',
      messageId: String(saved.id),
      emotion: null,
      emoji: null,
    });

    // Persona signalled the roleplay is complete → run end-of-session scoring.
    if (ended) await this.endSession(client);
  }

  private async handleControl(
    client: WebSocket,
    frame: Record<string, unknown>,
  ): Promise<void> {
    if (frame['action'] === 'end') {
      await this.endSession(client);
    }
  }

  private async endSession(client: WebSocket): Promise<void> {
    const wsClient = this.registry.get(client);
    if (!wsClient?.sessionUid || !wsClient.sessionDbId) return;

    this.send(client, { type: 'session_ending' });

    await this.prisma.session.update({
      where: { uid: wsClient.sessionUid },
      data: { status: 'COMPLETED', endedAt: new Date() },
    });

    const { scores, feedback } = await this.scoringService.scoreSession(
      wsClient.sessionDbId,
    );

    this.send(client, { type: 'session_ended', scores, feedback });
  }

  private async handleResume(
    client: WebSocket,
    frame: Record<string, unknown>,
  ): Promise<void> {
    const wsClient = this.registry.get(client);
    if (!wsClient?.sessionDbId) {
      this.sendError(client, 'NOT_JOINED', 'No active session');
      return;
    }

    const lastMessageId = frame['lastMessageId'];
    if (typeof lastMessageId !== 'string') {
      this.sendError(client, 'INVALID_PAYLOAD', 'lastMessageId required');
      return;
    }

    const lastId = parseInt(lastMessageId, 10);
    if (isNaN(lastId)) {
      this.sendError(client, 'INVALID_PAYLOAD', 'lastMessageId must be numeric string');
      return;
    }

    const missed = await this.prisma.chatMessage.findMany({
      where: { sessionId: wsClient.sessionDbId, role: 'assistant', id: { gt: lastId } },
      orderBy: { createdAt: 'asc' },
    });

    for (const msg of missed) {
      this.send(client, {
        type: 'message_done',
        messageId: String(msg.id),
        emotion: null,
        emoji: null,
      });
    }
  }

  private send(client: WebSocket, payload: unknown): void {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(payload));
    }
  }

  private sendError(client: WebSocket, code: string, message: string): void {
    this.send(client, { type: 'error', code, message });
  }

  private close(client: WebSocket, code: number, reason: string): void {
    client.close(code, reason);
  }
}
