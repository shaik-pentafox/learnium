import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/database/prisma.service';

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
    const sessions = await this.prisma.session.findMany({
      where: { userId, isSimulation: false },
      select: {
        uid: true,
        status: true,
        startedAt: true,
        persona: { select: { id: true, name: true } },
        scores: { select: { score: true, maxScore: true } },
      },
      orderBy: { startedAt: 'desc' },
    });

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
      totals: { sessions: sessions.length, completed, abandoned, avgScorePct, bestScorePct },
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

    const [personaTotal, personaPublished] = await Promise.all([
      this.prisma.persona.count({ where: { createdById: trainerId, isDeleted: false } }),
      this.prisma.persona.count({
        where: { createdById: trainerId, isDeleted: false, isPublished: true },
      }),
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
    const [users, trainers, trainees, personas, publishedPersonas, sessions, completed] =
      await Promise.all([
        this.prisma.user.count({ where: { isDeleted: false } }),
        this.prisma.user.count({ where: { isDeleted: false, role: { name: 'TRAINER' } } }),
        this.prisma.user.count({ where: { isDeleted: false, role: { name: 'USER' } } }),
        this.prisma.persona.count({ where: { isDeleted: false } }),
        this.prisma.persona.count({ where: { isDeleted: false, isPublished: true } }),
        this.prisma.session.count({ where: { isSimulation: false } }),
        this.prisma.session.count({ where: { isSimulation: false, status: 'COMPLETED' } }),
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
      },
    };
  }
}
