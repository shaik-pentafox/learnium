import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { HumanMessage } from '@langchain/core/messages';
import { PrismaService } from '../database/prisma.service';
import { ModelFactoryService } from './model-factory.service';
import { UsageService } from './usage.service';
import { LlmFlowLogger, previewText } from './llm-flow.logger';

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
    private readonly flowLog: LlmFlowLogger,
  ) {}

  async scoreSession(sessionId: number): Promise<ScoringResult> {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
        persona: { include: { scoreCriteria: { orderBy: { order: 'asc' } } } },
      },
    });

    if (!session) {
      this.flowLog.step('scoring', 'session_not_found', { sessionId });
      return { scores: [], feedback: null };
    }

    const criteria = session.persona.scoreCriteria;
    if (criteria.length === 0) {
      this.flowLog.step('scoring', 'no_criteria', {
        sessionId,
        sessionUid: session.uid,
        personaId: session.persona.id,
      });
      return { scores: [], feedback: null };
    }

    const transcript = session.messages
      .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
      .join('\n');

    const span = this.flowLog.start('scoring', {
      sessionId,
      sessionUid: session.uid,
      personaId: session.persona.id,
      scoringModelId: session.persona.scoringModelId,
      messageCount: session.messages.length,
      criteriaCount: criteria.length,
      transcriptChars: transcript.length,
      transcriptPreview: previewText(transcript),
    });

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

    span.complete({
      scoredCriteria: scoreRows.filter((r) => r.score !== null).length,
      totalCriteria: criteria.length,
      hasOverallFeedback: Boolean(llmResult?.overallFeedback),
      llmSucceeded: llmResult !== null,
    });

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
      this.flowLog.step('scoring', 'model_resolve_failed', { sessionId, scoringModelId });
      this.logger.error({ err }, 'No scoring model available');
      return null;
    }

    const startedAt = Date.now();
    // Structured output hides the raw message (no usage_metadata), so scoring
    // tokens are estimated from prompt + serialized result.
    const recordUsage = (outputText: string, path: 'structured' | 'json_fallback'): void => {
      this.flowLog.step('scoring', 'usage_recorded', {
        sessionId,
        modelId: resolved.id,
        modelName: resolved.name,
        path,
        promptChars: prompt.length,
        outputChars: outputText.length,
        latencyMs: Date.now() - startedAt,
      });
      void this.usage.record({
        kind: 'scoring',
        modelId: resolved.id,
        modelName: resolved.name,
        providerType: resolved.providerType,
        sessionId,
        inputTokens: this.usage.estimateTokens(prompt),
        outputTokens: this.usage.estimateTokens(outputText),
        estimated: true,
        latencyMs: Date.now() - startedAt,
      });
    };

    try {
      this.flowLog.step('scoring', 'structured_output_invoke', {
        sessionId,
        modelId: resolved.id,
        modelName: resolved.name,
        promptChars: prompt.length,
      });
      const structured = resolved.model.withStructuredOutput(ScoringSchema, {
        name: 'scoring',
      });
      const result = (await structured.invoke([
        new HumanMessage(prompt),
      ])) as LlmScoringResponse;
      recordUsage(JSON.stringify(result), 'structured');
      this.flowLog.step('scoring', 'structured_output_success', {
        sessionId,
        scoreCount: result.scores.length,
      });
      return result;
    } catch (err) {
      this.flowLog.step('scoring', 'structured_output_failed', { sessionId });
      this.logger.warn(
        { err },
        'Structured scoring failed — falling back to JSON parse',
      );
    }

    try {
      this.flowLog.step('scoring', 'json_fallback_invoke', {
        sessionId,
        modelId: resolved.id,
        modelName: resolved.name,
      });
      const resp = await resolved.model.invoke([
        new HumanMessage(
          `${prompt}\n\nReturn ONLY valid JSON: {"scores":[{"criterionId":<id>,"score":<n>,"feedback":"<s>"}],"overallFeedback":"<s>"}`,
        ),
      ]);
      const text =
        typeof resp.content === 'string'
          ? resp.content
          : JSON.stringify(resp.content);
      recordUsage(text, 'json_fallback');
      const cleaned = text
        .replace(/^```(?:json)?/i, '')
        .replace(/```$/, '')
        .trim();
      const parsed = ScoringSchema.parse(JSON.parse(cleaned));
      this.flowLog.step('scoring', 'json_fallback_success', {
        sessionId,
        scoreCount: parsed.scores.length,
      });
      return parsed;
    } catch (err) {
      this.flowLog.step('scoring', 'json_fallback_failed', { sessionId });
      this.logger.error({ err }, 'Scoring fallback JSON parse failed');
      return null;
    }
  }
}
