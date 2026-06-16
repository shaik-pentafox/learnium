import { create } from 'zustand'
import { decodeJwt } from '@/lib/jwt'

export type UserRole = 'SUPER_ADMIN' | 'TRAINER' | 'USER'

export interface AuthUser {
  id: number
  /** Display name. The backend has no /me endpoint and the JWT carries no
   *  name, so this is the username entered at login, persisted alongside the
   *  refresh token. */
  name: string
  role: UserRole
}

interface AuthState {
  user: AuthUser | null
  accessToken: string | null
  refreshToken: string | null
  isAuthenticated: boolean
  /** Establish a session from a login/refresh token pair. */
  setSession: (tokens: Tokens, name: string) => void
  /** Replace tokens after a silent refresh (keeps the current display name). */
  setTokens: (tokens: Tokens) => void
  clear: () => void
}

export interface Tokens {
  accessToken: string
  refreshToken: string
}

// localStorage holds only the durable refresh token + display name (per the
// chosen storage strategy — the backend returns the refresh token in the body,
// not an httpOnly cookie). The access token stays in memory.
const STORAGE_KEY = 'learnium-auth'

interface PersistedAuth {
  refreshToken: string
  name: string
}

function persist(data: PersistedAuth | null): void {
  if (data) localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  else localStorage.removeItem(STORAGE_KEY)
}

export function loadPersistedAuth(): PersistedAuth | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as PersistedAuth) : null
  } catch {
    return null
  }
}

function userFromAccessToken(
  accessToken: string,
  name: string,
): AuthUser | null {
  const claims = decodeJwt(accessToken)
  if (!claims) return null
  return { id: claims.sub, role: claims.role as UserRole, name }
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  accessToken: null,
  refreshToken: loadPersistedAuth()?.refreshToken ?? null,
  isAuthenticated: false,

  setSession: ({ accessToken, refreshToken }, name) => {
    const user = userFromAccessToken(accessToken, name)
    if (!user) {
      get().clear()
      return
    }
    persist({ refreshToken, name })
    set({ user, accessToken, refreshToken, isAuthenticated: true })
  },

  setTokens: ({ accessToken, refreshToken }) => {
    const name = get().user?.name ?? loadPersistedAuth()?.name ?? ''
    const user = userFromAccessToken(accessToken, name)
    if (!user) {
      get().clear()
      return
    }
    persist({ refreshToken, name })
    set({ user, accessToken, refreshToken, isAuthenticated: true })
  },

  clear: () => {
    persist(null)
    set({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
    })
  },
}))
