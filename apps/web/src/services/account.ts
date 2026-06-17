import { apiGet, apiPatch, apiPost } from '@/lib/api-client'
import { queryKeys } from '@/lib/query-keys'

/** Current user's profile (from GET /auth/me). */
export interface Account {
  id: number
  employeeId: string
  email: string
  firstName: string
  lastName: string
  avatarUrl: string | null
  role: string
  username: string | null
}

export interface ProfileInput {
  firstName: string
  lastName: string
  email: string
}

export interface ChangePasswordInput {
  currentPassword: string
  newPassword: string
}

/** GET /auth/me — the authenticated user's profile. */
export async function getMe(): Promise<Account> {
  return apiGet<Account>('/auth/me')
}

/** PATCH /auth/me — update own name/email. */
export async function updateProfile(input: ProfileInput): Promise<Account> {
  return apiPatch<Account>('/auth/me', input)
}

/** POST /auth/change-password — rotate own password. */
export async function changePassword(
  input: ChangePasswordInput,
): Promise<{ changed: boolean }> {
  return apiPost<{ changed: boolean }>('/auth/change-password', input)
}

export const accountKeys = {
  me: () => [...queryKeys.auth, 'me'] as const,
}
