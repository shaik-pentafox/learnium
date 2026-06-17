import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from 'vitest'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import {
  listUsers,
  getUser,
  createUser,
  updateUser,
  deleteUser,
  importUsers,
  getImportReport,
  userKeys,
} from '@/services/users'
import { listRoles, roleLabel, roleKeys } from '@/services/roles'
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

const ROW = {
  id: 3,
  employeeId: 'E-0003',
  firstName: 'Jane',
  lastName: 'Doe',
  email: 'j.doe@alfa.io',
  roleId: 3,
  role: { name: 'USER' },
  supervisorId: 2,
  createdAt: '2026-03-02T09:00:00Z',
}

describe('users service', () => {
  it('listUsers forwards pagination + filter params', async () => {
    server.use(
      http.get('*/api/v1/users', ({ request }) => {
        const url = new URL(request.url)
        expect(url.searchParams.get('q')).toBe('jane')
        expect(url.searchParams.get('roleId')).toBe('3')
        return ok({ users: [ROW], total: 1, page: 2, limit: 20, totalPages: 1 })
      }),
    )
    const res = await listUsers({ page: 2, limit: 20, q: 'jane', roleId: 3 })
    expect(res.users[0].email).toBe('j.doe@alfa.io')
    expect(res.page).toBe(2)
  })

  it('getUser returns a detail with supervisor', async () => {
    server.use(
      http.get('*/api/v1/users/3', () =>
        ok({ ...ROW, supervisor: { id: 2, firstName: 'Tom', lastName: 'Trainer', employeeId: 'E-0002' } }),
      ),
    )
    const res = await getUser(3)
    expect(res.supervisor?.employeeId).toBe('E-0002')
  })

  it('createUser POSTs the payload', async () => {
    server.use(
      http.post('*/api/v1/users', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>
        expect(body.employeeId).toBe('E-9')
        expect(body.roleId).toBe(3)
        return HttpResponse.json(
          { status: 'success', message: 'OK', data: { ...ROW, id: 9, employeeId: 'E-9' }, meta: {} },
          { status: 201 },
        )
      }),
    )
    const res = await createUser({
      employeeId: 'E-9',
      firstName: 'New',
      lastName: 'Hire',
      email: 'new@alfa.io',
      roleId: 3,
    })
    expect(res.id).toBe(9)
  })

  it('updateUser PATCHes the target id', async () => {
    server.use(
      http.patch('*/api/v1/users/3', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>
        expect(body.email).toBe('jane.d@alfa.io')
        return ok({ ...ROW, email: 'jane.d@alfa.io' })
      }),
    )
    const res = await updateUser(3, { email: 'jane.d@alfa.io' })
    expect(res.email).toBe('jane.d@alfa.io')
  })

  it('deleteUser issues DELETE (204)', async () => {
    let hit = false
    server.use(
      http.delete('*/api/v1/users/3', () => {
        hit = true
        return new HttpResponse(null, { status: 204 })
      }),
    )
    await deleteUser(3)
    expect(hit).toBe(true)
  })

  it('importUsers uploads multipart and returns the report id', async () => {
    server.use(
      // Note: undici's multipart parser can't read a jsdom File via
      // request.formData() in this env, so we assert the round-trip only.
      http.post('*/api/v1/users/import', ({ request }) => {
        expect(request.headers.get('content-type')).toContain('multipart/form-data')
        return HttpResponse.json(
          { status: 'success', message: 'OK', data: { reportId: 'r-1', totalRows: 5 }, meta: {} },
          { status: 202 },
        )
      }),
    )
    const file = new File(['employeeId,email\n1,a@b.io'], 'users.csv', { type: 'text/csv' })
    const res = await importUsers(file)
    expect(res.reportId).toBe('r-1')
  })

  it('getImportReport reads progress', async () => {
    server.use(
      http.get('*/api/v1/users/import/r-1', () =>
        ok({ id: 'r-1', status: 'DONE', totalRows: 5, successRows: 5, errorRows: 0 }),
      ),
    )
    const res = await getImportReport('r-1')
    expect(res.status).toBe('DONE')
  })

  it('userKeys compose off the users namespace', () => {
    expect(userKeys.list({ page: 1 })).toEqual([...queryKeys.users, 'list', { page: 1 }])
    expect(userKeys.detail(3)).toEqual([...queryKeys.users, 'detail', 3])
  })
})

describe('roles service', () => {
  it('listRoles returns the role registry', async () => {
    server.use(
      http.get('*/api/v1/roles', () =>
        ok([{ id: 1, name: 'SUPER_ADMIN' }, { id: 3, name: 'USER' }]),
      ),
    )
    const res = await listRoles()
    expect(res.map((r) => r.name)).toContain('USER')
  })

  it('roleLabel maps role codes to friendly names', () => {
    expect(roleLabel('USER')).toBe('Trainee')
    expect(roleLabel('SUPER_ADMIN')).toBe('Super Admin')
    expect(roleLabel('UNKNOWN')).toBe('UNKNOWN')
  })

  it('roleKeys compose off the users namespace', () => {
    expect(roleKeys.all()).toEqual([...queryKeys.users, 'roles'])
  })
})
