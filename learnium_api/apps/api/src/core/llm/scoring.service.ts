import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { LlmClientService } from './llm-client.service';

export interface ScoreRow {
  criterionId: number;
  score: number | null;
  maxScore: number;
  feedback: string | null;
}

export interface ScoringResult {
  scores: ScoreRow[];
  feedback: string | null;
}

interface CriterionScore {
  criterionId: number;
  score: number;
  feedback: string;
}

interface LlmScoringResponse {
  scores: CriterionScore[];
  overallFeedback: string;
}

@Injectable()
export class ScoringService {
  private readonly logger = new Logger(ScoringService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmClientService,
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

    let llmResult: LlmScoringResponse | null = null;

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

      const raw = await this.llm.complete([{ role: 'user', content: prompt }]);
      llmResult = JSON.parse(raw) as LlmScoringResponse;
    } catch (err) {
      this.logger.error({ err }, 'Scoring LLM call failed');
    }

    const scoreRows: ScoreRow[] = criteria.map((c) => {
      const match = llmResult?.scores.find((s) => s.criterionId === c.id);
      return {
        criterionId: c.id,
        score: match?.score ?? null,
        maxScore: c.maxScore,
        feedback: match?.feedback ?? (llmResult ? null : 'Scoring unavailable — LLM unreachable'),
      };
    });

    await this.prisma.$transaction([
      this.prisma.scoreResult.createMany({
        data: scoreRows.map((r) => ({ ...r, sessionId })),
      }),
      this.prisma.session.update({
        where: { id: sessionId },
        data: { feedback: llmResult?.overallFeedback ?? null },
      }),
    ]);

    return { scores: scoreRows, feedback: llmResult?.overallFeedback ?? null };
  }
}
