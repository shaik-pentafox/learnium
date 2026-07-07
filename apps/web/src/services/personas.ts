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

export const GENDERS = ['male', 'female'] as const
export type Gender = (typeof GENDERS)[number]

export interface PersonaTemplate {
  // ── Identity ──
  customerName?: string
  /** Backend defaults to 'unspecified' when absent. */
  gender?: Gender
  /** Verifiable age (identity-verification training). */
  customerAge?: number
  /** Verifiable contact the agent may confirm (phone/email). */
  customerContact?: string
  /** Verifiable account / order / ticket reference the agent may confirm. */
  accountRef?: string
  customerProfile: string
  // ── Situation ──
  company: string
  productContext?: string
  issue: string
  /** Modalities the persona supports — text chat, voice call, or both. */
  channels: Channel[]
  // ── Emotion ──
  emotion: Emotion
  intensity: number
  /** What makes the customer angrier (escalation dynamics). */
  escalationTriggers?: string
  /** What calms the customer down (de-escalation dynamics). */
  deescalationTriggers?: string
  // ── Goal & resolution ──
  desiredOutcome: string
  resolutionCriteria: string
  /** How the customer signs off — a natural text closer before the end sentinel. */
  closingStatement?: string
  // ── Difficulty / nuance ──
  hiddenDetails?: string
  behaviorNotes?: string
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
  /** BCP-47 language codes configured for voice sessions. Empty = text-only. */
  languages?: string[]
  /** Structured authoring fields — carried in the list payload; used to tell
   *  whether voice is enabled (`channels` includes 'audio'). */
  templateData?: PersonaTemplate | null
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
  /** Selected TTS voice (FK to a VoiceStyle row) — legacy, superseded by voiceModelId. */
  voiceStyleId?: number | null
  /** Voice model pin (kind='voice' registry row). Null = primary voice model. */
  voiceModelId?: number | null
  /** Provider voice name (e.g. 'alloy', 'Puck'). Null = model's first voice. */
  voiceId?: string | null
  /** BCP-47 languages a trainee may pick for a voice session (e.g. ["hi-IN"]). */
  languages?: string[]
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
  /** Selected TTS voice (FK to a VoiceStyle row); null → no voice. Legacy. */
  voiceStyleId?: number | null
  /** Voice model pin; null → primary voice model. */
  voiceModelId?: number | null
  /** Provider voice name; null → model's first voice. */
  voiceId?: string | null
  /** BCP-47 languages offered for voice sessions. Empty → text-only. */
  languages?: string[]
  scoreCriteria: ScoreCriterionInput[]
}

interface PersonaPayload {
  name: string
  template: PersonaTemplate
  description?: string
  color?: string
  conversationModelId?: number
  scoringModelId?: number
  voiceStyleId?: number
  voiceModelId?: number
  voiceId?: string
  languages?: string[]
  scoreCriteria?: ScoreCriterionInput[]
  isPublished?: boolean
}

// Optional template fields are omitted (not sent blank) so the backend schema,
// which marks them `.optional()`, treats them as absent.
const OPTIONAL_TEMPLATE_KEYS = [
  'customerName',
  'customerContact',
  'accountRef',
  'productContext',
  'escalationTriggers',
  'deescalationTriggers',
  'closingStatement',
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
    channels: t.channels.length ? t.channels : ['chat'],
    emotion: t.emotion,
    intensity: t.intensity,
    desiredOutcome: t.desiredOutcome.trim(),
    resolutionCriteria: t.resolutionCriteria.trim(),
  }
  for (const key of OPTIONAL_TEMPLATE_KEYS) {
    const value = t[key]?.trim()
    if (value) out[key] = value
  }
  // Optional enum — only send when the trainer picked one.
  if (t.gender) out.gender = t.gender
  // Number field — send only a valid positive int (schema: min(1)).
  if (typeof t.customerAge === 'number' && Number.isInteger(t.customerAge) && t.customerAge > 0) {
    out.customerAge = t.customerAge
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
  if (input.voiceStyleId != null) {
    payload.voiceStyleId = input.voiceStyleId
  }
  if (input.voiceModelId != null) {
    payload.voiceModelId = input.voiceModelId
  }
  if (input.voiceId) {
    payload.voiceId = input.voiceId
  }
  // Only send a non-empty language set; the API rejects malformed codes.
  if (input.languages?.length) {
    payload.languages = input.languages
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
