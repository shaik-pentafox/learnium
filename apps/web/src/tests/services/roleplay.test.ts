import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from 'vitest'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import { startSession, getRealtimeTicket } from '@/services/roleplay'
import { useAuthStore } from '@/stores/auth'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
beforeEach(() => useAuthStore.setState({ accessToken: 't', refreshToken: 'r' }))

function ok<T>(data: T) {
  return HttpResponse.json({ status: 'success', message: 'OK', data, meta: {} })
}

describe('roleplay api', () => {
  it('startSession posts personaId and returns the new session', async () => {
    let body: unknown
    server.use(
      http.post('*/api/v1/sessions', async ({ request }) => {
        body = await request.json()
        return ok({ sessionId: 9, uid: 'u-9', startedAt: '2026-06-16T00:00:00Z' })
      }),
    )

    const result = await startSession(3)
    expect(body).toEqual({ personaId: 3 })
    expect(result.uid).toBe('u-9')
  })

  it('getRealtimeTicket unwraps the ticket string', async () => {
    server.use(
      http.post('*/api/v1/auth/realtime/ticket', () => ok({ ticket: 'tkt-1' })),
    )
    await expect(getRealtimeTicket()).resolves.toBe('tkt-1')
  })
})
