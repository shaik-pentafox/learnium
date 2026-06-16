import { http, HttpResponse } from 'msw'
import type { AuthUser } from '@/stores/auth'

const BASE = '/api/v1'

function ok<T>(data: T, message = 'OK') {
  return HttpResponse.json({
    status: 'success',
    message,
    data,
    meta: { timestamp: new Date().toISOString() },
  })
}

function fail(code: string, message: string, status: number) {
  return HttpResponse.json(
    { status: 'error', code, message, meta: { timestamp: new Date().toISOString() } },
    { status },
  )
}

const MOCK_USER: AuthUser = {
  id: 'u_admin_1',
  email: 'admin@learnium.dev',
  name: 'Ada Admin',
  role: 'SUPER_ADMIN',
}

const MOCK_TOKEN = 'mock-access-token'

export const handlers = [
  http.post(`${BASE}/auth/login`, async ({ request }) => {
    const body = (await request.json()) as { email?: string; password?: string }
    if (!body?.email || !body?.password) {
      return fail('VALIDATION_ERROR', 'Email and password are required', 400)
    }
    if (body.password !== 'password') {
      return fail('INVALID_CREDENTIALS', 'Invalid email or password', 401)
    }
    return ok({ user: MOCK_USER, accessToken: MOCK_TOKEN }, 'Logged in')
  }),

  http.post(`${BASE}/auth/refresh`, () =>
    ok({ accessToken: MOCK_TOKEN }, 'Token refreshed'),
  ),

  http.post(`${BASE}/auth/logout`, () => ok({ ok: true }, 'Logged out')),

  http.get(`${BASE}/auth/me`, ({ request }) => {
    const auth = request.headers.get('Authorization')
    if (!auth) return fail('UNAUTHORIZED', 'Missing credentials', 401)
    return ok(MOCK_USER)
  }),

  http.get(`${BASE}/dashboard`, ({ request }) => {
    const auth = request.headers.get('Authorization')
    if (!auth) return fail('UNAUTHORIZED', 'Missing credentials', 401)
    return ok({
      scoreCurrent: 78,
      rank: { position: 12, total: 470 },
      streakDays: 5,
      sessionsToday: 3,
      recentSessions: [
        { id: 's1', persona: 'Objection Handler', score: 82, at: '2026-06-16T09:10:00Z' },
        { id: 's2', persona: 'Cold Lead', score: 74, at: '2026-06-15T14:02:00Z' },
        { id: 's3', persona: 'Angry Customer', score: 69, at: '2026-06-14T11:30:00Z' },
      ],
    })
  }),
]
