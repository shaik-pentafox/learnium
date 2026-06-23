import { apiPost } from '@/lib/api-client'

export interface StartedSession {
  sessionId: number
  uid: string
  startedAt: string
  isSimulation?: boolean
}

/** POST /sessions { personaId } → new ACTIVE session (thread for the roleplay). */
export async function startSession(
  personaId: number,
  opts?: { simulation?: boolean },
): Promise<StartedSession> {
  return apiPost<StartedSession>('/sessions', {
    personaId,
    ...(opts?.simulation ? { simulation: true } : {}),
  })
}

/** POST /auth/realtime/ticket → single-use ticket for the WS handshake. */
export async function getRealtimeTicket(): Promise<string> {
  const { ticket } = await apiPost<{ ticket: string }>('/auth/realtime/ticket')
  return ticket
}

/** POST /sessions/:uid/abandon → mark a left-early session ABANDONED (no score). */
export async function abandonSession(uid: string): Promise<void> {
  await apiPost(`/sessions/${uid}/abandon`)
}
