import { apiPost } from '@/lib/api-client'

export interface StartedSession {
  sessionId: number
  uid: string
  startedAt: string
}

/** POST /sessions { personaId } → new ACTIVE session (thread for the roleplay). */
export async function startSession(personaId: number): Promise<StartedSession> {
  return apiPost<StartedSession>('/sessions', { personaId })
}

/** POST /auth/realtime/ticket → single-use ticket for the WS handshake. */
export async function getRealtimeTicket(): Promise<string> {
  const { ticket } = await apiPost<{ ticket: string }>('/auth/realtime/ticket')
  return ticket
}
