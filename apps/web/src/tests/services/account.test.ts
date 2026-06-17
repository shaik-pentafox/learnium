import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from 'vitest'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import {
  getMe,
  updateProfile,
  changePassword,
  accountKeys,
} from '@/services/account'
import { useAuthStore } from '@/stores/auth'
import { queryKeys } from '@/lib/query-keys'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
beforeEach(() => useAuthStore.setState({ accessToken: 't', refreshToken: 'r' }))

function ok<T>(data: T) {
  return HttpResponse.json({ status: 'success', message: 'OK', data, meta: {} })
}

const PROFILE = {
  id: 1,
  employeeId: 'E-001',
  email: 'admin@alfa.io',
  firstName: 'Ada',
  lastName: 'Admin',
  avatarUrl: null,
  role: 'SUPER_ADMIN',
  username: 'admin',
}

describe('account service', () => {
  it('getMe returns the profile', async () => {
    server.use(http.get('*/api/v1/auth/me', () => ok(PROFILE)))
    const result = await getMe()
    expect(result.email).toBe('admin@alfa.io')
    expect(result.role).toBe('SUPER_ADMIN')
  })

  it('updateProfile PATCHes /auth/me and returns the updated profile', async () => {
    server.use(
      http.patch('*/api/v1/auth/me', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>
        return ok({ ...PROFILE, ...body })
      }),
    )
    const result = await updateProfile({
      firstName: 'Grace',
      lastName: 'Admin',
      email: 'grace@alfa.io',
    })
    expect(result.firstName).toBe('Grace')
    expect(result.email).toBe('grace@alfa.io')
  })

  it('changePassword POSTs current + new password', async () => {
    server.use(
      http.post('*/api/v1/auth/change-password', async ({ request }) => {
        const body = (await request.json()) as { currentPassword: string; newPassword: string }
        expect(body.currentPassword).toBe('old-pw')
        expect(body.newPassword).toBe('new-pw-123')
        return ok({ changed: true })
      }),
    )
    const result = await changePassword({
      currentPassword: 'old-pw',
      newPassword: 'new-pw-123',
    })
    expect(result.changed).toBe(true)
  })

  it('accountKeys.me composes off the auth namespace', () => {
    expect(accountKeys.me()).toEqual([...queryKeys.auth, 'me'])
  })
})
