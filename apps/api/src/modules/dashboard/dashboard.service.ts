import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { ForbiddenException } from '../../core/errors/domain.errors';

interface PageQuery {
  page: number;
  limit: number;
  q?: string;
  published?: boolean;
}

interface ScorePair {
  score: number | null;
  maxScore: number;
}

/** Pooled score percentage across scored criteria; null when nothing scored yet. */
function scorePct(scores: ScorePair[]): number | null {
  const scored = scores.filter((s) => s.score !== null);
  if (scored.length === 0) return null;
  const earned = scored.reduce((sum, s) => sum + (s.score ?? 0), 0);
  const max = scored.reduce((sum, s) => sum + s.maxScore, 0);
  return max > 0 ? Math.round((earned / max) * 100) : null;
}

const RECENT_LIMIT = 5;

interface Timing {
  /** Avg trainee response/think time (ms) — user performance. */
  avgResponseMs: number | null;
  /** Avg LLM generation time (ms) — model performance. */
  avgLlmLatencyMs: number | null;
}

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(actor: { sub: number; role: string }) {
    const [user, result] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: actor.sub },
        select: { firstName: true },
      }),
      this.roleSummary(actor),
    ]);
    return { firstName: user?.firstName ?? null, ...result };
  }

  /** Average per-message latency split by speaker over the matched sessions.
   *  `avgResponseMs` = trainee reply time (user perf); `avgLlmLatencyMs` = LLM
   *  generation time (model perf). Null latencies (legacy rows) are ignored. */
  private async timing(sessionWhere: Prisma.SessionWhereInput): Promise<Timing> {
    const base: Prisma.ChatMessageWhereInput = {
      session: sessionWhere,
      latencyMs: { not: null },
    };
    const [user, llm] = await Promise.all([
      this.prisma.chatMessage.aggregate({
        where: { ...base, role: 'user' },
        _avg: { latencyMs: true },
      }),
      this.prisma.chatMessage.aggregate({
        where: { ...base, role: 'assistant' },
        _avg: { latencyMs: true },
      }),
    ]);
    const round = (v: number | null) => (v == null ? null : Math.round(v));
    return {
      avgResponseMs: round(user._avg.latencyMs),
      avgLlmLatencyMs: round(llm._avg.latencyMs),
    };
  }

  private roleSummary(actor: { sub: number; role: string }) {
    switch (actor.role) {
      case 'TRAINER':
        return this.trainerSummary(actor.sub);
      case 'SUPER_ADMIN':
        return this.adminSummary();
      default:
        return this.traineeSummary(actor.sub);
    }
  }

  /** Trainee: own real (non-simulation) sessions, scores, recent activity. */
  private async traineeSummary(userId: number) {
    const [sessions, timing] = await Promise.all([
      this.prisma.session.findMany({
        where: { userId, isSimulation: false },
        select: {
          uid: true,
          status: true,
          startedAt: true,
          persona: { select: { id: true, name: true } },
          scores: { select: { score: true, maxScore: true } },
        },
        orderBy: { startedAt: 'desc' },
      }),
      this.timing({ userId, isSimulation: false }),
    ]);

    const completed = sessions.filter((s) => s.status === 'COMPLETED').length;
    const abandoned = sessions.filter((s) => s.status === 'ABANDONED').length;
    const perSessionPct = sessions
      .map((s) => scorePct(s.scores))
      .filter((v): v is number => v !== null);
    const avgScorePct = perSessionPct.length
      ? Math.round(perSessionPct.reduce((a, b) => a + b, 0) / perSessionPct.length)
      : null;
    const bestScorePct = perSessionPct.length ? Math.max(...perSessionPct) : null;

    // Own per-scenario practice + scores (most-practised first).
    const personaMap = new Map<
      number,
      { name: string; count: number; scores: ScorePair[] }
    >();
    for (const s of sessions) {
      const e =
        personaMap.get(s.persona.id) ?? { name: s.persona.name, count: 0, scores: [] };
      e.count += 1;
      e.scores.push(...s.scores);
      personaMap.set(s.persona.id, e);
    }
    const byPersona = [...personaMap.values()]
      .map((e) => ({
        personaName: e.name,
        sessions: e.count,
        avgScorePct: scorePct(e.scores),
      }))
      .sort((a, b) => b.sessions - a.sessions);

    return {
      role: 'USER' as const,
      totals: {
        sessions: sessions.length,
        completed,
        abandoned,
        avgScorePct,
        bestScorePct,
        ...timing,
      },
      byPersona,
      series: this.dailyTraineeSeries(sessions, 90),
      recent: sessions.slice(0, RECENT_LIMIT).map((s) => ({
        uid: s.uid,
        personaName: s.persona.name,
        status: s.status,
        scorePct: scorePct(s.scores),
      })),
    };
  }

  /** Trainer: roll up each supervised trainee's activity + own persona counts. */
  private async trainerSummary(trainerId: number) {
    const trainees = await this.prisma.user.findMany({
      where: { supervisorId: trainerId, isDeleted: false },
      select: { id: true, firstName: true, lastName: true },
    });
    const traineeIds = trainees.map((t) => t.id);

    const sessions = traineeIds.length
      ? await this.prisma.session.findMany({
          where: { userId: { in: traineeIds }, isSimulation: false },
          select: {
            uid: true,
            userId: true,
            status: true,
            startedAt: true,
            persona: { select: { id: true, name: true } },
            user: { select: { firstName: true, lastName: true } },
            scores: { select: { score: true, maxScore: true } },
          },
          orderBy: { startedAt: 'desc' },
        })
      : [];

    const rows = trainees.map((t) => {
      const own = sessions.filter((s) => s.userId === t.id);
      const completed = own.filter((s) => s.status === 'COMPLETED').length;
      const lastActiveAt = own.reduce<Date | null>(
        (latest, s) => (latest === null || s.startedAt > latest ? s.startedAt : latest),
        null,
      );
      return {
        id: t.id,
        name: `${t.firstName} ${t.lastName}`.trim(),
        sessions: own.length,
        completed,
        avgScorePct: scorePct(own.flatMap((s) => s.scores)),
        lastActiveAt,
      };
    });

    const [personaTotal, personaPublished, timing] = await Promise.all([
      this.prisma.persona.count({ where: { createdById: trainerId, isDeleted: false } }),
      this.prisma.persona.count({
        where: { createdById: trainerId, isDeleted: false, isPublished: true },
      }),
      traineeIds.length
        ? this.timing({ userId: { in: traineeIds }, isSimulation: false })
        : Promise.resolve<Timing>({ avgResponseMs: null, avgLlmLatencyMs: null }),
    ]);

    const completedTotal = sessions.filter((s) => s.status === 'COMPLETED').length;
    const abandonedTotal = sessions.filter((s) => s.status === 'ABANDONED').length;

    // Latest trainee attempts.
    const recent = sessions.slice(0, RECENT_LIMIT).map((s) => ({
      uid: s.uid,
      traineeName: `${s.user.firstName} ${s.user.lastName}`.trim(),
      personaName: s.persona.name,
      status: s.status,
      scorePct: scorePct(s.scores),
    }));

    // How much each scenario is practised + how hard it is (lowest score first).
    const personaMap = new Map<
      number,
      { name: string; count: number; scores: ScorePair[] }
    >();
    for (const s of sessions) {
      const e =
        personaMap.get(s.persona.id) ?? { name: s.persona.name, count: 0, scores: [] };
      e.count += 1;
      e.scores.push(...s.scores);
      personaMap.set(s.persona.id, e);
    }
    const byPersona = [...personaMap.values()]
      .map((e) => ({
        personaName: e.name,
        sessions: e.count,
        avgScorePct: scorePct(e.scores),
      }))
      .sort((a, b) => b.sessions - a.sessions);

    return {
      role: 'TRAINER' as const,
      totals: {
        trainees: trainees.length,
        sessions: sessions.length,
        completed: completedTotal,
        abandoned: abandonedTotal,
        avgScorePct: scorePct(sessions.flatMap((s) => s.scores)),
        ...timing,
      },
      trainees: rows.sort((a, b) => {
        // Surface the least-active / lowest-scoring trainees first.
        const sa = a.avgScorePct ?? 999;
        const sb = b.avgScorePct ?? 999;
        return sa - sb;
      }),
      byPersona,
      recent,
      series: this.dailyTraineeSeries(sessions, 90),
      personas: { total: personaTotal, published: personaPublished },
    };
  }

  /** Daily trainee activity over the last `days` days (gap-filled): session
   *  count + avg score per day, for the trainer's activity chart. */
  private dailyTraineeSeries(
    sessions: { startedAt: Date; scores: ScorePair[] }[],
    days: number,
  ) {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const buckets = new Map<string, { count: number; scores: ScorePair[] }>();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setUTCDate(d.getUTCDate() - i);
      buckets.set(d.toISOString().slice(0, 10), { count: 0, scores: [] });
    }
    for (const s of sessions) {
      const key = new Date(s.startedAt).toISOString().slice(0, 10);
      const b = buckets.get(key);
      if (!b) continue;
      b.count += 1;
      b.scores.push(...s.scores);
    }
    return [...buckets.entries()].map(([date, b]) => ({
      date,
      sessions: b.count,
      avgScorePct: scorePct(b.scores),
    }));
  }

  /** Super admin: org-wide counts. LLM token/cost is fetched separately from
   *  /llm/usage so the model breakdown stays in one place. */
  private async adminSummary() {
    const [users, trainers, trainees, personas, publishedPersonas, sessions, completed, timing] =
      await Promise.all([
        this.prisma.user.count({ where: { isDeleted: false } }),
        this.prisma.user.count({ where: { isDeleted: false, role: { name: 'TRAINER' } } }),
        this.prisma.user.count({ where: { isDeleted: false, role: { name: 'USER' } } }),
        this.prisma.persona.count({ where: { isDeleted: false } }),
        this.prisma.persona.count({ where: { isDeleted: false, isPublished: true } }),
        this.prisma.session.count({ where: { isSimulation: false } }),
        this.prisma.session.count({ where: { isSimulation: false, status: 'COMPLETED' } }),
        this.timing({ isSimulation: false }),
      ]);

    return {
      role: 'SUPER_ADMIN' as const,
      totals: {
        users,
        trainers,
        trainees,
        personas,
        publishedPersonas,
        sessions,
        completed,
        ...timing,
      },
    };
  }

  /** Admin report: per-trainer team rollup (paginated, name-searchable). */
  async reportTrainers(actor: { role: string }, query: PageQuery) {
    if (actor.role !== 'SUPER_ADMIN') throw new ForbiddenException();
    const { page, limit, q } = query;
    const where: Prisma.UserWhereInput = {
      isDeleted: false,
      role: { name: 'TRAINER' },
      ...(q
        ? {
            OR: [
              { firstName: { contains: q, mode: 'insensitive' } },
              { lastName: { contains: q, mode: 'insensitive' } },
              { email: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [trainers, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
        select: { id: true, firstName: true, lastName: true, email: true },
      }),
      this.prisma.user.count({ where }),
    ]);

    const trainerIds = trainers.map((t) => t.id);
    const trainees = trainerIds.length
      ? await this.prisma.user.findMany({
          where: { supervisorId: { in: trainerIds }, isDeleted: false },
          select: { id: true, supervisorId: true },
        })
      : [];
    const trainerOf = new Map(trainees.map((t) => [t.id, t.supervisorId]));
    const teamSize = new Map<number, number>();
    for (const t of trainees) {
      teamSize.set(t.supervisorId!, (teamSize.get(t.supervisorId!) ?? 0) + 1);
    }

    const sessions = trainees.length
      ? await this.prisma.session.findMany({
          where: { userId: { in: trainees.map((t) => t.id) }, isSimulation: false },
          select: { userId: true, status: true, scores: { select: { score: true, maxScore: true } } },
        })
      : [];
    const byTrainer = new Map<
      number,
      { sessions: number; completed: number; scores: ScorePair[] }
    >();
    for (const s of sessions) {
      const trainerId = trainerOf.get(s.userId);
      if (trainerId == null) continue;
      const e = byTrainer.get(trainerId) ?? { sessions: 0, completed: 0, scores: [] };
      e.sessions += 1;
      if (s.status === 'COMPLETED') e.completed += 1;
      e.scores.push(...s.scores);
      byTrainer.set(trainerId, e);
    }

    const rows = trainers.map((t) => {
      const agg = byTrainer.get(t.id);
      return {
        id: t.id,
        name: `${t.firstName} ${t.lastName}`.trim(),
        email: t.email,
        trainees: teamSize.get(t.id) ?? 0,
        sessions: agg?.sessions ?? 0,
        completed: agg?.completed ?? 0,
        avgScorePct: scorePct(agg?.scores ?? []),
      };
    });

    return { rows, total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) };
  }

  /** Admin report: per-persona usage rollup (paginated, name-searchable,
   *  optional published filter). */
  async reportPersonas(actor: { role: string }, query: PageQuery) {
    if (actor.role !== 'SUPER_ADMIN') throw new ForbiddenException();
    const { page, limit, q, published } = query;
    const where: Prisma.PersonaWhereInput = {
      isDeleted: false,
      ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}),
      ...(published !== undefined ? { isPublished: published } : {}),
    };

    const [personas, total] = await Promise.all([
      this.prisma.persona.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { name: 'asc' },
        select: { id: true, name: true, isPublished: true, createdById: true },
      }),
      this.prisma.persona.count({ where }),
    ]);

    const personaIds = personas.map((p) => p.id);
    const creatorIds = [
      ...new Set(personas.map((p) => p.createdById).filter((v): v is number => v != null)),
    ];
    const [sessions, creators] = await Promise.all([
      personaIds.length
        ? this.prisma.session.findMany({
            where: { personaId: { in: personaIds }, isSimulation: false },
            select: { personaId: true, scores: { select: { score: true, maxScore: true } } },
          })
        : Promise.resolve([]),
      creatorIds.length
        ? this.prisma.user.findMany({
            where: { id: { in: creatorIds } },
            select: { id: true, firstName: true, lastName: true },
          })
        : Promise.resolve([]),
    ]);
    const ownerName = new Map(
      creators.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()]),
    );
    const byPersona = new Map<number, { sessions: number; scores: ScorePair[] }>();
    for (const s of sessions) {
      const e = byPersona.get(s.personaId) ?? { sessions: 0, scores: [] };
      e.sessions += 1;
      e.scores.push(...s.scores);
      byPersona.set(s.personaId, e);
    }

    const rows = personas.map((p) => {
      const agg = byPersona.get(p.id);
      return {
        id: p.id,
        name: p.name,
        owner: p.createdById != null ? (ownerName.get(p.createdById) ?? '—') : '—',
        published: p.isPublished,
        sessions: agg?.sessions ?? 0,
        avgScorePct: scorePct(agg?.scores ?? []),
      };
    });

    return { rows, total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) };
  }
}
