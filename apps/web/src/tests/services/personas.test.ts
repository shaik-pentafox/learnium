import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from 'vitest'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import {
  listMyPersonas,
  getPersona,
  createPersona,
  updatePersona,
  buildPersonaPayload,
  personaKeys,
} from '@/services/personas'
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

describe('personas api', () => {
  it('listMyPersonas returns the personas payload', async () => {
    server.use(
      http.get('*/api/v1/personas/my', () =>
        ok({ personas: [{ id: 1, name: 'Coach' }], total: 1 }),
      ),
    )
    const result = await listMyPersonas()
    expect(result.total).toBe(1)
    expect(result.personas[0].name).toBe('Coach')
  })

  it('getPersona returns the full persona', async () => {
    server.use(
      http.get('*/api/v1/personas/7', () =>
        ok({ id: 7, name: 'Angry Customer', systemPrompt: 'You are angry.' }),
      ),
    )
    const result = await getPersona(7)
    expect(result.id).toBe(7)
    expect(result.systemPrompt).toBe('You are angry.')
  })

  it('personaKeys compose off the root namespace', () => {
    expect(personaKeys.mine()).toEqual([...queryKeys.personas, 'mine'])
    expect(personaKeys.detail(3)).toEqual([...queryKeys.personas, 'detail', 3])
  })
})

describe('buildPersonaPayload', () => {
  const base = { name: 'Angry Customer', systemPrompt: 'You are angry.', scoreCriteria: [] }

  it('trims name/systemPrompt and omits blank optionals', () => {
    const payload = buildPersonaPayload({
      ...base,
      name: '  Angry Customer  ',
      systemPrompt: '  You are angry.  ',
      description: '   ',
      customInstructions: '',
    })
    expect(payload.name).toBe('Angry Customer')
    expect(payload.systemPrompt).toBe('You are angry.')
    expect(payload).not.toHaveProperty('description')
    expect(payload).not.toHaveProperty('customInstructions')
  })

  it('omits unset model roles so the default model resolves', () => {
    const payload = buildPersonaPayload({
      ...base,
      conversationModelId: null,
      scoringModelId: undefined,
    })
    expect(payload).not.toHaveProperty('conversationModelId')
    expect(payload).not.toHaveProperty('scoringModelId')
  })

  it('includes set model roles', () => {
    const payload = buildPersonaPayload({ ...base, conversationModelId: 2, scoringModelId: 5 })
    expect(payload.conversationModelId).toBe(2)
    expect(payload.scoringModelId).toBe(5)
  })

  it('drops blank-named rubric rows and re-indexes order', () => {
    const payload = buildPersonaPayload({
      ...base,
      scoreCriteria: [
        { name: 'Empathy', maxScore: 10, weight: 1, order: 0 },
        { name: '  ', maxScore: 5, weight: 1, order: 1 },
        { name: 'Resolution', description: ' closed it ', maxScore: 20, weight: 2, order: 2 },
      ],
    })
    expect(payload.scoreCriteria).toHaveLength(2)
    expect(payload.scoreCriteria?.[0]).toEqual({ name: 'Empathy', maxScore: 10, weight: 1, order: 0 })
    expect(payload.scoreCriteria?.[1]).toEqual({
      name: 'Resolution',
      maxScore: 20,
      weight: 2,
      order: 1,
      description: 'closed it',
    })
  })

  it('omits an empty rubric entirely', () => {
    const payload = buildPersonaPayload(base)
    expect(payload).not.toHaveProperty('scoreCriteria')
  })
})

describe('persona mutations', () => {
  it('createPersona POSTs the built payload', async () => {
    server.use(
      http.post('*/api/v1/personas', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>
        expect(body.name).toBe('Angry Customer')
        expect(body).not.toHaveProperty('description')
        return ok({ id: 12, name: body.name, systemPrompt: body.systemPrompt })
      }),
    )
    const result = await createPersona({
      name: 'Angry Customer',
      systemPrompt: 'You are angry.',
      description: '',
      scoreCriteria: [],
    })
    expect(result.id).toBe(12)
  })

  it('updatePersona PATCHes the target id', async () => {
    server.use(
      http.patch('*/api/v1/personas/12', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>
        expect(body.name).toBe('Calmer Customer')
        return ok({ id: 12, name: body.name, systemPrompt: body.systemPrompt })
      }),
    )
    const result = await updatePersona(12, {
      name: 'Calmer Customer',
      systemPrompt: 'You are mildly annoyed.',
      scoreCriteria: [],
    })
    expect(result.name).toBe('Calmer Customer')
  })
})
