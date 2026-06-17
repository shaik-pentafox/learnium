import { apiGet } from '@/lib/api-client'
import { queryKeys } from '@/lib/query-keys'

export type RoleName = 'SUPER_ADMIN' | 'TRAINER' | 'USER'

export interface Role {
  id: number
  name: RoleName
}

/** GET /roles — the fixed role registry (SUPER_ADMIN, TRAINER, USER). */
export async function listRoles(): Promise<Role[]> {
  return apiGet<Role[]>('/roles')
}

export const roleKeys = {
  all: () => [...queryKeys.users, 'roles'] as const,
}

const ROLE_LABELS: Record<RoleName, string> = {
  SUPER_ADMIN: 'Super Admin',
  TRAINER: 'Trainer',
  USER: 'Trainee',
}

export function roleLabel(name: string): string {
  return ROLE_LABELS[name as RoleName] ?? name
}
