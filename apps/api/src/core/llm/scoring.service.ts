import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { HumanMessage } from '@langchain/core/messages';
import { PrismaService } from '../database/prisma.service';
import { ModelFactoryService } from './model-factory.service';
import { UsageService } from './usage.service';

export interface ScoreRow {
  criterionId: number;
  name: string;
  score: number | null;
  maxScore: number;
  feedback: string | null;
}

export interface ScoringResult {
  scores: ScoreRow[];
  feedback: string | null;
}

const ScoringSchema = z.object({
  scores: z.array(
    z.object({
      criterionId: z.number(),
      score: z.number(),
      feedback: z.string(),
    }),
  ),
  overallFeedback: z.string(),
});

type LlmScoringResponse = z.infer<typeof ScoringSchema>;

@Injectable()
export class ScoringService {
  private readonly logger = new Logger(ScoringService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly models: ModelFactoryService,
    private readonly usage: UsageService,
  ) {}

  async scoreSession(sessionId: number): Promise<ScoringResult> {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
        persona: { include: { scoreCriteria: { orderBy: { order: 'asc' } } } },
      },
    });

    if (!session) return { scores: [], feedback: null };

    const criteria = session.persona.scoreCriteria;
    if (criteria.length === 0) return { scores: [], feedback: null };

    const transcript = session.messages
      .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
      .join('\n');

    const criteriaText = criteria
      .map(
        (c, i) =>
          `${i + 1}. [criterionId ${c.id}] ${c.name} (max ${c.maxScore}): ${c.description ?? ''}`,
      )
      .join('\n');

    const prompt = `You are a training evaluator. Score the trainee based on the chat transcript and rubric.

TRANSCRIPT:
${transcript || '(no messages recorded)'}

SCORING RUBRIC:
${criteriaText}

Return one score object per rubric criterion (use the exact criterionId shown), each with a 0-to-max integer score and a one-sentence feedback, plus a 2-3 sentence overall feedback.`;

    const llmResult = await this.runScoring(
      session.persona.scoringModelId,
      prompt,
      sessionId,
    );

    const scoreRows: ScoreRow[] = criteria.map((c) => {
      const match = llmResult?.scores.find((s) => s.criterionId === c.id);
      return {
        criterionId: c.id,
        name: c.name,
        score: match?.score ?? null,
        maxScore: c.maxScore,
        feedback:
          match?.feedback ??
          (llmResult ? null : 'Scoring unavailable — LLM unreachable'),
      };
    });

    await this.prisma.$transaction([
      // `name` is display-only — ScoreResult has no name column, so strip it here.
      this.prisma.scoreResult.createMany({
        data: scoreRows.map(({ name: _name, ...r }) => ({ ...r, sessionId })),
      }),
      this.prisma.session.update({
        where: { id: sessionId },
        data: { feedback: llmResult?.overallFeedback ?? null },
      }),
    ]);

    return { scores: scoreRows, feedback: llmResult?.overallFeedback ?? null };
  }

  /**
   * Prefer provider-native structured output; fall back to fenced-JSON parsing so
   * scoring still works on OpenAI-compatible endpoints that lack tool/JSON-schema
   * support (vLLM, some OpenRouter models, Ollama).
   */
  private async runScoring(
    scoringModelId: number | null,
    prompt: string,
    sessionId: number,
  ): Promise<LlmScoringResponse | null> {
    let resolved;
    try {
      resolved = await this.models.resolve(scoringModelId);
    } catch (err) {
      this.logger.error({ err }, 'No scoring model available');
      return null;
    }

    const startedAt = Date.now();
    // Structured output hides the raw message (no usage_metadata), so scoring
    // tokens are estimated from prompt + serialized result.
    const recordUsage = (outputText: string): void => {
      void this.usage.record({
        kind: 'scoring',
        modelId: resolved.id,
        modelName: resolved.name,
        sessionId,
        inputTokens: this.usage.estimateTokens(prompt),
        outputTokens: this.usage.estimateTokens(outputText),
        estimated: true,
        latencyMs: Date.now() - startedAt,
      });
    };

    try {
      const structured = resolved.model.withStructuredOutput(ScoringSchema, {
        name: 'scoring',
      });
      const result = (await structured.invoke([
        new HumanMessage(prompt),
      ])) as LlmScoringResponse;
      recordUsage(JSON.stringify(result));
      return result;
    } catch (err) {
      this.logger.warn(
        { err },
        'Structured scoring failed — falling back to JSON parse',
      );
    }

    try {
      const resp = await resolved.model.invoke([
        new HumanMessage(
          `${prompt}\n\nReturn ONLY valid JSON: {"scores":[{"criterionId":<id>,"score":<n>,"feedback":"<s>"}],"overallFeedback":"<s>"}`,
        ),
      ]);
      const text =
        typeof resp.content === 'string'
          ? resp.content
          : JSON.stringify(resp.content);
      recordUsage(text);
      const cleaned = text
        .replace(/^```(?:json)?/i, '')
        .replace(/```$/, '')
        .trim();
      return ScoringSchema.parse(JSON.parse(cleaned));
    } catch (err) {
      this.logger.error({ err }, 'Scoring fallback JSON parse failed');
      return null;
    }
  }
}
