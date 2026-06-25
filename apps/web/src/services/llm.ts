import { apiGet, apiPost, apiPatch } from '@/lib/api-client'
import { queryKeys } from '@/lib/query-keys'

export interface LlmProvider {
  id: number
  name: string
  type: string
  baseUrl?: string | null
  isEnabled: boolean
  priority: number
  monthlyBudgetUsd?: number | null
}

export interface LlmModel {
  id: number
  name: string
  providerId: number
  provider?: { id: number; name: string }
  capabilities: string[]
  contextWindowTokens?: number | null
  inputPricePerMillion?: number | null
  outputPricePerMillion?: number | null
  isDefault: boolean
}

/** Form-shaped provider input. `apiKey` is write-only; blank means "don't change". */
export interface ProviderInput {
  name: string
  type: string
  baseUrl?: string | null
  apiKey?: string
  isEnabled: boolean
  priority: number
  monthlyBudgetUsd?: number | null
}

interface ProviderPayload {
  name: string
  type: string
  isEnabled: boolean
  priority: number
  baseUrl?: string
  apiKey?: string
  monthlyBudgetUsd?: number
}

/**
 * Strip optional fields the API rejects as empty: blank `baseUrl`/`apiKey`
 * (zod `.url()`/`.min(1)`) and a non-positive `monthlyBudgetUsd` (zod
 * `.positive()`). Omitting beats sending '' or 0 — the schema would 400.
 */
export function buildProviderPayload(input: ProviderInput): ProviderPayload {
  const payload: ProviderPayload = {
    name: input.name.trim(),
    type: input.type.trim(),
    isEnabled: input.isEnabled,
    priority: input.priority,
  }
  const baseUrl = input.baseUrl?.trim()
  if (baseUrl) payload.baseUrl = baseUrl
  const apiKey = input.apiKey?.trim()
  if (apiKey) payload.apiKey = apiKey
  if (input.monthlyBudgetUsd != null && input.monthlyBudgetUsd > 0) {
    payload.monthlyBudgetUsd = input.monthlyBudgetUsd
  }
  return payload
}

/** GET /llm/providers — provider registry (api keys never returned). */
export async function listProviders(): Promise<LlmProvider[]> {
  return apiGet<LlmProvider[]>('/llm/providers')
}

/** POST /llm/providers — register a provider. */
export async function createProvider(
  input: ProviderInput,
): Promise<LlmProvider> {
  return apiPost<LlmProvider>('/llm/providers', buildProviderPayload(input))
}

/** PATCH /llm/providers/:id — update routing/credentials. */
export async function updateProvider(
  id: number,
  input: ProviderInput,
): Promise<LlmProvider> {
  return apiPatch<LlmProvider>(
    `/llm/providers/${id}`,
    buildProviderPayload(input),
  )
}

/** GET /llm/models — model registry with provider info. */
export async function listModels(): Promise<LlmModel[]> {
  return apiGet<LlmModel[]>('/llm/models')
}

/** Form-shaped model input for the master registry. */
export interface ModelInput {
  name: string
  providerId: number
  capabilities: string[]
  contextWindowTokens?: number | null
  inputPricePerMillion?: number | null
  outputPricePerMillion?: number | null
  isDefault: boolean
}

interface ModelPayload {
  name: string
  providerId: number
  capabilities: string[]
  isDefault: boolean
  contextWindowTokens?: number
  inputPricePerMillion?: number
  outputPricePerMillion?: number
}

/**
 * Strip optional fields the API rejects: a non-positive `contextWindowTokens`
 * (zod `.positive()`). Prices are `.nonnegative()` so 0 is valid — only an
 * unset (null) price is omitted.
 */
export function buildModelPayload(input: ModelInput): ModelPayload {
  const payload: ModelPayload = {
    name: input.name.trim(),
    providerId: input.providerId,
    capabilities: input.capabilities,
    isDefault: input.isDefault,
  }
  if (input.contextWindowTokens != null && input.contextWindowTokens > 0) {
    payload.contextWindowTokens = input.contextWindowTokens
  }
  if (input.inputPricePerMillion != null) {
    payload.inputPricePerMillion = input.inputPricePerMillion
  }
  if (input.outputPricePerMillion != null) {
    payload.outputPricePerMillion = input.outputPricePerMillion
  }
  return payload
}

/** POST /llm/models — register a model in the master registry. */
export async function createModel(input: ModelInput): Promise<LlmModel> {
  return apiPost<LlmModel>('/llm/models', buildModelPayload(input))
}

/** PATCH /llm/models/:id — update a model. */
export async function updateModel(
  id: number,
  input: ModelInput,
): Promise<LlmModel> {
  return apiPatch<LlmModel>(`/llm/models/${id}`, buildModelPayload(input))
}

/** POST /llm/models/:id/promote — make this the default (clears others). */
export async function promoteModel(
  id: number,
): Promise<{ id: number; promoted: boolean }> {
  return apiPost<{ id: number; promoted: boolean }>(`/llm/models/${id}/promote`)
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
  usage: (params: UsageParams) => [...queryKeys.llmOps, 'usage', params] as const,
  usageCalls: (params: UsageCallsParams) =>
    [...queryKeys.llmOps, 'usage-calls', params] as const,
}
