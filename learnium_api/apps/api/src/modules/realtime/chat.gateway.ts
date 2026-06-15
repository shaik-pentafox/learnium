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
import type OpenAI from 'openai';
import { PrismaService } from '../../core/database/prisma.service';
import { REDIS_CLIENT } from '../../core/redis/redis.module';
import { LlmClientService } from '../../core/llm/llm-client.service';
import { ScoringService } from '../../core/llm/scoring.service';
import { SessionRegistry } from './session-registry';

@WebSocketGateway({ path: '/api/v1/realtime/chat' })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() readonly server: Server;

  private readonly logger = new Logger(ChatGateway.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: SessionRegistry,
    private readonly llm: LlmClientService,
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

    const modelName = await this.resolveModel(session.persona.conversationModelId);
    if (!modelName) {
      this.close(client, 4503, 'No LLM model configured. Admin must register a model via /llm/models.');
      return;
    }

    const wsClient = this.registry.add(client, userId);
    this.registry.attachSession(
      wsClient,
      session.id,
      session.uid,
      session.persona.systemPrompt,
      session.persona.name,
      modelName,
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
    if (!wsClient?.sessionDbId || wsClient.systemPrompt === undefined) {
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

    const history = await this.prisma.chatMessage.findMany({
      where: { sessionId: wsClient.sessionDbId },
      orderBy: { createdAt: 'asc' },
      select: { role: true, content: true },
    });

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: wsClient.systemPrompt ?? '' },
      ...history.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    ];

    let fullContent = '';
    try {
      for await (const chunk of this.llm.stream(messages, wsClient.modelName!)) {
        if (!chunk.done) {
          fullContent += chunk.delta;
          this.send(client, { type: 'token', delta: chunk.delta });
        }
      }
    } catch (err) {
      this.logger.error({ err }, 'LLM stream error');
      this.sendError(client, 'PROVIDER_ERROR', 'LLM unavailable');
      return;
    }

    const saved = await this.prisma.chatMessage.create({
      data: { sessionId: wsClient.sessionDbId, role: 'assistant', content: fullContent },
    });

    this.send(client, {
      type: 'message_done',
      messageId: String(saved.id),
      emotion: null,
      emoji: null,
    });
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

    const { scores, feedback } = await this.scoringService.scoreSession(wsClient.sessionDbId);

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

  private async resolveModel(modelId: number | null): Promise<string | null> {
    if (modelId) {
      const m = await this.prisma.llmModel.findUnique({ where: { id: modelId } });
      if (m) return m.name;
    }
    const def = await this.prisma.llmModel.findFirst({ where: { isDefault: true } });
    return def?.name ?? null;
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
