import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from 'vitest'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import { handlers } from '@/mocks/handlers'
import { login, logout, restoreSession } from '@/services/auth'
import { useAuthStore } from '@/stores/auth'

const server = setupServer(...handlers)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

beforeEach(() => {
  localStorage.clear()
  useAuthStore.getState().clear()
})

describe('login', () => {
  it('establishes a session from the token pair (role decoded, name kept)', async () => {
    await login({ username: 'admin', password: 'password' })

    const { user, isAuthenticated, accessToken } = useAuthStore.getState()
    expect(isAuthenticated).toBe(true)
    expect(accessToken).toBeTruthy()
    expect(user).toMatchObject({ role: 'SUPER_ADMIN', name: 'admin' })
  })

  it('surfaces a normalized ApiError on bad credentials', async () => {
    await expect(
      login({ username: 'admin', password: 'wrong' }),
    ).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
      httpStatus: 401,
    })
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
  })
})

describe('logout', () => {
  it('clears the session even when the server call fails', async () => {
    server.use(
      http.post('*/api/v1/auth/logout', () =>
        HttpResponse.json(
          { status: 'error', code: 'INTERNAL_ERROR', message: 'x', meta: {} },
          { status: 500 },
        ),
      ),
    )
    useAuthStore.setState({ refreshToken: 'r1', isAuthenticated: true })

    await logout()

    expect(useAuthStore.getState().isAuthenticated).toBe(false)
    expect(useAuthStore.getState().refreshToken).toBeNull()
  })
})

describe('restoreSession', () => {
  it('exchanges a persisted refresh token for a live session', async () => {
    useAuthStore.setState({ refreshToken: 'persisted-token' })

    await restoreSession()

    expect(useAuthStore.getState().isAuthenticated).toBe(true)
    expect(useAuthStore.getState().accessToken).toBeTruthy()
  })

  it('clears state when the refresh token is rejected', async () => {
    server.use(
      http.post('*/api/v1/auth/refresh', () =>
        HttpResponse.json(
          { status: 'error', code: 'TOKEN_EXPIRED', message: 'expired', meta: {} },
          { status: 401 },
        ),
      ),
    )
    useAuthStore.setState({ refreshToken: 'stale-token' })

    await restoreSession()

    expect(useAuthStore.getState().isAuthenticated).toBe(false)
    expect(useAuthStore.getState().refreshToken).toBeNull()
  })

  it('is a no-op with no persisted token', async () => {
    await restoreSession()
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
  })
})
