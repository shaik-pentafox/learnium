import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Server, WebSocket } from 'ws';
import type { RawData } from 'ws';
import type { IncomingMessage } from 'node:http';
import OpenAI from 'openai';
import type Redis from 'ioredis';
import { PrismaService } from '../../core/database/prisma.service';
import { REDIS_CLIENT } from '../../core/redis/redis.module';
import { SessionRegistry } from './session-registry';
import type { Env } from '../../core/config/env.schema';

interface ScoreCriterion {
  id: number;
  name: string;
  description: string | null;
  maxScore: number;
}

interface ScoringResponse {
  scores: Array<{ criterionId: number; score: number; feedback: string }>;
  overallFeedback: string;
}

@WebSocketGateway({ path: '/api/v1/realtime/chat' })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() readonly server: Server;

  private readonly logger = new Logger(ChatGateway.name);
  private readonly openai: OpenAI;

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: SessionRegistry,
    private readonly config: ConfigService<Env, true>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    this.openai = new OpenAI({
      baseURL: config.get('LITELLM_BASE_URL', { infer: true }),
      apiKey: config.get('LITELLM_API_KEY', { infer: true }),
    });
  }

  async handleConnection(client: WebSocket, req: IncomingMessage): Promise<void> {
    const rawUrl = req.url ?? '/';
    const url = new URL(rawUrl, 'http://localhost');
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
            scoreCriteria: { orderBy: { order: 'asc' } },
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

    const wsClient = this.registry.add(client, userId);
    this.registry.attachSession(
      wsClient,
      session.id,
      session.uid,
      session.persona.systemPrompt,
      session.persona.name,
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
      const stream = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages,
        stream: true,
      });

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content ?? '';
        if (delta) {
          fullContent += delta;
          this.send(client, { type: 'token', delta });
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

    const session = await this.prisma.session.findUnique({
      where: { uid: wsClient.sessionUid },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
        persona: { include: { scoreCriteria: { orderBy: { order: 'asc' } } } },
      },
    });

    let scores: Array<{ criterionId: number; score: number | null; maxScore: number; feedback: string | null }> = [];
    let feedback: string | null = null;

    if (session) {
      const result = await this.runScoring(wsClient.sessionDbId, session);
      scores = result.scores;
      feedback = result.feedback;
    }

    this.send(client, { type: 'session_ended', scores, feedback });
  }

  private async runScoring(
    sessionId: number,
    session: {
      messages: Array<{ role: string; content: string }>;
      persona: { scoreCriteria: ScoreCriterion[] };
    },
  ): Promise<{
    scores: Array<{ criterionId: number; score: number | null; maxScore: number; feedback: string | null }>;
    feedback: string | null;
  }> {
    const criteria = session.persona.scoreCriteria;
    if (criteria.length === 0) return { scores: [], feedback: null };

    let scoringResult: ScoringResponse | null = null;

    try {
      const transcript = session.messages
        .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
        .join('\n');

      const criteriaText = criteria
        .map((c, i) => `${i + 1}. ${c.name} (max ${c.maxScore}): ${c.description ?? ''}`)
        .join('\n');

      const prompt = `You are a training evaluator. Score the trainee based on the chat transcript and rubric.

TRANSCRIPT:
${transcript || '(no messages recorded)'}

SCORING RUBRIC:
${criteriaText}

Return ONLY valid JSON in this exact format:
{
  "scores": [
    {"criterionId": <id>, "score": <0-max>, "feedback": "<one sentence>"}
  ],
  "overallFeedback": "<2-3 sentence summary>"
}`;

      const resp = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
      });

      const raw = resp.choices[0]?.message?.content ?? '{}';
      scoringResult = JSON.parse(raw) as ScoringResponse;
    } catch (err) {
      this.logger.error({ err }, 'Inline scoring error');
    }

    const scoreRows = criteria.map((c) => {
      const match = scoringResult?.scores.find((s) => s.criterionId === c.id);
      return {
        criterionId: c.id,
        score: match?.score ?? null,
        maxScore: c.maxScore,
        feedback: match?.feedback ?? (scoringResult ? null : 'Scoring unavailable — LLM unreachable'),
      };
    });

    await this.prisma.$transaction([
      this.prisma.scoreResult.createMany({
        data: scoreRows.map((r) => ({ ...r, sessionId })),
      }),
      this.prisma.session.update({
        where: { id: sessionId },
        data: { feedback: scoringResult?.overallFeedback ?? null },
      }),
    ]);

    return { scores: scoreRows, feedback: scoringResult?.overallFeedback ?? null };
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
