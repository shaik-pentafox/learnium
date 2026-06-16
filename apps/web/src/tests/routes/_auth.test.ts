import { describe, it, expect, beforeEach } from 'vitest'
import { Route } from '@/routes/_auth'
import { useAuthStore } from '@/stores/auth'

// The guard reads the auth store synchronously — no router/MSW needed.
function runGuard(): unknown {
  const beforeLoad = Route.options.beforeLoad as () => void
  try {
    beforeLoad()
    return null
  } catch (thrown) {
    return thrown
  }
}

describe('_auth route guard', () => {
  beforeEach(() => {
    useAuthStore.getState().clear()
  })

  it('redirects to /login when unauthenticated', () => {
    const result = runGuard() as { to?: string; options?: { to?: string } }
    const to = result?.to ?? result?.options?.to
    expect(to).toBe('/login')
  })

  it('allows access when authenticated', () => {
    useAuthStore.setState({ isAuthenticated: true })
    expect(runGuard()).toBeNull()
  })
})
