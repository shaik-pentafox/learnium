import { apiGet } from '@/lib/api-client'

export interface LeaderboardRow {
  rank: number
  userId: number
  name: string
  avatarUrl: string | null
  sessions: number
  scoredSessions: number
  avgScorePct: number | null
  /** Sessions x score — the ranking metric. */
  points: number
}

export interface Leaderboard {
  days: number
  since: string
  rows: LeaderboardRow[]
  /** Caller's own row, present even when outside the returned page. */
  me: LeaderboardRow | null
  totalRanked: number
}

export interface LeaderboardParams {
  days?: number
  limit?: number
}

/** GET /leaderboard — trainee ranking over a rolling window. */
export async function getLeaderboard(
  params: LeaderboardParams = {},
): Promise<Leaderboard> {
  return apiGet<Leaderboard>('/leaderboard', {
    params: {
      ...(params.days ? { days: params.days } : {}),
      ...(params.limit ? { limit: params.limit } : {}),
    },
  })
}

export const leaderboardKeys = {
  board: (params: LeaderboardParams, userId?: number) =>
    ['leaderboard', params, userId] as const,
}
