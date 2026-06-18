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
import {
  PersonaTemplateSchema,
  renderSystemPrompt,
} from '../../core/llm/persona-prompt.template';
import { ScoringService } from '../../core/llm/scoring.service';
import { UsageService } from '../../core/llm/usage.service';
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
    private readonly usage: UsageService,
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
            color: true,
            templateData: true,
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

    // Render the live system prompt from the structured template each session, so
    // master-template improvements reach every persona (cache is the fallback).
    const systemPrompt = this.resolveSystemPrompt(session.persona);

    // Build the per-session roleplay graph: registry model (+ fallbacks) + system
    // prompt, durable state via the shared PostgresSaver (thread_id = session uid).
    let graph;
    let resolvedModelId: number | undefined;
    let resolvedModelName: string | undefined;
    try {
      const resolved = await this.models.resolve(session.persona.conversationModelId);
      resolvedModelId = resolved.id;
      resolvedModelName = resolved.name;
      this.logger.debug(
        `Resolved model "${resolved.name}" for session ${sessionUid} (persona ${session.persona.name})`,
      );
      graph = buildRoleplayGraph(
        resolved.chat,
        systemPrompt,
        this.checkpointer.saver,
      );
    } catch (err) {
      this.logger.warn({ err }, `Model resolve failed for session ${sessionUid}`);
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
    wsClient.modelId = resolvedModelId;
    wsClient.modelName = resolvedModelName;

    this.send(client, {
      type: 'joined',
      sessionId: session.uid,
      personaName: session.persona.name,
      personaColor: session.persona.color ?? null,
      systemPrompt,
    });

    client.on('message', (raw: RawData) => void this.onMessage(client, raw));
  }

  handleDisconnect(client: WebSocket): void {
    this.registry.remove(client);
  }

  /** Live system prompt for a session: render from the persona's structured
   *  template (so master-template changes propagate), falling back to the stored
   *  rendered cache if `templateData` is missing or malformed (legacy personas). */
  private resolveSystemPrompt(persona: {
    systemPrompt: string;
    templateData: unknown;
  }): string {
    const parsed = PersonaTemplateSchema.safeParse(persona.templateData);
    return parsed.success ? renderSystemPrompt(parsed.data) : persona.systemPrompt;
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

    this.logger.debug(
      `Turn received (${content.length} chars) for session ${wsClient.sessionUid}`,
    );

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

    const startedAt = Date.now();
    let providerUsage: { inputTokens: number; outputTokens: number } | null = null;

    try {
      const stream = (await wsClient.graph.stream(
        { messages: [new HumanMessage(content)] },
        { configurable: { thread_id: wsClient.sessionUid }, streamMode: 'messages' },
      )) as AsyncIterable<[AIMessageChunk, unknown]>;

      for await (const [chunk] of stream) {
        // Providers emit usage_metadata once (usually on the final chunk).
        const u = this.usage.extractUsage(chunk);
        if (u) providerUsage = u;
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

    this.logger.debug(
      `Turn streamed ${fullContent.length} chars for session ${wsClient.sessionUid}${ended ? ' (ended)' : ''}`,
    );

    // Telemetry: real provider usage when available, else a char-based estimate
    // (this turn's input only; prior context isn't counted in the estimate).
    void this.usage.record({
      kind: 'chat',
      modelId: wsClient.modelId ?? null,
      modelName: wsClient.modelName ?? 'unknown',
      sessionId: wsClient.sessionDbId,
      userId: wsClient.userId,
      inputTokens: providerUsage?.inputTokens ?? this.usage.estimateTokens(content),
      outputTokens: providerUsage?.outputTokens ?? this.usage.estimateTokens(fullContent),
      estimated: providerUsage === null,
      latencyMs: Date.now() - startedAt,
    });

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

    // Scoring must never strand the client: if it throws, still send
    // session_ended (empty) so the UI leaves the "ending…" state.
    let scores: unknown[] = [];
    let feedback: string | null = null;
    try {
      const result = await this.scoringService.scoreSession(wsClient.sessionDbId);
      scores = result.scores;
      feedback = result.feedback;
      this.logger.debug(
        `Scored session ${wsClient.sessionUid}: ${result.scores.length} criteria`,
      );
    } catch (err) {
      this.logger.error({ err }, `Scoring failed for session ${wsClient.sessionUid}`);
    }

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
    // Handshake rejections are otherwise invisible server-side — log why.
    this.logger.warn(`WS connection rejected (${code}): ${reason}`);
    client.close(code, reason);
  }
}
