import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from 'vitest'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import {
  listProviders,
  listModels,
  createProvider,
  updateProvider,
  buildProviderPayload,
  createModel,
  updateModel,
  promoteModel,
  buildModelPayload,
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
        ok([{ id: 1, name: 'OpenAI', type: 'openai', isEnabled: true, priority: 1 }]),
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
            id: 1, name: 'gpt-4o', providerId: 1,
            capabilities: ['chat'], isDefault: true,
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

describe('buildProviderPayload', () => {
  const base = { name: 'OpenAI', type: 'openai', isEnabled: true, priority: 1 }

  it('omits blank baseUrl and apiKey instead of sending empty strings', () => {
    const payload = buildProviderPayload({ ...base, baseUrl: '', apiKey: '' })
    expect(payload).not.toHaveProperty('baseUrl')
    expect(payload).not.toHaveProperty('apiKey')
  })

  it('omits monthlyBudgetUsd when null or not positive', () => {
    expect(buildProviderPayload({ ...base, monthlyBudgetUsd: null })).not.toHaveProperty('monthlyBudgetUsd')
    expect(buildProviderPayload({ ...base, monthlyBudgetUsd: 0 })).not.toHaveProperty('monthlyBudgetUsd')
  })

  it('includes provided values and trims strings', () => {
    const payload = buildProviderPayload({
      ...base,
      name: '  OpenAI Prod  ',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-123',
      monthlyBudgetUsd: 500,
    })
    expect(payload).toEqual({
      name: 'OpenAI Prod',
      type: 'openai',
      isEnabled: true,
      priority: 1,
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-123',
      monthlyBudgetUsd: 500,
    })
  })
})

describe('llm provider mutations', () => {
  it('createProvider POSTs and returns the created provider', async () => {
    server.use(
      http.post('*/api/v1/llm/providers', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>
        expect(body).not.toHaveProperty('apiKey') // blank key stripped
        return ok({ id: 9, name: body.name, type: body.type, isEnabled: true, priority: 0 })
      }),
    )
    const result = await createProvider({
      name: 'Anthropic',
      type: 'anthropic',
      apiKey: '',
      isEnabled: true,
      priority: 0,
    })
    expect(result.id).toBe(9)
    expect(result.name).toBe('Anthropic')
  })

  it('updateProvider PATCHes the target id', async () => {
    server.use(
      http.patch('*/api/v1/llm/providers/3', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>
        expect(body.priority).toBe(5)
        return ok({ id: 3, name: 'Azure', type: 'azure', isEnabled: false, priority: 5 })
      }),
    )
    const result = await updateProvider(3, {
      name: 'Azure',
      type: 'azure',
      apiKey: '',
      isEnabled: false,
      priority: 5,
    })
    expect(result.priority).toBe(5)
  })
})

describe('buildModelPayload', () => {
  const base = {
    name: 'gpt-4o',
    providerId: 1,
    capabilities: ['chat'],
    isDefault: false,
  }

  it('omits contextWindowTokens when null or not positive', () => {
    expect(buildModelPayload({ ...base, contextWindowTokens: null })).not.toHaveProperty('contextWindowTokens')
    expect(buildModelPayload({ ...base, contextWindowTokens: 0 })).not.toHaveProperty('contextWindowTokens')
  })

  it('keeps a zero price (nonnegative) but omits a null price', () => {
    const payload = buildModelPayload({
      ...base,
      inputPricePerMillion: 0,
      outputPricePerMillion: null,
    })
    expect(payload.inputPricePerMillion).toBe(0)
    expect(payload).not.toHaveProperty('outputPricePerMillion')
  })
})

describe('llm model mutations', () => {
  it('createModel POSTs to /llm/models', async () => {
    server.use(
      http.post('*/api/v1/llm/models', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>
        expect(body.providerId).toBe(2)
        return ok({ id: 10, name: body.name, providerId: 2, capabilities: ['chat'], isDefault: false })
      }),
    )
    const result = await createModel({
      name: 'claude-opus',
      providerId: 2,
      capabilities: ['chat'],
      isDefault: false,
    })
    expect(result.id).toBe(10)
  })

  it('updateModel PATCHes the target id', async () => {
    server.use(
      http.patch('*/api/v1/llm/models/10', async () =>
        ok({ id: 10, name: 'claude-opus', providerId: 2, capabilities: ['chat', 'vision'], isDefault: false }),
      ),
    )
    const result = await updateModel(10, {
      name: 'claude-opus',
      providerId: 2,
      capabilities: ['chat', 'vision'],
      isDefault: false,
    })
    expect(result.capabilities).toContain('vision')
  })

  it('promoteModel POSTs to the promote sub-route', async () => {
    server.use(
      http.post('*/api/v1/llm/models/10/promote', () => ok({ id: 10, promoted: true })),
    )
    const result = await promoteModel(10)
    expect(result.promoted).toBe(true)
  })
})
