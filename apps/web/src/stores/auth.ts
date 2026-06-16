import { create } from 'zustand'

export type UserRole = 'SUPER_ADMIN' | 'TRAINER' | 'USER'

export interface AuthUser {
  id: string
  email: string
  name: string
  role: UserRole
}

interface AuthState {
  user: AuthUser | null
  accessToken: string | null
  isAuthenticated: boolean
  setAuth: (user: AuthUser, accessToken: string) => void
  setAccessToken: (accessToken: string) => void
  clear: () => void
}

/**
 * Auth slice — client state only. The access token lives in memory (never
 * localStorage); the refresh token rides in an httpOnly cookie. Server data
 * (the user record) is mirrored here from the login/refresh response so route
 * guards can read role synchronously.
 */
export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  accessToken: null,
  isAuthenticated: false,
  setAuth: (user, accessToken) =>
    set({ user, accessToken, isAuthenticated: true }),
  setAccessToken: (accessToken) => set({ accessToken }),
  clear: () => set({ user: null, accessToken: null, isAuthenticated: false }),
}))
