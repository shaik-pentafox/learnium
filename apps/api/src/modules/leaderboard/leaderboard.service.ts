import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/database/prisma.service';
import { rankTrainees, type LeaderboardRow } from './leaderboard.ranking';

export interface LeaderboardQuery {
  /** Rolling window in days. */
  days: number;
  limit: number;
}

export interface LeaderboardResult {
  days: number;
  since: string;
  rows: LeaderboardRow[];
  /** The caller's own row — present even when they fall outside `limit`, so a
   *  trainee can always see where they stand. Null for non-trainees. */
  me: LeaderboardRow | null;
  totalRanked: number;
}

@Injectable()
export class LeaderboardService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Board of every trainee with activity in the rolling window, ranked by
   * points (sessions x score). Simulation sessions are excluded so persona
   * test-drives never inflate a ranking, and only COMPLETED sessions count —
   * an abandoned run should not earn points.
   */
  async board(
    actor: { sub: number; role: string },
    query: LeaderboardQuery,
  ): Promise<LeaderboardResult> {
    const since = new Date(Date.now() - query.days * 24 * 60 * 60 * 1000);

    const sessions = await this.prisma.session.findMany({
      where: {
        isSimulation: false,
        status: 'COMPLETED',
        startedAt: { gte: since },
        user: { isDeleted: false, role: { name: 'USER' } },
      },
      select: {
        userId: true,
        user: { select: { firstName: true, lastName: true, avatarUrl: true } },
        scores: { select: { score: true, maxScore: true } },
      },
    });

    const byUser = new Map<
      number,
      { name: string; avatarUrl: string | null; sessions: { scores: typeof sessions[number]['scores'] }[] }
    >();
    for (const s of sessions) {
      const entry =
        byUser.get(s.userId) ??
        {
          name: `${s.user.firstName} ${s.user.lastName}`.trim(),
          avatarUrl: s.user.avatarUrl,
          sessions: [],
        };
      entry.sessions.push({ scores: s.scores });
      byUser.set(s.userId, entry);
    }

    const ranked = rankTrainees(
      [...byUser.entries()].map(([userId, e]) => ({
        userId,
        name: e.name,
        avatarUrl: e.avatarUrl,
        sessions: e.sessions,
      })),
    );

    return {
      days: query.days,
      since: since.toISOString(),
      rows: ranked.slice(0, query.limit),
      me: ranked.find((r) => r.userId === actor.sub) ?? null,
      totalRanked: ranked.length,
    };
  }
}
