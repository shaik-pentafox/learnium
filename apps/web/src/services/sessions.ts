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

export interface SessionDetail {
  id: number
  uid: string
  status: SessionStatus
  /** True for trainer/admin persona-test sessions (not graded trainee runs). */
  isSimulation?: boolean
  persona: { id: number; name: string }
  startedAt: string
  endedAt?: string | null
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

/** GET /sessions/:uid — single session detail (USER scoped to own). */
export async function getSession(uid: string): Promise<SessionDetail> {
  return apiGet<SessionDetail>(`/sessions/${uid}`)
}

export const sessionKeys = {
  list: (params: SessionListParams) =>
    [...queryKeys.sessions, 'list', params] as const,
  detail: (uid: string) => [...queryKeys.sessions, 'detail', uid] as const,
}
