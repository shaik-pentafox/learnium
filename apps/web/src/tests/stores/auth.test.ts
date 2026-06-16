import { describe, it, expect, beforeEach } from 'vitest'
import { useAuthStore, loadPersistedAuth } from '@/stores/auth'

function makeToken(payload: object): string {
  const b64 = (o: object) =>
    btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `${b64({ alg: 'none' })}.${b64(payload)}.sig`
}

describe('auth store', () => {
  beforeEach(() => {
    localStorage.clear()
    useAuthStore.getState().clear()
  })

  it('derives user id + role from the access token and keeps the name', () => {
    const accessToken = makeToken({ sub: 7, role: 'USER' })
    useAuthStore.getState().setSession({ accessToken, refreshToken: 'r1' }, 'jdoe')

    const { user, isAuthenticated } = useAuthStore.getState()
    expect(isAuthenticated).toBe(true)
    expect(user).toEqual({ id: 7, role: 'USER', name: 'jdoe' })
  })

  it('persists only the refresh token + name to localStorage', () => {
    const accessToken = makeToken({ sub: 7, role: 'USER' })
    useAuthStore.getState().setSession({ accessToken, refreshToken: 'r1' }, 'jdoe')

    expect(loadPersistedAuth()).toEqual({ refreshToken: 'r1', name: 'jdoe' })
  })

  it('refuses a session built from an undecodable token', () => {
    useAuthStore
      .getState()
      .setSession({ accessToken: 'garbage', refreshToken: 'r1' }, 'jdoe')

    expect(useAuthStore.getState().isAuthenticated).toBe(false)
    expect(loadPersistedAuth()).toBeNull()
  })

  it('clear wipes memory and storage', () => {
    const accessToken = makeToken({ sub: 7, role: 'USER' })
    useAuthStore.getState().setSession({ accessToken, refreshToken: 'r1' }, 'jdoe')
    useAuthStore.getState().clear()

    expect(useAuthStore.getState().user).toBeNull()
    expect(useAuthStore.getState().refreshToken).toBeNull()
    expect(loadPersistedAuth()).toBeNull()
  })
})
