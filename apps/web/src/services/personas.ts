import { apiGet, apiPost, apiPatch } from '@/lib/api-client'
import { queryKeys } from '@/lib/query-keys'

/** Mirrors the backend PersonaTemplateSchema (core/llm/persona-prompt.template). */
export const CHANNELS = ['chat', 'audio'] as const
export type Channel = (typeof CHANNELS)[number]

export const EMOTIONS = [
  'calm',
  'confused',
  'frustrated',
  'angry',
  'anxious',
] as const
export type Emotion = (typeof EMOTIONS)[number]

export interface PersonaTemplate {
  customerName?: string
  customerProfile: string
  company: string
  productContext?: string
  issue: string
  channel: Channel
  emotion: Emotion
  intensity: number
  desiredOutcome: string
  hiddenDetails?: string
  behaviorNotes?: string
  resolutionCriteria: string
  additionalInstructions?: string
  /** Optional fixed opener; blank → the model improvises the customer's first line. */
  openingMessage?: string
}

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
  color?: string | null
  isPublished?: boolean
  /** True when the viewer may test but not edit (e.g. trainer viewing a super-admin persona). */
  readonly?: boolean
}

export interface Persona {
  id: number
  name: string
  description?: string | null
  /** Accent color for the chat orb (#RRGGBB). */
  color?: string | null
  /** Structured authoring fields (source of truth). Null for any legacy persona. */
  templateData?: PersonaTemplate | null
  /** Server-rendered prompt cache — read-only preview. */
  systemPrompt?: string | null
  conversationModelId?: number | null
  scoringModelId?: number | null
  scoreCriteria?: ScoreCriterion[]
  /** Whether the persona is visible to trainees. */
  isPublished?: boolean
}

interface MyPersonasData {
  personas: PersonaSummary[]
  total: number
}

/** GET /personas/my — trainee: published personas of own trainer or super admin; trainer/admin: own/all. */
export async function listMyPersonas(): Promise<MyPersonasData> {
  return apiGet<MyPersonasData>('/personas/my')
}

/** GET /personas/:id — full persona incl. template + rubric (personas:read). */
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
  /** Accent color for the chat orb (#RRGGBB). */
  color?: string | null
  template: PersonaTemplate
  /** null/undefined → the registry default model is used. */
  conversationModelId?: number | null
  scoringModelId?: number | null
  scoreCriteria: ScoreCriterionInput[]
}

interface PersonaPayload {
  name: string
  template: PersonaTemplate
  description?: string
  color?: string
  conversationModelId?: number
  scoringModelId?: number
  scoreCriteria?: ScoreCriterionInput[]
  isPublished?: boolean
}

// Optional template fields are omitted (not sent blank) so the backend schema,
// which marks them `.optional()`, treats them as absent.
const OPTIONAL_TEMPLATE_KEYS = [
  'customerName',
  'productContext',
  'hiddenDetails',
  'behaviorNotes',
  'additionalInstructions',
  'openingMessage',
] as const

/** Trim required fields; drop blank optional fields entirely. */
function buildTemplatePayload(t: PersonaTemplate): PersonaTemplate {
  const out: PersonaTemplate = {
    customerProfile: t.customerProfile.trim(),
    company: t.company.trim(),
    issue: t.issue.trim(),
    channel: t.channel,
    emotion: t.emotion,
    intensity: t.intensity,
    desiredOutcome: t.desiredOutcome.trim(),
    resolutionCriteria: t.resolutionCriteria.trim(),
  }
  for (const key of OPTIONAL_TEMPLATE_KEYS) {
    const value = t[key]?.trim()
    if (value) out[key] = value
  }
  return out
}

/**
 * Strip optional fields the API rejects as empty: blank `description` (omitted),
 * unset model roles (omitted so the default model resolves), blank optional
 * template fields, and rubric rows with a blank name (`name.min(1)`). An empty
 * rubric is omitted entirely.
 */
export function buildPersonaPayload(
  input: PersonaInput,
  isPublished?: boolean,
): PersonaPayload {
  const payload: PersonaPayload = {
    name: input.name.trim(),
    template: buildTemplatePayload(input.template),
  }
  if (isPublished !== undefined) payload.isPublished = isPublished
  const description = input.description?.trim()
  if (description) payload.description = description
  const color = input.color?.trim()
  if (color) payload.color = color
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
export async function createPersona(
  input: PersonaInput,
  publish = false,
): Promise<Persona> {
  return apiPost<Persona>('/personas', buildPersonaPayload(input, publish))
}

/** POST /personas/:id/publish — make visible to trainees (owner/admin only). */
export async function publishPersona(id: number): Promise<Persona> {
  return apiPost<Persona>(`/personas/${id}/publish`, {})
}

/** POST /personas/:id/unpublish — hide from trainees again. */
export async function unpublishPersona(id: number): Promise<Persona> {
  return apiPost<Persona>(`/personas/${id}/unpublish`, {})
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
