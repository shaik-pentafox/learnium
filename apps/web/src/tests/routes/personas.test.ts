import { describe, it, expect, beforeEach } from 'vitest'
import { Route as ListRoute } from '@/routes/_auth/personas/index'
import { Route as EditRoute } from '@/routes/_auth/personas/$id'
import { Route as NewRoute } from '@/routes/_auth/personas/new'
import { useAuthStore } from '@/stores/auth'
import type { UserRole } from '@/stores/auth'

// Guards read the auth store synchronously — no router/MSW needed.
function runGuard(route: { options: { beforeLoad?: unknown } }): unknown {
  const beforeLoad = route.options.beforeLoad as () => void
  try {
    beforeLoad()
    return null
  } catch (thrown) {
    return thrown
  }
}

function setRole(role: UserRole) {
  useAuthStore.setState({
    isAuthenticated: true,
    user: { id: 1, name: 'T', role },
  })
}

const AUTHORING_ROUTES = [
  ['list', ListRoute],
  ['edit', EditRoute],
  ['new', NewRoute],
] as const

describe('persona authoring guards', () => {
  beforeEach(() => {
    useAuthStore.getState().clear()
  })

  for (const [label, route] of AUTHORING_ROUTES) {
    it(`bounces trainees from the ${label} route to /dashboard`, () => {
      setRole('USER')
      const result = runGuard(route) as { to?: string; options?: { to?: string } }
      const to = result?.to ?? result?.options?.to
      expect(to).toBe('/dashboard')
    })

    it(`allows trainers on the ${label} route`, () => {
      setRole('TRAINER')
      expect(runGuard(route)).toBeNull()
    })

    it(`allows admins on the ${label} route`, () => {
      setRole('SUPER_ADMIN')
      expect(runGuard(route)).toBeNull()
    })
  }
})
