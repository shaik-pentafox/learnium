import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from 'vitest'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import {
  listProviders,
  listModels,
  listMasterProviders,
  listMasterModels,
  createProvider,
  updateProvider,
  createModel,
  promoteModel,
  listUsage,
  llmKeys,
} from '@/services/llm'
import { useAuthStore } from '@/stores/auth'
import { queryKeys } from '@/lib/query-keys'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
beforeEach(() => useAuthStore.setState({ accessToken: 't', refreshToken: 'r' }))

function ok<T>(data: T) {
  return HttpResponse.json({ status: 'success', message: 'OK', data, meta: {} })
}

describe('llm service', () => {
  it('listProviders returns the provider array with the masked key hint', async () => {
    server.use(
      http.get('*/api/v1/llm/providers', () =>
        ok([{ id: 1, name: 'OpenAI', type: 'openai', isEnabled: true, credentialHint: 'sk-…abc4' }]),
      ),
    )
    const result = await listProviders()
    expect(result[0].name).toBe('OpenAI')
    expect(result[0].credentialHint).toBe('sk-…abc4')
  })

  it('listModels forwards the kind filter', async () => {
    server.use(
      http.get('*/api/v1/llm/models', ({ request }) => {
        expect(new URL(request.url).searchParams.get('kind')).toBe('voice')
        return ok([
          {
            id: 13, name: 'gemini-3.1-flash-live-preview', providerId: 2,
            kind: 'voice', capabilities: [], isDefault: true,
          },
        ])
      }),
    )
    const result = await listModels('voice')
    expect(result[0].kind).toBe('voice')
    expect(result[0].isDefault).toBe(true)
  })

  it('listMasterProviders returns the seeded catalog', async () => {
    server.use(
      http.get('*/api/v1/llm/masters/providers', () =>
        ok([
          {
            id: 1, key: 'openai', name: 'OpenAI', adapterType: 'openai',
            supports: ['chat', 'voice'], configuredProviderIds: [1],
          },
        ]),
      ),
    )
    const result = await listMasterProviders()
    expect(result[0].key).toBe('openai')
    expect(result[0].configuredProviderIds).toContain(1)
  })

  it('listMasterModels scopes by configured provider + kind', async () => {
    server.use(
      http.get('*/api/v1/llm/masters/models', ({ request }) => {
        const params = new URL(request.url).searchParams
        expect(params.get('providerId')).toBe('2')
        expect(params.get('kind')).toBe('voice')
        return ok([
          {
            id: 7, masterProviderId: 2, key: 'gemini-3.1-flash-live-preview',
            name: 'Gemini 3.1 Flash Live', kind: 'voice', voicePipeline: 's2s',
            languages: ['en-IN', 'hi-IN'], voices: ['Puck'],
          },
        ])
      }),
    )
    const result = await listMasterModels(2, 'voice')
    expect(result[0].voicePipeline).toBe('s2s')
  })

  it('llmKeys compose off the llm-ops namespace', () => {
    expect(llmKeys.providers()).toEqual([...queryKeys.llmOps, 'providers'])
    expect(llmKeys.models()).toEqual([...queryKeys.llmOps, 'models'])
    expect(llmKeys.masterModels(2, 'voice')).toEqual([
      ...queryKeys.llmOps, 'master-models', 2, 'voice',
    ])
  })
})

describe('llm provider mutations', () => {
  it('createProvider sends master id + key, omitting blank optional fields', async () => {
    server.use(
      http.post('*/api/v1/llm/providers', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>
        expect(body.masterProviderId).toBe(1)
        expect(body.apiKey).toBe('sk-123')
        expect(body).not.toHaveProperty('name') // blank stripped
        expect(body).not.toHaveProperty('baseUrl')
        expect(body).not.toHaveProperty('monthlyBudgetUsd')
        return ok({ id: 9, name: 'OpenAI', type: 'openai', isEnabled: true })
      }),
    )
    const result = await createProvider({
      masterProviderId: 1,
      apiKey: 'sk-123',
      name: '  ',
      baseUrl: '',
      isEnabled: true,
      monthlyBudgetUsd: 0,
    })
    expect(result.id).toBe(9)
  })

  it('updateProvider with apiKey rotates the key; blank key omitted', async () => {
    server.use(
      http.patch('*/api/v1/llm/providers/3', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>
        expect(body.apiKey).toBe('sk-new')
        expect(body.isEnabled).toBe(false)
        return ok({ id: 3, name: 'OpenAI', type: 'openai', isEnabled: false, credentialHint: 'sk-…-new' })
      }),
    )
    const result = await updateProvider(3, { apiKey: 'sk-new', isEnabled: false })
    expect(result.isEnabled).toBe(false)
  })

  it('updateProvider clears baseUrl by sending null when field present but blank', async () => {
    server.use(
      http.patch('*/api/v1/llm/providers/3', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>
        expect(body.baseUrl).toBeNull()
        expect(body).not.toHaveProperty('apiKey')
        return ok({ id: 3, name: 'OpenAI', type: 'openai', isEnabled: true })
      }),
    )
    await updateProvider(3, { baseUrl: '', apiKey: '' })
  })
})

describe('llm model mutations', () => {
  it('createModel POSTs the provider + master model pair', async () => {
    server.use(
      http.post('*/api/v1/llm/models', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>
        expect(body.providerId).toBe(2)
        expect(body.masterModelId).toBe(7)
        return ok({ id: 10, name: 'gemini-2.5-flash', providerId: 2, kind: 'chat', capabilities: [], isDefault: false })
      }),
    )
    const result = await createModel({ providerId: 2, masterModelId: 7 })
    expect(result.id).toBe(10)
  })

  it('promoteModel POSTs to the promote sub-route', async () => {
    server.use(
      http.post('*/api/v1/llm/models/10/promote', () =>
        ok({ id: 10, promoted: true, kind: 'chat' }),
      ),
    )
    const result = await promoteModel(10)
    expect(result.promoted).toBe(true)
    expect(result.kind).toBe('chat')
  })
})

describe('llm usage', () => {
  it('listUsage returns totals + per-model breakdown', async () => {
    server.use(
      http.get('*/api/v1/llm/usage', () =>
        ok({
          since: '2026-05-19T00:00:00Z',
          totals: { calls: 12, totalTokens: 9000, costUsd: 0.42 },
          byModel: [{ modelName: 'gpt-4o', calls: 12, totalTokens: 9000, costUsd: 0.42 }],
          recent: [],
        }),
      ),
    )
    const result = await listUsage({ days: 30 })
    expect(result.totals.calls).toBe(12)
    expect(result.byModel[0].modelName).toBe('gpt-4o')
  })

  it('llmKeys.usage composes off the llm-ops namespace', () => {
    expect(llmKeys.usage({ days: 7 })).toEqual([...queryKeys.llmOps, 'usage', { days: 7 }])
  })
})
