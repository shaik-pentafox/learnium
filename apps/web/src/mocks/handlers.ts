import { http, HttpResponse } from 'msw'

const BASE = '/api/v1'

function meta() {
  return { requestId: 'mock-request', timestamp: new Date().toISOString() }
}

function ok<T>(data: T, message = 'OK') {
  return HttpResponse.json({ status: 'success', message, data, meta: meta() })
}

function fail(code: string, message: string, status: number) {
  return HttpResponse.json(
    { status: 'error', code, message, meta: meta() },
    { status },
  )
}

function base64Url(value: object): string {
  return btoa(JSON.stringify(value))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

// Mints a decodable (unsigned) JWT matching the backend payload `{ sub, role }`
// so the frontend's decodeJwt path is exercised against real-shaped tokens.
function mockJwt(sub: number, role: string): string {
  const header = base64Url({ alg: 'none', typ: 'JWT' })
  const exp = Math.floor(Date.now() / 1000) + 15 * 60
  const payload = base64Url({ sub, role, iat: Math.floor(Date.now() / 1000), exp })
  return `${header}.${payload}.mock`
}

function tokens() {
  return {
    accessToken: mockJwt(1, 'SUPER_ADMIN'),
    refreshToken: crypto.randomUUID(),
  }
}

const MOCK_SESSIONS = [
  {
    id: 1,
    uid: 's-0001',
    status: 'COMPLETED',
    persona: { id: 1, name: 'Objection Handler' },
    scores: [
      { id: 1, criterionId: 1, score: 8, maxScore: 10 },
      { id: 2, criterionId: 2, score: 7, maxScore: 10 },
    ],
    startedAt: '2026-06-16T09:10:00Z',
    endedAt: '2026-06-16T09:24:00Z',
  },
  {
    id: 2,
    uid: 's-0002',
    status: 'COMPLETED',
    persona: { id: 2, name: 'Cold Lead' },
    scores: [{ id: 3, criterionId: 1, score: 7, maxScore: 10 }],
    startedAt: '2026-06-15T14:02:00Z',
    endedAt: '2026-06-15T14:18:00Z',
  },
  {
    id: 3,
    uid: 's-0003',
    status: 'ACTIVE',
    persona: { id: 3, name: 'Angry Customer' },
    scores: [],
    startedAt: '2026-06-16T11:30:00Z',
  },
]

export const handlers = [
  http.post(`${BASE}/auth/login`, async ({ request }) => {
    const body = (await request.json()) as {
      username?: string
      password?: string
    }
    if (!body?.username || !body?.password) {
      return fail('VALIDATION_ERROR', 'Username and password are required', 400)
    }
    if (body.password !== 'password') {
      return fail('INVALID_CREDENTIALS', 'Invalid credentials', 401)
    }
    return ok(tokens())
  }),

  http.post(`${BASE}/auth/refresh`, async ({ request }) => {
    const body = (await request.json()) as { refreshToken?: string }
    if (!body?.refreshToken) {
      return fail('TOKEN_EXPIRED', 'Invalid or expired refresh token', 401)
    }
    return ok(tokens())
  }),

  http.post(`${BASE}/auth/logout`, ({ request }) => {
    if (!request.headers.get('Authorization')) {
      return fail('UNAUTHORIZED', 'Missing credentials', 401)
    }
    return ok({ message: 'Logged out' })
  }),

  http.get(`${BASE}/personas/my`, ({ request }) => {
    if (!request.headers.get('Authorization')) {
      return fail('UNAUTHORIZED', 'Missing credentials', 401)
    }
    return ok({
      personas: [
        {
          id: 1,
          name: 'Objection Handler',
          description: 'A skeptical buyer who pushes back on price and value.',
        },
        {
          id: 2,
          name: 'Angry Customer',
          description: 'An upset customer escalating a support complaint.',
        },
      ],
      total: 2,
    })
  }),

  http.post(`${BASE}/sessions`, async ({ request }) => {
    if (!request.headers.get('Authorization')) {
      return fail('UNAUTHORIZED', 'Missing credentials', 401)
    }
    const body = (await request.json()) as { personaId?: number }
    if (!body?.personaId) {
      return fail('VALIDATION_ERROR', 'personaId required', 400)
    }
    return HttpResponse.json(
      {
        status: 'success',
        message: 'OK',
        data: {
          sessionId: 101,
          uid: crypto.randomUUID(),
          startedAt: new Date().toISOString(),
        },
        meta: meta(),
      },
      { status: 201 },
    )
  }),

  http.post(`${BASE}/auth/realtime/ticket`, ({ request }) => {
    if (!request.headers.get('Authorization')) {
      return fail('UNAUTHORIZED', 'Missing credentials', 401)
    }
    return HttpResponse.json(
      { status: 'success', message: 'OK', data: { ticket: crypto.randomUUID() }, meta: meta() },
      { status: 201 },
    )
  }),

  http.get(`${BASE}/sessions`, ({ request }) => {
    if (!request.headers.get('Authorization')) {
      return fail('UNAUTHORIZED', 'Missing credentials', 401)
    }
    const limit = Number(new URL(request.url).searchParams.get('limit') ?? 20)
    return ok({
      sessions: MOCK_SESSIONS.slice(0, limit),
      total: MOCK_SESSIONS.length,
      page: 1,
      limit,
      totalPages: 1,
    })
  }),
]
