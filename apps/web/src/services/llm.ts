import { apiGet, apiPost, apiPatch, apiDelete } from '@/lib/api-client'
import { queryKeys } from '@/lib/query-keys'

export type ModelKind = 'chat' | 'voice'

/** Seeded catalog entry the admin configures a provider FROM. */
export interface MasterProvider {
  id: number
  key: string
  name: string
  adapterType: string
  defaultBaseUrl?: string | null
  supports: string[] // ['chat'] | ['chat','voice'] | ['voice']
  /** Configured LlmProvider ids already created from this master. */
  configuredProviderIds: number[]
}

/** Seeded catalog model (chat or voice) under a master provider. */
export interface MasterModel {
  id: number
  masterProviderId: number
  key: string
  name: string
  kind: ModelKind
  contextWindowTokens?: number | null
  inputPricePerMillion?: number | null
  outputPricePerMillion?: number | null
  voicePipeline?: string | null // 's2s' | 'stt+tts'
  languages: string[]
  voices: string[]
}

export interface LlmProvider {
  id: number
  name: string
  type: string
  baseUrl?: string | null
  /** Masked API key for display, e.g. "sk-…abc4". */
  credentialHint?: string | null
  isEnabled: boolean
  monthlyBudgetUsd?: number | null
  masterProviderId?: number | null
  masterProvider?: Pick<MasterProvider, 'id' | 'key' | 'name' | 'adapterType' | 'supports'> | null
}

export interface LlmModel {
  id: number
  name: string
  providerId: number
  provider?: { id: number; name: string }
  kind: ModelKind
  capabilities: string[]
  contextWindowTokens?: number | null
  inputPricePerMillion?: number | null
  outputPricePerMillion?: number | null
  isDefault: boolean
  masterModelId?: number | null
  masterModel?: Pick<
    MasterModel,
    'id' | 'key' | 'name' | 'kind' | 'voicePipeline' | 'languages' | 'voices'
  > | null
}

/** GET /llm/masters/providers — the seeded catalog to configure from. */
export async function listMasterProviders(): Promise<MasterProvider[]> {
  return apiGet<MasterProvider[]>('/llm/masters/providers')
}

/** GET /llm/masters/models — master models addable for a configured provider. */
export async function listMasterModels(
  providerId: number,
  kind?: ModelKind,
): Promise<MasterModel[]> {
  return apiGet<MasterModel[]>('/llm/masters/models', {
    params: { providerId, ...(kind ? { kind } : {}) },
  })
}

/** Create input: pick a master, supply the key. Name/baseUrl default from master. */
export interface CreateProviderInput {
  /** Master-catalog path: pick a seeded provider. */
  masterProviderId?: number
  /** Custom path (no master): declare the adapter + name yourself. */
  adapterType?: 'openai' | 'gemini' | 'anthropic' | 'custom'
  apiKey: string
  name?: string
  baseUrl?: string
  isEnabled: boolean
  monthlyBudgetUsd?: number | null
}

/** Update input: `apiKey` present = key rotation; master/type never change. */
export interface UpdateProviderInput {
  name?: string
  baseUrl?: string | null
  apiKey?: string
  isEnabled?: boolean
  monthlyBudgetUsd?: number | null
}

/** GET /llm/providers — configured providers (api keys never returned). */
export async function listProviders(): Promise<LlmProvider[]> {
  return apiGet<LlmProvider[]>('/llm/providers')
}

/** POST /llm/providers — configure a provider from a master + API key. */
export async function createProvider(
  input: CreateProviderInput,
): Promise<LlmProvider> {
  const payload: Record<string, unknown> = {
    apiKey: input.apiKey.trim(),
    isEnabled: input.isEnabled,
  }
  if (input.masterProviderId != null) payload['masterProviderId'] = input.masterProviderId
  else if (input.adapterType) payload['adapterType'] = input.adapterType
  const name = input.name?.trim()
  if (name) payload['name'] = name
  const baseUrl = input.baseUrl?.trim()
  if (baseUrl) payload['baseUrl'] = baseUrl
  if (input.monthlyBudgetUsd != null && input.monthlyBudgetUsd > 0) {
    payload['monthlyBudgetUsd'] = input.monthlyBudgetUsd
  }
  return apiPost<LlmProvider>('/llm/providers', payload)
}

/** PATCH /llm/providers/:id — rename, rotate key, toggle, budget. */
export async function updateProvider(
  id: number,
  input: UpdateProviderInput,
): Promise<LlmProvider> {
  const payload: Record<string, unknown> = {}
  const name = input.name?.trim()
  if (name) payload['name'] = name
  if ('baseUrl' in input) {
    const baseUrl = input.baseUrl?.trim()
    payload['baseUrl'] = baseUrl || null
  }
  const apiKey = input.apiKey?.trim()
  if (apiKey) payload['apiKey'] = apiKey
  if (input.isEnabled !== undefined) payload['isEnabled'] = input.isEnabled
  if ('monthlyBudgetUsd' in input) {
    payload['monthlyBudgetUsd'] =
      input.monthlyBudgetUsd != null && input.monthlyBudgetUsd > 0
        ? input.monthlyBudgetUsd
        : null
  }
  return apiPatch<LlmProvider>(`/llm/providers/${id}`, payload)
}

/** GET /llm/models — configured models with provider + master info. */
export async function listModels(kind?: ModelKind): Promise<LlmModel[]> {
  return apiGet<LlmModel[]>('/llm/models', {
    params: kind ? { kind } : {},
  })
}

/** POST /llm/models — register a model from the master catalog (masterModelId),
 *  or a custom model (name + kind, chat only). */
export async function createModel(input: {
  providerId: number
  masterModelId?: number
  name?: string
  kind?: ModelKind
  capabilities?: string[]
  contextWindowTokens?: number
  inputPricePerMillion?: number
  outputPricePerMillion?: number
  isDefault?: boolean
}): Promise<LlmModel> {
  return apiPost<LlmModel>('/llm/models', input)
}

/** DELETE /llm/models/:id — remove a model. Persona refs to it fall back to the
 *  primary; a removed primary is auto-replaced server-side. */
export async function deleteModel(
  id: number,
): Promise<{ id: number; deleted: boolean; kind: ModelKind }> {
  return apiDelete<{ id: number; deleted: boolean; kind: ModelKind }>(
    `/llm/models/${id}`,
  )
}

/** POST /llm/providers/:id/test — live key/connectivity probe (no token spend). */
export async function testProvider(
  id: number,
): Promise<{ ok: boolean; status?: number; message: string }> {
  return apiPost<{ ok: boolean; status?: number; message: string }>(
    `/llm/providers/${id}/test`,
  )
}

/** POST /llm/models/:id/promote — make this the primary of ITS kind. */
export async function promoteModel(
  id: number,
): Promise<{ id: number; promoted: boolean; kind: ModelKind }> {
  return apiPost<{ id: number; promoted: boolean; kind: ModelKind }>(
    `/llm/models/${id}/promote`,
  )
}

// ── Usage telemetry ──────────────────────────────────────────────────────────

export interface UsageTotals {
  calls: number
  totalTokens: number
  costUsd: number
}

export interface UsageByModel {
  modelName: string
  calls: number
  totalTokens: number
  costUsd: number
  /** Avg generation latency (ms) for this model — null if none recorded. */
  avgLatencyMs: number | null
}

export interface UsageRow {
  id: number
  kind: string
  modelName: string
  sessionId: number | null
  userId: number | null
  inputTokens: number
  outputTokens: number
  totalTokens: number
  costUsd: number
  estimated: boolean
  latencyMs: number | null
  createdAt: string
}

export interface UsageSeriesPoint {
  date: string
  calls: number
  totalTokens: number
  costUsd: number
}

/** A named usage slice (by provider / kind), share of the totals. */
export interface UsageBucket {
  label: string
  calls: number
  totalTokens: number
  costUsd: number
}

/** One day of usage for a single model/provider (flat; pivoted client-side). */
export interface UsageKeySeriesPoint {
  date: string
  key: string
  calls: number
  totalTokens: number
  costUsd: number
}

export interface UsageSummary {
  since: string
  until?: string
  totals: UsageTotals
  byModel: UsageByModel[]
  byProvider: UsageBucket[]
  byKind: UsageBucket[]
  series: UsageSeriesPoint[]
  seriesByModel: UsageKeySeriesPoint[]
  seriesByProvider: UsageKeySeriesPoint[]
  recent: UsageRow[]
}

export interface UsageParams {
  days?: number
  limit?: number
  /** ISO date (YYYY-MM-DD). Explicit range wins over `days`. */
  from?: string
  to?: string
}

/** GET /llm/usage — token/cost totals, per-model breakdown, recent calls. */
export async function listUsage(params: UsageParams = {}): Promise<UsageSummary> {
  return apiGet<UsageSummary>('/llm/usage', { params })
}

export interface UsageCallsData {
  rows: UsageRow[]
  total: number
  page: number
  limit: number
  totalPages: number
  /** Distinct values available for each filter, regardless of active filter. */
  facets: { kinds: string[]; models: string[] }
}

export interface UsageCallsParams {
  page?: number
  limit?: number
  kind?: string[]
  model?: string[]
}

/** GET /llm/usage/calls — paginated, kind/model-filterable call log. */
export async function listUsageCalls(
  params: UsageCallsParams = {},
): Promise<UsageCallsData> {
  const { page, limit, kind, model } = params
  return apiGet<UsageCallsData>('/llm/usage/calls', {
    params: {
      ...(page ? { page } : {}),
      ...(limit ? { limit } : {}),
      ...(kind && kind.length ? { kind: kind.join(',') } : {}),
      ...(model && model.length ? { model: model.join(',') } : {}),
    },
  })
}

export const llmKeys = {
  providers: () => [...queryKeys.llmOps, 'providers'] as const,
  models: () => [...queryKeys.llmOps, 'models'] as const,
  masterProviders: () => [...queryKeys.llmOps, 'master-providers'] as const,
  masterModels: (providerId: number, kind?: ModelKind) =>
    [...queryKeys.llmOps, 'master-models', providerId, kind ?? 'all'] as const,
  usage: (params: UsageParams) => [...queryKeys.llmOps, 'usage', params] as const,
  usageCalls: (params: UsageCallsParams) =>
    [...queryKeys.llmOps, 'usage-calls', params] as const,
}
