/** Pure ranking logic for the trainee leaderboard — no DB, no Nest. Kept
 *  separate from the service so the scoring rules are unit-testable. */

export interface ScorePair {
  score: number | null;
  maxScore: number;
}

export interface SessionInput {
  scores: ScorePair[];
}

export interface TraineeInput {
  userId: number;
  name: string;
  avatarUrl: string | null;
  sessions: SessionInput[];
}

export interface LeaderboardRow {
  rank: number;
  userId: number;
  name: string;
  avatarUrl: string | null;
  /** Completed, non-simulation sessions inside the window. */
  sessions: number;
  /** Sessions that actually produced a score — the points basis. */
  scoredSessions: number;
  avgScorePct: number | null;
  /** Sum of per-session score percentages (= scoredSessions x avgScorePct).
   *  Rewards practising often AND scoring well, per the agreed metric. */
  points: number;
}

/** Pooled score percentage for one session; null when nothing was scored. */
export function sessionScorePct(scores: ScorePair[]): number | null {
  const scored = scores.filter((s) => s.score !== null);
  if (scored.length === 0) return null;
  const earned = scored.reduce((sum, s) => sum + (s.score ?? 0), 0);
  const max = scored.reduce((sum, s) => sum + s.maxScore, 0);
  return max > 0 ? Math.round((earned / max) * 100) : null;
}

/**
 * Rank trainees by points (sessions x score), highest first.
 *
 * Ties break on average score, then session count, then name — so the order is
 * total and stable rather than dependent on query order. Equal points share a
 * rank (standard competition ranking: 1, 2, 2, 4).
 */
export function rankTrainees(trainees: TraineeInput[]): LeaderboardRow[] {
  const scored = trainees.map((t) => {
    const pcts = t.sessions
      .map((s) => sessionScorePct(s.scores))
      .filter((v): v is number => v !== null);
    const points = pcts.reduce((a, b) => a + b, 0);
    return {
      userId: t.userId,
      name: t.name,
      avatarUrl: t.avatarUrl,
      sessions: t.sessions.length,
      scoredSessions: pcts.length,
      avgScorePct: pcts.length ? Math.round(points / pcts.length) : null,
      points,
    };
  });

  const ordered = [...scored].sort(
    (a, b) =>
      b.points - a.points ||
      (b.avgScorePct ?? -1) - (a.avgScorePct ?? -1) ||
      b.sessions - a.sessions ||
      a.name.localeCompare(b.name),
  );

  let lastPoints: number | null = null;
  let lastRank = 0;
  return ordered.map((row, i) => {
    const rank = lastPoints !== null && row.points === lastPoints ? lastRank : i + 1;
    lastPoints = row.points;
    lastRank = rank;
    return { rank, ...row };
  });
}
