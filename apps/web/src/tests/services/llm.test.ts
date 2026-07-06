import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from 'vitest'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import {
  listProviders,
  listModels,
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
  it('listProviders returns the provider array', async () => {
    server.use(
      http.get('*/api/v1/llm/providers', () =>
        ok([{ id: 1, name: 'OpenAI', type: 'openai', isEnabled: true }]),
      ),
    )
    const result = await listProviders()
    expect(result[0].name).toBe('OpenAI')
  })

  it('listModels returns the model array', async () => {
    server.use(
      http.get('*/api/v1/llm/models', () =>
        ok([
          {
            id: 1, name: 'gpt-4o', providerId: 1, kind: 'chat',
            capabilities: ['conversation'], isDefault: true,
          },
        ]),
      ),
    )
    const result = await listModels()
    expect(result[0].isDefault).toBe(true)
  })

  it('llmKeys compose off the llm-ops namespace', () => {
    expect(llmKeys.providers()).toEqual([...queryKeys.llmOps, 'providers'])
    expect(llmKeys.models()).toEqual([...queryKeys.llmOps, 'models'])
  })
})

describe('llm provider mutations', () => {
  it('createProvider POSTs a master + key and returns the created provider', async () => {
    server.use(
      http.post('*/api/v1/llm/providers', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>
        expect(body.masterProviderId).toBe(2)
        return ok({ id: 9, name: 'Anthropic', type: 'anthropic', isEnabled: true })
      }),
    )
    const result = await createProvider({
      masterProviderId: 2,
      apiKey: '',
      isEnabled: true,
    })
    expect(result.id).toBe(9)
    expect(result.name).toBe('Anthropic')
  })

  it('updateProvider PATCHes the target id', async () => {
    server.use(
      http.patch('*/api/v1/llm/providers/3', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>
        expect(body.isEnabled).toBe(false)
        return ok({ id: 3, name: 'Azure', type: 'azure', isEnabled: false })
      }),
    )
    const result = await updateProvider(3, { name: 'Azure', isEnabled: false })
    expect(result.isEnabled).toBe(false)
  })
})

describe('llm model mutations', () => {
  it('createModel POSTs a provider + master model to /llm/models', async () => {
    server.use(
      http.post('*/api/v1/llm/models', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>
        expect(body.providerId).toBe(2)
        expect(body.masterModelId).toBe(5)
        return ok({
          id: 10, name: 'claude-opus', providerId: 2, kind: 'chat',
          capabilities: ['conversation'], isDefault: false,
        })
      }),
    )
    const result = await createModel({ providerId: 2, masterModelId: 5 })
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
