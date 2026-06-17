import { apiGet, apiPost, apiPatch, apiDelete, http } from '@/lib/api-client'
import { queryKeys } from '@/lib/query-keys'

export interface UserListItem {
  id: number
  employeeId: string
  firstName: string
  lastName: string
  email: string
  roleId: number
  role: { name: string }
  supervisorId: number | null
  createdAt: string
}

export interface UserDetail extends UserListItem {
  supervisor: {
    id: number
    firstName: string
    lastName: string
    employeeId: string
  } | null
}

export interface UserListData {
  users: UserListItem[]
  total: number
  page: number
  limit: number
  totalPages: number
}

export interface UserListParams {
  page?: number
  limit?: number
  q?: string
  roleId?: number
}

export interface CreateUserInput {
  employeeId: string
  firstName: string
  lastName: string
  email: string
  roleId: number
  supervisorId?: number
  username?: string
  password?: string
}

export interface UpdateUserInput {
  firstName?: string
  lastName?: string
  email?: string
  roleId?: number
  supervisorId?: number | null
}

export interface ImportStart {
  reportId: string
  totalRows: number
}

export type ImportStatus = 'PENDING' | 'PROCESSING' | 'DONE' | 'FAILED'

export interface ImportReport {
  id: string
  status: ImportStatus
  totalRows: number
  successRows: number
  errorRows: number
}

/** GET /users — paginated. Backend scopes trainers to their own trainees. */
export async function listUsers(
  params: UserListParams = {},
): Promise<UserListData> {
  return apiGet<UserListData>('/users', { params })
}

/** GET /users/:id */
export async function getUser(id: number): Promise<UserDetail> {
  return apiGet<UserDetail>(`/users/${id}`)
}

/** POST /users */
export async function createUser(input: CreateUserInput): Promise<UserDetail> {
  return apiPost<UserDetail>('/users', input)
}

/** PATCH /users/:id */
export async function updateUser(
  id: number,
  input: UpdateUserInput,
): Promise<UserDetail> {
  return apiPatch<UserDetail>(`/users/${id}`, input)
}

/** DELETE /users/:id — soft delete (204). */
export async function deleteUser(id: number): Promise<void> {
  await apiDelete<void>(`/users/${id}`)
}

/** POST /users/import — multipart CSV/XLSX upload, async job. */
export async function importUsers(file: File): Promise<ImportStart> {
  const form = new FormData()
  form.append('file', file)
  // Clear the client's default JSON content-type so axios sets multipart WITH a
  // boundary (a manual 'multipart/form-data' string omits the boundary → breaks
  // server parsing).
  const res = await http.post('/users/import', form, {
    headers: { 'Content-Type': undefined },
  })
  return res.data.data as ImportStart
}

/** GET /users/import/:reportId — poll import progress. */
export async function getImportReport(reportId: string): Promise<ImportReport> {
  return apiGet<ImportReport>(`/users/import/${reportId}`)
}

export const userKeys = {
  list: (params: UserListParams) =>
    [...queryKeys.users, 'list', params] as const,
  detail: (id: number) => [...queryKeys.users, 'detail', id] as const,
  importReport: (reportId: string) =>
    [...queryKeys.users, 'import', reportId] as const,
}
