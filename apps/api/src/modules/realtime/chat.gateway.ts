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
  BEGIN_CUE,
} from '../../core/llm/persona-prompt.template';
import { ScoringService } from '../../core/llm/scoring.service';
import { UsageService } from '../../core/llm/usage.service';
import { LlmFlowLogger, previewText } from '../../core/llm/llm-flow.logger';
import { SessionRegistry, type WsClient } from './session-registry';

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
    private readonly flowLog: LlmFlowLogger,
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

    const sessionSpan = this.flowLog.start('roleplay_session', {
      sessionUid,
      sessionDbId: session.id,
      userId,
      personaId: session.persona.id,
      personaName: session.persona.name,
      conversationModelId: session.persona.conversationModelId,
      systemPromptChars: systemPrompt.length,
    });

    // Build the per-session roleplay graph: registry model (+ fallbacks) + system
    // prompt, durable state via the shared PostgresSaver (thread_id = session uid).
    let graph;
    let resolvedModelId: number | undefined;
    let resolvedModelName: string | undefined;
    let resolvedProviderType: string | undefined;
    try {
      const resolved = await this.models.resolve(session.persona.conversationModelId);
      resolvedModelId = resolved.id;
      resolvedModelName = resolved.name;
      resolvedProviderType = resolved.providerType;
      graph = buildRoleplayGraph(
        resolved.chat,
        systemPrompt,
        this.checkpointer.saver,
        {
          onBeforeInvoke: (ctx) => {
            this.flowLog.step('roleplay_invoke', 'graph_node_enter', {
              sessionUid,
              threadId: sessionUid,
              modelId: resolvedModelId,
              modelName: resolvedModelName,
              ...ctx,
            });
          },
          onAfterInvoke: (ctx) => {
            this.flowLog.step('roleplay_invoke', 'graph_node_exit', {
              sessionUid,
              modelId: resolvedModelId,
              modelName: resolvedModelName,
              ...ctx,
            });
          },
        },
      );
      sessionSpan.complete({
        modelId: resolvedModelId,
        modelName: resolvedModelName,
      });
    } catch (err) {
      sessionSpan.fail(err);
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
    wsClient.providerType = resolvedProviderType;
    wsClient.lastTurnAt = Date.now();

    // hasStarted lets the client show the start-confirm dialog only on a genuine
    // first join — never again after a reconnect, where messages already exist.
    const messageCount = await this.prisma.chatMessage.count({
      where: { sessionId: session.id },
    });

    this.send(client, {
      type: 'joined',
      sessionId: session.uid,
      personaName: session.persona.name,
      personaColor: session.persona.color ?? null,
      systemPrompt,
      hasStarted: messageCount > 0,
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

    await this.runAssistantTurn(client, wsClient, content, { persistUser: true });
  }

  /** Customer opens the conversation. Feeds the internal BEGIN cue (never stored
   *  as a visible message) so the persona sends the first line in character.
   *  Idempotent: ignored once the session already has any messages, so reconnects
   *  or duplicate begins never produce a second opener. */
  private async handleBegin(client: WebSocket): Promise<void> {
    const wsClient = this.registry.get(client);
    if (!wsClient?.sessionDbId || !wsClient.sessionUid || !wsClient.graph) {
      this.sendError(client, 'NOT_JOINED', 'No active session');
      return;
    }
    const existing = await this.prisma.chatMessage.count({
      where: { sessionId: wsClient.sessionDbId },
    });
    if (existing > 0) return;
    await this.runAssistantTurn(client, wsClient, BEGIN_CUE, { persistUser: false });
  }

  /** Run one assistant (customer) turn: optionally persist the human input, then
   *  stream the persona reply, record telemetry, persist it, and end the session
   *  if the persona emits the resolution sentinel. */
  private async runAssistantTurn(
    client: WebSocket,
    wsClient: WsClient,
    content: string,
    opts: { persistUser: boolean },
  ): Promise<void> {
    const turnSpan = this.flowLog.start('roleplay_turn', {
      sessionUid: wsClient.sessionUid,
      sessionDbId: wsClient.sessionDbId,
      userId: wsClient.userId,
      modelId: wsClient.modelId,
      modelName: wsClient.modelName,
      inputChars: content.length,
      inputPreview: previewText(content),
    });

    if (opts.persistUser) {
      // Trainee response/think time: gap since the persona's last message.
      const responseMs = wsClient.lastTurnAt ? Date.now() - wsClient.lastTurnAt : null;
      await this.prisma.chatMessage.create({
        data: {
          sessionId: wsClient.sessionDbId!,
          role: 'user',
          content,
          latencyMs: responseMs,
        },
      });
      wsClient.lastTurnAt = Date.now();
    }

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
    let chunkCount = 0;

    try {
      this.flowLog.step('roleplay_turn', 'graph_stream_start', {
        sessionUid: wsClient.sessionUid,
        threadId: wsClient.sessionUid,
      });

      const stream = (await wsClient.graph!.stream(
        { messages: [new HumanMessage(content)] },
        { configurable: { thread_id: wsClient.sessionUid }, streamMode: 'messages' },
      )) as AsyncIterable<[AIMessageChunk, unknown]>;

      for await (const [chunk] of stream) {
        chunkCount++;
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
      turnSpan.fail(err, { chunkCount });
      this.logger.error({ err }, 'LLM stream error');
      this.sendError(client, 'PROVIDER_ERROR', 'LLM unavailable');
      return;
    }

    if (buffer.includes(END_SENTINEL)) {
      ended = true;
      buffer = buffer.replace(END_SENTINEL, '');
    }
    emit(buffer);

    turnSpan.complete({
      outputChars: fullContent.length,
      outputPreview: previewText(fullContent),
      chunkCount,
      conversationEnded: ended,
      inputTokens: providerUsage?.inputTokens ?? this.usage.estimateTokens(content),
      outputTokens: providerUsage?.outputTokens ?? this.usage.estimateTokens(fullContent),
      usageEstimated: providerUsage === null,
      latencyMs: Date.now() - startedAt,
    });

    // Telemetry: real provider usage when available, else a char-based estimate
    // (this turn's input only; prior context isn't counted in the estimate).
    void this.usage.record({
      kind: 'chat',
      modelId: wsClient.modelId ?? null,
      modelName: wsClient.modelName ?? 'unknown',
      providerType: wsClient.providerType ?? null,
      sessionId: wsClient.sessionDbId!,
      userId: wsClient.userId,
      inputTokens: providerUsage?.inputTokens ?? this.usage.estimateTokens(content),
      outputTokens: providerUsage?.outputTokens ?? this.usage.estimateTokens(fullContent),
      estimated: providerUsage === null,
      latencyMs: Date.now() - startedAt,
    });

    const saved = await this.prisma.chatMessage.create({
      data: {
        sessionId: wsClient.sessionDbId!,
        role: 'assistant',
        content: fullContent.trim(),
        latencyMs: Date.now() - startedAt,
      },
    });
    wsClient.lastTurnAt = Date.now();

    this.send(client, {
      type: 'message_done',
      messageId: String(saved.id),
      emotion: null,
      emoji: null,
    });

    // Persona signalled the roleplay is complete → run end-of-session scoring.
    if (ended) {
      this.flowLog.step('roleplay_turn', 'conversation_ended_sentinel', {
        sessionUid: wsClient.sessionUid,
      });
      await this.endSession(client);
    }
  }

  private async handleControl(
    client: WebSocket,
    frame: Record<string, unknown>,
  ): Promise<void> {
    if (frame['action'] === 'begin') {
      await this.handleBegin(client);
    } else if (frame['action'] === 'end') {
      await this.endSession(client);
    }
  }

  private async endSession(client: WebSocket): Promise<void> {
    const wsClient = this.registry.get(client);
    if (!wsClient?.sessionUid || !wsClient.sessionDbId) return;

    this.send(client, { type: 'session_ending' });

    this.flowLog.step('scoring', 'session_end_triggered', {
      sessionUid: wsClient.sessionUid,
      sessionDbId: wsClient.sessionDbId,
    });

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
