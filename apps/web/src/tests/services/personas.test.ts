import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from 'vitest'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import { listMyPersonas, personaKeys } from '@/services/personas'
import { useAuthStore } from '@/stores/auth'
import { queryKeys } from '@/lib/query-keys'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
beforeEach(() => useAuthStore.setState({ accessToken: 't', refreshToken: 'r' }))

describe('personas api', () => {
  it('listMyPersonas returns the personas payload', async () => {
    server.use(
      http.get('*/api/v1/personas/my', () =>
        HttpResponse.json({
          status: 'success',
          message: 'OK',
          data: { personas: [{ id: 1, name: 'Coach' }], total: 1 },
          meta: {},
        }),
      ),
    )

    const result = await listMyPersonas()
    expect(result.total).toBe(1)
    expect(result.personas[0].name).toBe('Coach')
  })

  it('personaKeys.mine composes off the root namespace', () => {
    expect(personaKeys.mine()).toEqual([...queryKeys.personas, 'mine'])
  })
})
