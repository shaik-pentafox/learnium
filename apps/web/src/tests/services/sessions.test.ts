import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from 'vitest'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import { listSessions, sessionKeys } from '@/services/sessions'
import { useAuthStore } from '@/stores/auth'
import { queryKeys } from '@/lib/query-keys'

const server = setupServer()

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

beforeEach(() => {
  localStorage.clear()
  useAuthStore.setState({ accessToken: 'token', refreshToken: 'r1' })
})

describe('listSessions', () => {
  it('returns the nested pagination payload from data', async () => {
    const payload = {
      sessions: [
        {
          id: 1,
          uid: 's1',
          status: 'COMPLETED',
          persona: { id: 1, name: 'Coach' },
          scores: [{ id: 1, criterionId: 1, score: 8, maxScore: 10 }],
          startedAt: '2026-06-16T00:00:00Z',
        },
      ],
      total: 1,
      page: 1,
      limit: 5,
      totalPages: 1,
    }
    server.use(
      http.get('*/api/v1/sessions', () =>
        HttpResponse.json({ status: 'success', message: 'OK', data: payload, meta: {} }),
      ),
    )

    const result = await listSessions({ limit: 5 })
    expect(result.total).toBe(1)
    expect(result.sessions[0].persona.name).toBe('Coach')
  })

  it('forwards query params', async () => {
    let seen = ''
    server.use(
      http.get('*/api/v1/sessions', ({ request }) => {
        seen = new URL(request.url).search
        return HttpResponse.json({
          status: 'success',
          message: 'OK',
          data: { sessions: [], total: 0, page: 2, limit: 10, totalPages: 0 },
          meta: {},
        })
      }),
    )

    await listSessions({ page: 2, limit: 10, status: 'ACTIVE' })
    expect(seen).toContain('page=2')
    expect(seen).toContain('status=ACTIVE')
  })
})

describe('sessionKeys', () => {
  it('composes off the root sessions namespace', () => {
    expect(sessionKeys.list({ limit: 5 })).toEqual([
      ...queryKeys.sessions,
      'list',
      { limit: 5 },
    ])
  })
})
