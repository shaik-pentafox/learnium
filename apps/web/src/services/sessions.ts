import { apiGet } from '@/lib/api-client'
import { queryKeys } from '@/lib/query-keys'

export type SessionStatus = 'ACTIVE' | 'COMPLETED' | 'ABANDONED'

export interface SessionScore {
  id: number
  criterionId: number
  /** Nullable until scoring completes (Prisma `ScoreResult.score Float?`). */
  score: number | null
  maxScore: number
  feedback?: string | null
}

export interface SessionSummary {
  id: number
  uid: string
  status: SessionStatus
  persona: { id: number; name: string }
  scores: SessionScore[]
  startedAt: string
  endedAt?: string
}

export interface SessionListData {
  sessions: SessionSummary[]
  total: number
  page: number
  limit: number
  totalPages: number
}

export interface SessionListParams {
  page?: number
  limit?: number
  status?: SessionStatus
}

/** GET /sessions — backend auto-scopes USER role to their own sessions. */
export async function listSessions(
  params: SessionListParams = {},
): Promise<SessionListData> {
  return apiGet<SessionListData>('/sessions', { params })
}

export const sessionKeys = {
  list: (params: SessionListParams) =>
    [...queryKeys.sessions, 'list', params] as const,
}
