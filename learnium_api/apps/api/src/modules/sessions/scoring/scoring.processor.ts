import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import OpenAI from 'openai';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../core/database/prisma.service';
import { SCORE_SESSION_QUEUE } from '../sessions.service';
import type { Env } from '../../../core/config/env.schema';

interface ScoreJobData {
  sessionId: number;
  uid: string;
}

interface CriterionScore {
  criterionId: number;
  score: number;
  feedback: string;
}

interface ScoringResponse {
  scores: CriterionScore[];
  overallFeedback: string;
}

@Processor(SCORE_SESSION_QUEUE)
export class ScoringProcessor extends WorkerHost {
  private readonly openai: OpenAI;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {
    super();
    this.openai = new OpenAI({
      baseURL: config.get('LITELLM_BASE_URL', { infer: true }),
      apiKey: config.get('LITELLM_API_KEY', { infer: true }),
    });
  }

  override async process(job: Job<ScoreJobData>): Promise<void> {
    const { sessionId } = job.data;

    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
        persona: { include: { scoreCriteria: { orderBy: { order: 'asc' } } } },
      },
    });

    if (!session) return;

    const criteria = session.persona.scoreCriteria;
    if (criteria.length === 0) return;

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
    } catch {
      // LLM unavailable — store zero scores with fallback feedback
    }

    const scoreRows = criteria.map((c) => {
      const match = scoringResult?.scores.find((s) => s.criterionId === c.id);
      return {
        sessionId,
        criterionId: c.id,
        score: match?.score ?? null,
        maxScore: c.maxScore,
        feedback: match?.feedback ?? (scoringResult ? null : 'Scoring unavailable — LLM unreachable'),
      };
    });

    await this.prisma.$transaction([
      this.prisma.scoreResult.createMany({ data: scoreRows }),
      this.prisma.session.update({
        where: { id: sessionId },
        data: { feedback: scoringResult?.overallFeedback ?? null },
      }),
    ]);
  }
}
