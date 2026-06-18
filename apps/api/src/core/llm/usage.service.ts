import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

export type UsageKind = 'chat' | 'scoring';

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface RecordUsageInput {
  kind: UsageKind;
  modelId?: number | null;
  modelName: string;
  providerType?: string | null;
  sessionId?: number | null;
  userId?: number | null;
  inputTokens: number;
  outputTokens: number;
  estimated: boolean;
  latencyMs?: number;
}

// Rough fallback when the provider returns no usage_metadata (~4 chars/token).
const CHARS_PER_TOKEN = 4;

@Injectable()
export class UsageService {
  private readonly logger = new Logger(UsageService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Pull token counts off a LangChain message's usage_metadata, if present. */
  extractUsage(message: unknown): TokenUsage | null {
    const meta = (
      message as {
        usage_metadata?: { input_tokens?: number; output_tokens?: number };
      } | null
    )?.usage_metadata;
    if (!meta) return null;
    return {
      inputTokens: meta.input_tokens ?? 0,
      outputTokens: meta.output_tokens ?? 0,
    };
  }

  estimateTokens(text: string): number {
    return Math.ceil((text?.length ?? 0) / CHARS_PER_TOKEN);
  }

  /** Persist one usage row. Never throws — telemetry must not break a turn. */
  async record(input: RecordUsageInput): Promise<void> {
    try {
      const costUsd = await this.computeCost(
        input.modelId,
        input.inputTokens,
        input.outputTokens,
      );
      await this.prisma.llmUsage.create({
        data: {
          kind: input.kind,
          modelId: input.modelId ?? null,
          modelName: input.modelName,
          providerType: input.providerType ?? null,
          sessionId: input.sessionId ?? null,
          userId: input.userId ?? null,
          inputTokens: input.inputTokens,
          outputTokens: input.outputTokens,
          totalTokens: input.inputTokens + input.outputTokens,
          costUsd,
          estimated: input.estimated,
          latencyMs: input.latencyMs ?? null,
        },
      });
    } catch (err) {
      this.logger.warn({ err }, 'Failed to record LLM usage');
    }
  }

  private async computeCost(
    modelId: number | null | undefined,
    inputTokens: number,
    outputTokens: number,
  ): Promise<number> {
    if (!modelId) return 0;
    const model = await this.prisma.llmModel.findUnique({
      where: { id: modelId },
      select: { inputPricePerMillion: true, outputPricePerMillion: true },
    });
    if (!model) return 0;
    const inCost = ((model.inputPricePerMillion ?? 0) * inputTokens) / 1_000_000;
    const outCost =
      ((model.outputPricePerMillion ?? 0) * outputTokens) / 1_000_000;
    return Number((inCost + outCost).toFixed(6));
  }

  /** Aggregate totals + per-model breakdown + recent rows over the last N days. */
  async summary(query: { days?: number; limit?: number }) {
    const days = query.days ?? 30;
    const limit = query.limit ?? 50;
    const since = new Date(Date.now() - days * 86_400_000);
    const where = { createdAt: { gte: since } };

    const [agg, byModel, recent] = await Promise.all([
      this.prisma.llmUsage.aggregate({
        where,
        _sum: { totalTokens: true, costUsd: true },
        _count: true,
      }),
      this.prisma.llmUsage.groupBy({
        by: ['modelName'],
        where,
        _sum: { totalTokens: true, costUsd: true },
        _count: true,
        orderBy: { _sum: { costUsd: 'desc' } },
      }),
      this.prisma.llmUsage.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
    ]);

    return {
      since: since.toISOString(),
      totals: {
        calls: agg._count,
        totalTokens: agg._sum.totalTokens ?? 0,
        costUsd: Number((agg._sum.costUsd ?? 0).toFixed(4)),
      },
      byModel: byModel.map((r) => ({
        modelName: r.modelName,
        calls: r._count,
        totalTokens: r._sum.totalTokens ?? 0,
        costUsd: Number((r._sum.costUsd ?? 0).toFixed(4)),
      })),
      recent,
    };
  }
}
