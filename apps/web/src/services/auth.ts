import { apiPost } from '@/lib/api-client'
import { useAuthStore, type Tokens } from '@/stores/auth'

interface LoginPayload {
  username: string
  password: string
}

/** POST /auth/login → { accessToken, refreshToken }. The backend returns no
 *  user object; role + id come from decoding the access token, the display
 *  name from the entered username. */
export async function login(payload: LoginPayload): Promise<void> {
  const tokens = await apiPost<Tokens>('/auth/login', payload)
  useAuthStore.getState().setSession(tokens, payload.username)
}

/** POST /auth/logout (best-effort; clears local session regardless). */
export async function logout(): Promise<void> {
  const refreshToken = useAuthStore.getState().refreshToken
  try {
    if (refreshToken) await apiPost('/auth/logout', { refreshToken })
  } catch {
    // ignore — local clear below is authoritative for the client
  }
  useAuthStore.getState().clear()
}

/** On app load, exchange a persisted refresh token for a fresh access token so
 *  a reload doesn't force re-login. Resolves whether or not it succeeded. */
export async function restoreSession(): Promise<void> {
  const { refreshToken, isAuthenticated } = useAuthStore.getState()
  if (isAuthenticated || !refreshToken) return
  try {
    const tokens = await apiPost<Tokens>('/auth/refresh', { refreshToken })
    useAuthStore.getState().setTokens(tokens)
  } catch {
    useAuthStore.getState().clear()
  }
}
