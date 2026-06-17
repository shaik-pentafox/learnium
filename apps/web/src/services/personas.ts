import { apiGet, apiPost, apiPatch } from '@/lib/api-client'
import { queryKeys } from '@/lib/query-keys'

export interface ScoreCriterion {
  id: number
  name: string
  description?: string | null
  maxScore: number
  weight: number
  order: number
}

export interface PersonaSummary {
  id: number
  name: string
  description?: string | null
}

export interface Persona {
  id: number
  name: string
  description?: string | null
  systemPrompt: string
  customInstructions?: string | null
  voiceStyleId?: number | null
  conversationModelId?: number | null
  scoringModelId?: number | null
  scoreCriteria?: ScoreCriterion[]
}

interface MyPersonasData {
  personas: PersonaSummary[]
  total: number
}

/** GET /personas/my — trainee sees their assigned persona; trainer/admin see all. */
export async function listMyPersonas(): Promise<MyPersonasData> {
  return apiGet<MyPersonasData>('/personas/my')
}

/** GET /personas/:id — full persona incl. rubric (personas:read). */
export async function getPersona(id: number): Promise<Persona> {
  return apiGet<Persona>(`/personas/${id}`)
}

/** A single rubric row, form-shaped. */
export interface ScoreCriterionInput {
  name: string
  description?: string
  maxScore: number
  weight: number
  order: number
}

/** Form-shaped persona input for the builder (create + edit). */
export interface PersonaInput {
  name: string
  description?: string
  systemPrompt: string
  customInstructions?: string
  /** null/undefined → the registry default model is used. */
  conversationModelId?: number | null
  scoringModelId?: number | null
  scoreCriteria: ScoreCriterionInput[]
}

interface PersonaPayload {
  name: string
  systemPrompt: string
  description?: string
  customInstructions?: string
  conversationModelId?: number
  scoringModelId?: number
  scoreCriteria?: ScoreCriterionInput[]
}

/**
 * Strip optional fields the API rejects as empty: blank `description` /
 * `customInstructions` (omitted, not sent as ''), unset model roles (omitted
 * so the default model resolves), and rubric rows with a blank name (the
 * backend `ScoreCriterionSchema` requires `name.min(1)`). An empty rubric is
 * omitted entirely.
 */
export function buildPersonaPayload(input: PersonaInput): PersonaPayload {
  const payload: PersonaPayload = {
    name: input.name.trim(),
    systemPrompt: input.systemPrompt.trim(),
  }
  const description = input.description?.trim()
  if (description) payload.description = description
  const customInstructions = input.customInstructions?.trim()
  if (customInstructions) payload.customInstructions = customInstructions
  if (input.conversationModelId != null) {
    payload.conversationModelId = input.conversationModelId
  }
  if (input.scoringModelId != null) {
    payload.scoringModelId = input.scoringModelId
  }
  const criteria = input.scoreCriteria
    .filter((c) => c.name.trim())
    .map((c, i) => {
      const row: ScoreCriterionInput = {
        name: c.name.trim(),
        maxScore: c.maxScore,
        weight: c.weight,
        order: i,
      }
      const desc = c.description?.trim()
      if (desc) row.description = desc
      return row
    })
  if (criteria.length) payload.scoreCriteria = criteria
  return payload
}

/** POST /personas — author a new persona (personas:write). */
export async function createPersona(input: PersonaInput): Promise<Persona> {
  return apiPost<Persona>('/personas', buildPersonaPayload(input))
}

/** PATCH /personas/:id — update an existing persona (snapshots a version). */
export async function updatePersona(
  id: number,
  input: PersonaInput,
): Promise<Persona> {
  return apiPatch<Persona>(`/personas/${id}`, buildPersonaPayload(input))
}

export const personaKeys = {
  mine: () => [...queryKeys.personas, 'mine'] as const,
  detail: (id: number) => [...queryKeys.personas, 'detail', id] as const,
}
