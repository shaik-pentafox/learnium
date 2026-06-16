import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from 'vitest'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import { apiGet } from '@/lib/api-client'
import { useAuthStore } from '@/stores/auth'

const server = setupServer()

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

beforeEach(() => {
  localStorage.clear()
  useAuthStore.getState().clear()
})

function envelope<T>(data: T) {
  return { status: 'success', message: 'OK', data, meta: {} }
}

function mockJwt(sub: number, role: string): string {
  const b64 = (o: object) =>
    btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `${b64({ alg: 'none' })}.${b64({ sub, role })}.sig`
}

describe('api-client', () => {
  it('unwraps the success envelope to data', async () => {
    server.use(
      http.get('*/api/v1/ping', () => HttpResponse.json(envelope({ pong: true }))),
    )
    await expect(apiGet<{ pong: boolean }>('/ping')).resolves.toEqual({
      pong: true,
    })
  })

  it('normalizes an error envelope into ApiError', async () => {
    server.use(
      http.get('*/api/v1/boom', () =>
        HttpResponse.json(
          { status: 'error', code: 'NOT_FOUND', message: 'nope', meta: {} },
          { status: 404 },
        ),
      ),
    )
    await expect(apiGet('/boom')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      httpStatus: 404,
    })
  })

  it('on 401 refreshes the token then replays the original request', async () => {
    let protectedCalls = 0
    let refreshCalls = 0
    server.use(
      http.get('*/api/v1/secure', () => {
        protectedCalls += 1
        if (protectedCalls === 1) {
          return HttpResponse.json(
            { status: 'error', code: 'UNAUTHORIZED', message: 'stale', meta: {} },
            { status: 401 },
          )
        }
        return HttpResponse.json(envelope({ ok: true }))
      }),
      http.post('*/api/v1/auth/refresh', () => {
        refreshCalls += 1
        return HttpResponse.json(
          envelope({
            accessToken: mockJwt(1, 'SUPER_ADMIN'),
            refreshToken: 'new-refresh',
          }),
        )
      }),
    )
    useAuthStore.setState({ accessToken: 'stale', refreshToken: 'r1' })

    await expect(apiGet<{ ok: boolean }>('/secure')).resolves.toEqual({ ok: true })
    expect(refreshCalls).toBe(1)
    expect(protectedCalls).toBe(2)
    expect(useAuthStore.getState().refreshToken).toBe('new-refresh')
  })

  it('clears the session when refresh itself fails', async () => {
    server.use(
      http.get('*/api/v1/secure', () =>
        HttpResponse.json(
          { status: 'error', code: 'UNAUTHORIZED', message: 'stale', meta: {} },
          { status: 401 },
        ),
      ),
      http.post('*/api/v1/auth/refresh', () =>
        HttpResponse.json(
          { status: 'error', code: 'TOKEN_EXPIRED', message: 'gone', meta: {} },
          { status: 401 },
        ),
      ),
    )
    useAuthStore.setState({ accessToken: 'stale', refreshToken: 'r1' })

    await expect(apiGet('/secure')).rejects.toBeDefined()
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
    expect(useAuthStore.getState().refreshToken).toBeNull()
  })
})
