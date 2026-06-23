import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from 'vitest'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import {
  getDashboardSummary,
  dashboardKeys,
  type DashboardSummary,
} from '@/services/dashboard'
import { useAuthStore } from '@/stores/auth'

const server = setupServer()

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

beforeEach(() => {
  localStorage.clear()
  useAuthStore.setState({ accessToken: 'token', refreshToken: 'r1' })
})

function respondWith(data: DashboardSummary) {
  server.use(
    http.get('*/api/v1/dashboard/summary', () =>
      HttpResponse.json({ status: 'success', message: 'OK', data, meta: {} }),
    ),
  )
}

describe('getDashboardSummary', () => {
  it('unwraps a trainee summary', async () => {
    respondWith({
      firstName: 'Jane',
      role: 'USER',
      totals: { sessions: 6, completed: 5, abandoned: 1, avgScorePct: 78, bestScorePct: 92 },
      byPersona: [{ personaName: 'Dana', sessions: 3, avgScorePct: 82 }],
      series: [{ date: '2026-06-01', sessions: 2, avgScorePct: 78 }],
      recent: [{ uid: 's1', personaName: 'Dana', status: 'COMPLETED', scorePct: 82 }],
    })
    const result = await getDashboardSummary()
    expect(result.role).toBe('USER')
    if (result.role === 'USER') {
      expect(result.totals.avgScorePct).toBe(78)
      expect(result.recent[0].personaName).toBe('Dana')
    }
  })

  it('unwraps a trainer summary with the trainee roll-up', async () => {
    respondWith({
      firstName: 'Theo',
      role: 'TRAINER',
      totals: { trainees: 2, sessions: 10, completed: 7, abandoned: 1, avgScorePct: 70 },
      trainees: [
        { id: 1, name: 'Jane', sessions: 5, completed: 4, avgScorePct: 81, lastActiveAt: null },
      ],
      byPersona: [{ personaName: 'Dana', sessions: 5, avgScorePct: 70 }],
      recent: [
        { uid: 'r1', traineeName: 'Jane', personaName: 'Dana', status: 'COMPLETED', scorePct: 81 },
      ],
      series: [{ date: '2026-06-01', sessions: 2, avgScorePct: 70 }],
      personas: { total: 3, published: 2 },
    })
    const result = await getDashboardSummary()
    expect(result.role).toBe('TRAINER')
    if (result.role === 'TRAINER') {
      expect(result.trainees).toHaveLength(1)
      expect(result.personas.published).toBe(2)
    }
  })

  it('unwraps an admin summary', async () => {
    respondWith({
      firstName: 'Ada',
      role: 'SUPER_ADMIN',
      totals: {
        users: 12,
        trainers: 3,
        trainees: 8,
        personas: 9,
        publishedPersonas: 6,
        sessions: 140,
        completed: 118,
      },
    })
    const result = await getDashboardSummary()
    expect(result.role).toBe('SUPER_ADMIN')
    if (result.role === 'SUPER_ADMIN') {
      expect(result.totals.users).toBe(12)
    }
  })
})

describe('dashboardKeys', () => {
  it('namespaces the summary key', () => {
    expect(dashboardKeys.summary(7)).toEqual(['dashboard', 'summary', 7])
  })
})
