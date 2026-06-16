import { apiGet } from '@/lib/api-client'
import { queryKeys } from '@/lib/query-keys'

export interface PersonaSummary {
  id: number
  name: string
  description?: string | null
}

interface MyPersonasData {
  personas: PersonaSummary[]
  total: number
}

/** GET /personas/my — trainee sees their assigned persona; trainer/admin see all. */
export async function listMyPersonas(): Promise<MyPersonasData> {
  return apiGet<MyPersonasData>('/personas/my')
}

export const personaKeys = {
  mine: () => [...queryKeys.personas, 'mine'] as const,
}
