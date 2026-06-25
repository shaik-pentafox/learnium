import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** A bare YYYY-MM-DD means "through the end of that day" (inclusive), not its
 *  midnight start. Full ISO timestamps are used verbatim. */
function endOfDayIfDateOnly(value: string): Date {
  return DATE_ONLY.test(value)
    ? new Date(`${value}T23:59:59.999Z`)
    : new Date(value);
}

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
  async summary(query: {
    days?: number;
    limit?: number;
    from?: string;
    to?: string;
  }) {
    const limit = query.limit ?? 50;
    // Explicit from/to wins (date-range picker); otherwise a rolling window.
    // A date-only `to` (YYYY-MM-DD) parses to midnight, which would drop the
    // whole of that day — extend it to the end of the day so today's usage is
    // included (matches the inclusive range the picker implies).
    const until = query.to ? endOfDayIfDateOnly(query.to) : new Date();
    const since = query.from
      ? new Date(query.from)
      : new Date(until.getTime() - (query.days ?? 30) * 86_400_000);
    const where = { createdAt: { gte: since, lte: until } };

    const groupArgs = {
      where,
      _sum: { totalTokens: true, costUsd: true },
      _avg: { latencyMs: true },
      _count: true,
      orderBy: { _sum: { costUsd: 'desc' } },
    } as const;

    const [agg, byModel, byProvider, byKind, recent, series, seriesByModel, seriesByProvider] =
      await Promise.all([
        this.prisma.llmUsage.aggregate({
          where,
          _sum: { totalTokens: true, costUsd: true },
          _count: true,
        }),
        this.prisma.llmUsage.groupBy({ by: ['modelName'], ...groupArgs }),
        this.prisma.llmUsage.groupBy({ by: ['providerType'], ...groupArgs }),
        this.prisma.llmUsage.groupBy({ by: ['kind'], ...groupArgs }),
        this.prisma.llmUsage.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: limit,
        }),
        this.dailySeries(since, until),
        this.dailyByKey(since, until, 'modelName'),
        this.dailyByKey(since, until, 'providerType'),
      ]);

    const bucket = (label: string, r: { _count: number; _sum: { totalTokens: number | null; costUsd: number | null } }) => ({
      label,
      calls: r._count,
      totalTokens: r._sum.totalTokens ?? 0,
      costUsd: Number((r._sum.costUsd ?? 0).toFixed(4)),
    });

    return {
      since: since.toISOString(),
      until: until.toISOString(),
      totals: {
        calls: agg._count,
        totalTokens: agg._sum.totalTokens ?? 0,
        costUsd: Number((agg._sum.costUsd ?? 0).toFixed(4)),
      },
      byModel: byModel.map((r) => ({
        ...bucket(r.modelName, r),
        modelName: r.modelName,
        avgLatencyMs: r._avg.latencyMs != null ? Math.round(r._avg.latencyMs) : null,
      })),
      byProvider: byProvider.map((r) => bucket(r.providerType ?? 'unknown', r)),
      byKind: byKind.map((r) => bucket(r.kind, r)),
      series,
      seriesByModel,
      seriesByProvider,
      recent,
    };
  }

  /** Paginated, filterable recent-call log. `kinds`/`models` are OR-within /
   *  AND-across filters. `facets` lists every distinct kind/model available so
   *  the UI can populate its filter menus regardless of the active filter. */
  async calls(query: {
    page: number;
    limit: number;
    kind: string[];
    model: string[];
  }) {
    const where: Prisma.LlmUsageWhereInput = {
      ...(query.kind.length ? { kind: { in: query.kind } } : {}),
      ...(query.model.length ? { modelName: { in: query.model } } : {}),
    };
    const skip = (query.page - 1) * query.limit;

    const [rows, total, kinds, models] = await Promise.all([
      this.prisma.llmUsage.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: query.limit,
      }),
      this.prisma.llmUsage.count({ where }),
      this.prisma.llmUsage.groupBy({ by: ['kind'], orderBy: { kind: 'asc' } }),
      this.prisma.llmUsage.groupBy({
        by: ['modelName'],
        orderBy: { modelName: 'asc' },
      }),
    ]);

    return {
      rows,
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
      facets: {
        kinds: kinds.map((k) => k.kind),
        models: models.map((m) => m.modelName),
      },
    };
  }

  /** Daily totals split by a dimension column (modelName / providerType). Flat
   *  rows {date, key, …}; the client pivots to one area per key. Not gap-filled
   *  per key (the client fills against the overall day range). */
  private async dailyByKey(
    since: Date,
    until: Date,
    column: 'modelName' | 'providerType',
  ) {
    const col = Prisma.raw(`"${column}"`);
    const rows = await this.prisma.$queryRaw<
      { day: Date; key: string | null; calls: bigint; totalTokens: bigint | null; costUsd: number | null }[]
    >`
      SELECT date_trunc('day', "createdAt") AS day,
             ${col} AS key,
             COUNT(*)::int AS calls,
             COALESCE(SUM("totalTokens"), 0)::int AS "totalTokens",
             COALESCE(SUM("costUsd"), 0)::float8 AS "costUsd"
      FROM llm_usage
      WHERE "createdAt" >= ${since} AND "createdAt" <= ${until}
      GROUP BY day, key
      ORDER BY day ASC
    `;
    return rows.map((r) => ({
      date: new Date(r.day).toISOString().slice(0, 10),
      key: r.key ?? 'unknown',
      calls: Number(r.calls),
      totalTokens: Number(r.totalTokens ?? 0),
      costUsd: Number((r.costUsd ?? 0).toFixed(4)),
    }));
  }

  /** Per-day cost/token/call totals, gap-filled across [since, until] so the
   *  area chart gets a continuous x-axis even on days with no activity. */
  private async dailySeries(since: Date, until: Date) {
    const rows = await this.prisma.$queryRaw<
      { day: Date; calls: bigint; totalTokens: bigint | null; costUsd: number | null }[]
    >`
      SELECT date_trunc('day', "createdAt") AS day,
             COUNT(*)::int AS calls,
             COALESCE(SUM("totalTokens"), 0)::int AS "totalTokens",
             COALESCE(SUM("costUsd"), 0)::float8 AS "costUsd"
      FROM llm_usage
      WHERE "createdAt" >= ${since} AND "createdAt" <= ${until}
      GROUP BY day
      ORDER BY day ASC
    `;

    const byDay = new Map(
      rows.map((r) => [
        new Date(r.day).toISOString().slice(0, 10),
        {
          calls: Number(r.calls),
          totalTokens: Number(r.totalTokens ?? 0),
          costUsd: Number((r.costUsd ?? 0).toFixed(4)),
        },
      ]),
    );

    const out: {
      date: string;
      calls: number;
      totalTokens: number;
      costUsd: number;
    }[] = [];
    const cursor = new Date(since);
    cursor.setUTCHours(0, 0, 0, 0);
    const end = new Date(until);
    end.setUTCHours(0, 0, 0, 0);
    while (cursor <= end) {
      const key = cursor.toISOString().slice(0, 10);
      const hit = byDay.get(key);
      out.push({
        date: key,
        calls: hit?.calls ?? 0,
        totalTokens: hit?.totalTokens ?? 0,
        costUsd: hit?.costUsd ?? 0,
      });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return out;
  }
}
