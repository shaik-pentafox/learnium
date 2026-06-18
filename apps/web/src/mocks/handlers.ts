import { http, HttpResponse } from 'msw'
import type { PersonaTemplate } from '@/services/personas'

const BASE = '/api/v1'

function meta() {
  return { requestId: 'mock-request', timestamp: new Date().toISOString() }
}

function ok<T>(data: T, message = 'OK') {
  return HttpResponse.json({ status: 'success', message, data, meta: meta() })
}

function fail(code: string, message: string, status: number) {
  return HttpResponse.json(
    { status: 'error', code, message, meta: meta() },
    { status },
  )
}

function base64Url(value: object): string {
  return btoa(JSON.stringify(value))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

// Mints a decodable (unsigned) JWT matching the backend payload `{ sub, role }`
// so the frontend's decodeJwt path is exercised against real-shaped tokens.
function mockJwt(sub: number, role: string): string {
  const header = base64Url({ alg: 'none', typ: 'JWT' })
  const exp = Math.floor(Date.now() / 1000) + 15 * 60
  const payload = base64Url({ sub, role, iat: Math.floor(Date.now() / 1000), exp })
  return `${header}.${payload}.mock`
}

function tokens() {
  return {
    accessToken: mockJwt(1, 'SUPER_ADMIN'),
    refreshToken: crypto.randomUUID(),
  }
}

// In-memory provider registry so create/edit reflect in the UI during dev.
interface MockProvider {
  id: number
  name: string
  type: string
  baseUrl?: string | null
  isEnabled: boolean
  priority: number
  monthlyBudgetUsd?: number | null
}

let MOCK_PROVIDERS: MockProvider[] = [
  { id: 1, name: 'OpenAI', type: 'openai', isEnabled: true, priority: 1, monthlyBudgetUsd: 4230 },
  { id: 2, name: 'Google Gemini', type: 'gemini', isEnabled: true, priority: 2, monthlyBudgetUsd: 850 },
  { id: 3, name: 'Azure OpenAI', type: 'azure', isEnabled: false, priority: 3, monthlyBudgetUsd: 1102 },
]
let nextProviderId = 4

// In-memory model registry (master) so add/edit/promote reflect in the UI.
interface MockModel {
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

let MOCK_MODELS: MockModel[] = [
  {
    id: 1, name: 'gpt-4o', providerId: 1, provider: { id: 1, name: 'OpenAI' },
    capabilities: ['chat', 'vision'], contextWindowTokens: 128000,
    inputPricePerMillion: 5, outputPricePerMillion: 15, isDefault: true,
  },
  {
    id: 2, name: 'gemini-1.5-pro', providerId: 2, provider: { id: 2, name: 'Google Gemini' },
    capabilities: ['chat'], contextWindowTokens: 1000000,
    inputPricePerMillion: 3.5, outputPricePerMillion: 10.5, isDefault: false,
  },
  {
    id: 3, name: 'whisper-1', providerId: 1, provider: { id: 1, name: 'OpenAI' },
    capabilities: ['voice'], inputPricePerMillion: null, outputPricePerMillion: null, isDefault: false,
  },
]
let nextModelId = 4

// In-memory persona store so the builder's create/edit reflect in the UI.
interface MockPersona {
  id: number
  name: string
  description?: string | null
  color?: string | null
  templateData: PersonaTemplate
  systemPrompt: string
  conversationModelId?: number | null
  scoringModelId?: number | null
  scoreCriteria: {
    id: number
    name: string
    description?: string | null
    maxScore: number
    weight: number
    order: number
  }[]
}

// Minimal stand-in for the backend renderSystemPrompt — enough for a preview.
function renderMockPrompt(t: PersonaTemplate): string {
  return [
    'You are roleplaying as a CUSTOMER contacting a support agent. Stay in character.',
    `You are contacting ${t.company} about: ${t.issue}`,
    `You feel ${t.emotion} (${t.intensity}/5). You want: ${t.desiredOutcome}.`,
    `When ${t.resolutionCriteria}, thank the agent and end with [CONVERSATION_ENDED].`,
  ].join('\n\n')
}

const SEED_TEMPLATE: PersonaTemplate = {
  customerProfile: 'Premium subscriber for 3 years',
  company: 'Nimbus Telecom',
  issue: 'charged twice for this month bill',
  channel: 'chat',
  emotion: 'frustrated',
  intensity: 4,
  desiredOutcome: 'a refund of the duplicate charge',
  resolutionCriteria: 'the agent confirms the duplicate charge will be refunded',
}

let MOCK_PERSONAS: MockPersona[] = [
  {
    id: 1, name: 'Double-charged Dana',
    description: 'A frustrated premium customer disputing a duplicate charge.',
    templateData: SEED_TEMPLATE,
    systemPrompt: renderMockPrompt(SEED_TEMPLATE),
    scoreCriteria: [
      { id: 1, name: 'Empathy', maxScore: 10, weight: 2, order: 0 },
      { id: 2, name: 'Resolution', maxScore: 20, weight: 2, order: 1 },
    ],
  },
]
let nextPersonaId = 2
let nextCriterionId = 3

interface PersonaBody {
  name: string
  description?: string
  color?: string
  template: PersonaTemplate
  conversationModelId?: number
  scoringModelId?: number
  scoreCriteria?: { name: string; description?: string; maxScore: number; weight: number; order: number }[]
}

function providerRef(id: number) {
  const p = MOCK_PROVIDERS.find((x) => x.id === id)
  return p ? { id: p.id, name: p.name } : undefined
}

// Current user's profile for the Settings → Account section.
let MOCK_PROFILE = {
  id: 1,
  employeeId: 'E-0001',
  email: 'admin@alfa.io',
  firstName: 'Ada',
  lastName: 'Admin',
  avatarUrl: null as string | null,
  role: 'SUPER_ADMIN',
  username: 'admin',
}

// Role registry + user directory for the Users management page.
const MOCK_ROLES = [
  { id: 1, name: 'SUPER_ADMIN' },
  { id: 2, name: 'TRAINER' },
  { id: 3, name: 'USER' },
]

interface MockUser {
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

let MOCK_USERS: MockUser[] = [
  { id: 1, employeeId: 'E-0001', firstName: 'Ada', lastName: 'Admin', email: 'admin@alfa.io', roleId: 1, role: { name: 'SUPER_ADMIN' }, supervisorId: null, createdAt: '2026-01-04T09:00:00Z' },
  { id: 2, employeeId: 'E-0002', firstName: 'Tom', lastName: 'Trainer', email: 't.trainer@alfa.io', roleId: 2, role: { name: 'TRAINER' }, supervisorId: 1, createdAt: '2026-02-11T09:00:00Z' },
  { id: 3, employeeId: 'E-0003', firstName: 'Jane', lastName: 'Doe', email: 'j.doe@alfa.io', roleId: 3, role: { name: 'USER' }, supervisorId: 2, createdAt: '2026-03-02T09:00:00Z' },
  { id: 4, employeeId: 'E-0004', firstName: 'Mark', lastName: 'Smith', email: 'm.smith@alfa.io', roleId: 3, role: { name: 'USER' }, supervisorId: 2, createdAt: '2026-03-09T09:00:00Z' },
]
let nextUserId = 5

function roleRef(roleId: number) {
  return { name: MOCK_ROLES.find((r) => r.id === roleId)?.name ?? 'USER' }
}

// Import jobs: complete after the first poll so the dialog shows progress→done.
const MOCK_IMPORTS = new Map<string, { id: string; status: string; totalRows: number; successRows: number; errorRows: number; polls: number }>()

const MOCK_SESSIONS = [
  {
    id: 1,
    uid: 's-0001',
    status: 'COMPLETED',
    persona: { id: 1, name: 'Objection Handler' },
    scores: [
      { id: 1, criterionId: 1, score: 8, maxScore: 10 },
      { id: 2, criterionId: 2, score: 7, maxScore: 10 },
    ],
    startedAt: '2026-06-16T09:10:00Z',
    endedAt: '2026-06-16T09:24:00Z',
  },
  {
    id: 2,
    uid: 's-0002',
    status: 'COMPLETED',
    persona: { id: 2, name: 'Cold Lead' },
    scores: [{ id: 3, criterionId: 1, score: 7, maxScore: 10 }],
    startedAt: '2026-06-15T14:02:00Z',
    endedAt: '2026-06-15T14:18:00Z',
  },
  {
    id: 3,
    uid: 's-0003',
    status: 'ACTIVE',
    persona: { id: 3, name: 'Angry Customer' },
    scores: [],
    startedAt: '2026-06-16T11:30:00Z',
  },
]

export const handlers = [
  http.post(`${BASE}/auth/login`, async ({ request }) => {
    const body = (await request.json()) as {
      username?: string
      password?: string
    }
    if (!body?.username || !body?.password) {
      return fail('VALIDATION_ERROR', 'Username and password are required', 400)
    }
    if (body.password !== 'password') {
      return fail('INVALID_CREDENTIALS', 'Invalid credentials', 401)
    }
    return ok(tokens())
  }),

  http.post(`${BASE}/auth/refresh`, async ({ request }) => {
    const body = (await request.json()) as { refreshToken?: string }
    if (!body?.refreshToken) {
      return fail('TOKEN_EXPIRED', 'Invalid or expired refresh token', 401)
    }
    return ok(tokens())
  }),

  http.post(`${BASE}/auth/logout`, ({ request }) => {
    if (!request.headers.get('Authorization')) {
      return fail('UNAUTHORIZED', 'Missing credentials', 401)
    }
    return ok({ message: 'Logged out' })
  }),

  http.get(`${BASE}/personas/my`, ({ request }) => {
    if (!request.headers.get('Authorization')) {
      return fail('UNAUTHORIZED', 'Missing credentials', 401)
    }
    // Derive summaries from the store so list ↔ edit ↔ create stay consistent.
    const personas = MOCK_PERSONAS.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description ?? null,
      color: p.color ?? null,
    }))
    return ok({ personas, total: personas.length })
  }),

  http.post(`${BASE}/sessions`, async ({ request }) => {
    if (!request.headers.get('Authorization')) {
      return fail('UNAUTHORIZED', 'Missing credentials', 401)
    }
    const body = (await request.json()) as { personaId?: number }
    if (!body?.personaId) {
      return fail('VALIDATION_ERROR', 'personaId required', 400)
    }
    return HttpResponse.json(
      {
        status: 'success',
        message: 'OK',
        data: {
          sessionId: 101,
          uid: crypto.randomUUID(),
          startedAt: new Date().toISOString(),
        },
        meta: meta(),
      },
      { status: 201 },
    )
  }),

  http.get(`${BASE}/llm/providers`, ({ request }) => {
    if (!request.headers.get('Authorization')) {
      return fail('UNAUTHORIZED', 'Missing credentials', 401)
    }
    return ok(MOCK_PROVIDERS)
  }),

  http.post(`${BASE}/llm/providers`, async ({ request }) => {
    if (!request.headers.get('Authorization')) {
      return fail('UNAUTHORIZED', 'Missing credentials', 401)
    }
    const body = (await request.json()) as Partial<MockProvider> & { apiKey?: string }
    if (!body?.name || !body?.type) {
      return fail('VALIDATION_ERROR', 'name and type are required', 400)
    }
    const provider: MockProvider = {
      id: nextProviderId++,
      name: body.name,
      type: body.type,
      baseUrl: body.baseUrl ?? null,
      isEnabled: body.isEnabled ?? true,
      priority: body.priority ?? 0,
      monthlyBudgetUsd: body.monthlyBudgetUsd ?? null,
    }
    MOCK_PROVIDERS = [...MOCK_PROVIDERS, provider]
    return HttpResponse.json(
      { status: 'success', message: 'OK', data: provider, meta: meta() },
      { status: 201 },
    )
  }),

  http.patch(`${BASE}/llm/providers/:id`, async ({ request, params }) => {
    if (!request.headers.get('Authorization')) {
      return fail('UNAUTHORIZED', 'Missing credentials', 401)
    }
    const id = Number(params.id)
    const existing = MOCK_PROVIDERS.find((p) => p.id === id)
    if (!existing) return fail('NOT_FOUND', 'Provider not found', 404)
    const body = (await request.json()) as Partial<MockProvider> & { apiKey?: string }
    const patch = { ...body }
    delete patch.apiKey // write-only; mock ignores the key, never echoes it
    const updated = { ...existing, ...patch }
    MOCK_PROVIDERS = MOCK_PROVIDERS.map((p) => (p.id === id ? updated : p))
    return ok(updated)
  }),

  http.get(`${BASE}/llm/models`, ({ request }) => {
    if (!request.headers.get('Authorization')) {
      return fail('UNAUTHORIZED', 'Missing credentials', 401)
    }
    return ok(MOCK_MODELS)
  }),

  http.post(`${BASE}/llm/models`, async ({ request }) => {
    if (!request.headers.get('Authorization')) {
      return fail('UNAUTHORIZED', 'Missing credentials', 401)
    }
    const body = (await request.json()) as Partial<MockModel>
    if (!body?.name || !body?.providerId) {
      return fail('VALIDATION_ERROR', 'name and providerId are required', 400)
    }
    const model: MockModel = {
      id: nextModelId++,
      name: body.name,
      providerId: body.providerId,
      provider: providerRef(body.providerId),
      capabilities: body.capabilities ?? [],
      contextWindowTokens: body.contextWindowTokens ?? null,
      inputPricePerMillion: body.inputPricePerMillion ?? null,
      outputPricePerMillion: body.outputPricePerMillion ?? null,
      isDefault: body.isDefault ?? false,
    }
    if (model.isDefault) {
      MOCK_MODELS = MOCK_MODELS.map((m) => ({ ...m, isDefault: false }))
    }
    MOCK_MODELS = [...MOCK_MODELS, model]
    return HttpResponse.json(
      { status: 'success', message: 'OK', data: model, meta: meta() },
      { status: 201 },
    )
  }),

  http.patch(`${BASE}/llm/models/:id`, async ({ request, params }) => {
    if (!request.headers.get('Authorization')) {
      return fail('UNAUTHORIZED', 'Missing credentials', 401)
    }
    const id = Number(params.id)
    const existing = MOCK_MODELS.find((m) => m.id === id)
    if (!existing) return fail('NOT_FOUND', 'Model not found', 404)
    const body = (await request.json()) as Partial<MockModel>
    const updated = {
      ...existing,
      ...body,
      provider: body.providerId ? providerRef(body.providerId) : existing.provider,
    }
    MOCK_MODELS = MOCK_MODELS.map((m) =>
      m.id === id ? updated : body.isDefault ? { ...m, isDefault: false } : m,
    )
    return ok(updated)
  }),

  http.post(`${BASE}/llm/models/:id/promote`, ({ request, params }) => {
    if (!request.headers.get('Authorization')) {
      return fail('UNAUTHORIZED', 'Missing credentials', 401)
    }
    const id = Number(params.id)
    if (!MOCK_MODELS.some((m) => m.id === id)) {
      return fail('NOT_FOUND', 'Model not found', 404)
    }
    MOCK_MODELS = MOCK_MODELS.map((m) => ({ ...m, isDefault: m.id === id }))
    return ok({ id, promoted: true })
  }),

  http.get(`${BASE}/llm/usage`, ({ request }) => {
    if (!request.headers.get('Authorization')) {
      return fail('UNAUTHORIZED', 'Missing credentials', 401)
    }
    const now = Date.now()
    return ok({
      since: new Date(now - 30 * 86_400_000).toISOString(),
      totals: { calls: 128, totalTokens: 412_345, costUsd: 3.87 },
      byModel: [
        { modelName: 'gpt-4o', calls: 90, totalTokens: 320_000, costUsd: 3.2 },
        { modelName: 'gemini-1.5-pro', calls: 38, totalTokens: 92_345, costUsd: 0.67 },
      ],
      recent: [
        { id: 1, kind: 'chat', modelName: 'gpt-4o', sessionId: 1, userId: 1, inputTokens: 1200, outputTokens: 340, totalTokens: 1540, costUsd: 0.0111, estimated: false, latencyMs: 1820, createdAt: new Date(now - 5 * 60_000).toISOString() },
        { id: 2, kind: 'scoring', modelName: 'gpt-4o', sessionId: 1, userId: 1, inputTokens: 2100, outputTokens: 180, totalTokens: 2280, costUsd: 0.0132, estimated: true, latencyMs: 2600, createdAt: new Date(now - 60 * 60_000).toISOString() },
      ],
    })
  }),

  http.get(`${BASE}/auth/me`, ({ request }) => {
    if (!request.headers.get('Authorization')) {
      return fail('UNAUTHORIZED', 'Missing credentials', 401)
    }
    return ok(MOCK_PROFILE)
  }),

  http.patch(`${BASE}/auth/me`, async ({ request }) => {
    if (!request.headers.get('Authorization')) {
      return fail('UNAUTHORIZED', 'Missing credentials', 401)
    }
    const body = (await request.json()) as Partial<typeof MOCK_PROFILE>
    MOCK_PROFILE = {
      ...MOCK_PROFILE,
      ...(body.firstName !== undefined ? { firstName: body.firstName } : {}),
      ...(body.lastName !== undefined ? { lastName: body.lastName } : {}),
      ...(body.email !== undefined ? { email: body.email } : {}),
    }
    return ok(MOCK_PROFILE)
  }),

  http.post(`${BASE}/auth/change-password`, async ({ request }) => {
    if (!request.headers.get('Authorization')) {
      return fail('UNAUTHORIZED', 'Missing credentials', 401)
    }
    const body = (await request.json()) as { currentPassword?: string; newPassword?: string }
    if (body.currentPassword !== 'password') {
      return fail('INVALID_CREDENTIALS', 'Current password is incorrect', 401)
    }
    return ok({ changed: true })
  }),

  http.post(`${BASE}/auth/realtime/ticket`, ({ request }) => {
    if (!request.headers.get('Authorization')) {
      return fail('UNAUTHORIZED', 'Missing credentials', 401)
    }
    return HttpResponse.json(
      { status: 'success', message: 'OK', data: { ticket: crypto.randomUUID() }, meta: meta() },
      { status: 201 },
    )
  }),

  http.get(`${BASE}/sessions`, ({ request }) => {
    if (!request.headers.get('Authorization')) {
      return fail('UNAUTHORIZED', 'Missing credentials', 401)
    }
    const limit = Number(new URL(request.url).searchParams.get('limit') ?? 20)
    return ok({
      sessions: MOCK_SESSIONS.slice(0, limit),
      total: MOCK_SESSIONS.length,
      page: 1,
      limit,
      totalPages: 1,
    })
  }),

  http.get(`${BASE}/personas/:id`, ({ request, params }) => {
    if (!request.headers.get('Authorization')) {
      return fail('UNAUTHORIZED', 'Missing credentials', 401)
    }
    const id = Number(params.id)
    const persona = MOCK_PERSONAS.find((p) => p.id === id)
    if (!persona) return fail('NOT_FOUND', `Persona ${id} not found`, 404)
    return ok(persona)
  }),

  http.post(`${BASE}/personas`, async ({ request }) => {
    if (!request.headers.get('Authorization')) {
      return fail('UNAUTHORIZED', 'Missing credentials', 401)
    }
    const body = (await request.json()) as PersonaBody
    const t = body?.template
    if (!body?.name?.trim() || !t?.issue?.trim() || !t?.company?.trim()) {
      return fail('VALIDATION_ERROR', 'name and template fields are required', 400)
    }
    const persona: MockPersona = {
      id: nextPersonaId++,
      name: body.name,
      description: body.description ?? null,
      color: body.color ?? null,
      templateData: t,
      systemPrompt: renderMockPrompt(t),
      conversationModelId: body.conversationModelId ?? null,
      scoringModelId: body.scoringModelId ?? null,
      scoreCriteria: (body.scoreCriteria ?? []).map((c) => ({
        id: nextCriterionId++,
        name: c.name,
        description: c.description ?? null,
        maxScore: c.maxScore,
        weight: c.weight,
        order: c.order,
      })),
    }
    MOCK_PERSONAS = [...MOCK_PERSONAS, persona]
    return HttpResponse.json(
      { status: 'success', message: 'OK', data: persona, meta: meta() },
      { status: 201 },
    )
  }),

  http.patch(`${BASE}/personas/:id`, async ({ request, params }) => {
    if (!request.headers.get('Authorization')) {
      return fail('UNAUTHORIZED', 'Missing credentials', 401)
    }
    const id = Number(params.id)
    const existing = MOCK_PERSONAS.find((p) => p.id === id)
    if (!existing) return fail('NOT_FOUND', `Persona ${id} not found`, 404)
    const body = (await request.json()) as Partial<PersonaBody>
    const updated: MockPersona = {
      ...existing,
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.color !== undefined ? { color: body.color } : {}),
      ...(body.template !== undefined
        ? { templateData: body.template, systemPrompt: renderMockPrompt(body.template) }
        : {}),
      ...(body.conversationModelId !== undefined ? { conversationModelId: body.conversationModelId } : {}),
      ...(body.scoringModelId !== undefined ? { scoringModelId: body.scoringModelId } : {}),
      ...(body.scoreCriteria !== undefined
        ? {
            scoreCriteria: body.scoreCriteria.map((c) => ({
              id: nextCriterionId++,
              name: c.name,
              description: c.description ?? null,
              maxScore: c.maxScore,
              weight: c.weight,
              order: c.order,
            })),
          }
        : {}),
    }
    MOCK_PERSONAS = MOCK_PERSONAS.map((p) => (p.id === id ? updated : p))
    return ok(updated)
  }),

  http.get(`${BASE}/roles`, ({ request }) => {
    if (!request.headers.get('Authorization')) {
      return fail('UNAUTHORIZED', 'Missing credentials', 401)
    }
    return ok(MOCK_ROLES)
  }),

  http.get(`${BASE}/users`, ({ request }) => {
    if (!request.headers.get('Authorization')) {
      return fail('UNAUTHORIZED', 'Missing credentials', 401)
    }
    const url = new URL(request.url)
    const page = Number(url.searchParams.get('page') ?? 1)
    const limit = Number(url.searchParams.get('limit') ?? 20)
    const q = url.searchParams.get('q')?.toLowerCase()
    const roleId = url.searchParams.get('roleId')

    let rows = MOCK_USERS
    if (roleId) rows = rows.filter((u) => u.roleId === Number(roleId))
    if (q) {
      rows = rows.filter((u) =>
        [u.firstName, u.lastName, u.email, u.employeeId]
          .join(' ')
          .toLowerCase()
          .includes(q),
      )
    }
    const total = rows.length
    const start = (page - 1) * limit
    return ok({
      users: rows.slice(start, start + limit),
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    })
  }),

  http.get(`${BASE}/users/import/:reportId`, ({ request, params }) => {
    if (!request.headers.get('Authorization')) {
      return fail('UNAUTHORIZED', 'Missing credentials', 401)
    }
    const job = MOCK_IMPORTS.get(String(params.reportId))
    if (!job) return fail('NOT_FOUND', 'Import report not found', 404)
    // First poll → PROCESSING, second → DONE (simulate async work).
    job.polls += 1
    if (job.polls >= 2) {
      job.status = 'DONE'
      job.successRows = Math.max(0, job.totalRows - job.errorRows)
    } else {
      job.status = 'PROCESSING'
    }
    return ok({
      id: job.id,
      status: job.status,
      totalRows: job.totalRows,
      successRows: job.successRows,
      errorRows: job.errorRows,
    })
  }),

  http.get(`${BASE}/users/:id`, ({ request, params }) => {
    if (!request.headers.get('Authorization')) {
      return fail('UNAUTHORIZED', 'Missing credentials', 401)
    }
    const user = MOCK_USERS.find((u) => u.id === Number(params.id))
    if (!user) return fail('NOT_FOUND', 'User not found', 404)
    const supervisor = MOCK_USERS.find((u) => u.id === user.supervisorId)
    return ok({
      ...user,
      supervisor: supervisor
        ? {
            id: supervisor.id,
            firstName: supervisor.firstName,
            lastName: supervisor.lastName,
            employeeId: supervisor.employeeId,
          }
        : null,
    })
  }),

  http.post(`${BASE}/users`, async ({ request }) => {
    if (!request.headers.get('Authorization')) {
      return fail('UNAUTHORIZED', 'Missing credentials', 401)
    }
    const body = (await request.json()) as Partial<MockUser> & { roleId: number }
    if (!body?.employeeId || !body?.email || !body?.roleId) {
      return fail('VALIDATION_ERROR', 'employeeId, email and roleId are required', 400)
    }
    if (MOCK_USERS.some((u) => u.employeeId === body.employeeId || u.email === body.email)) {
      return fail('CONFLICT', 'employeeId or email already exists', 409)
    }
    const user: MockUser = {
      id: nextUserId++,
      employeeId: body.employeeId,
      firstName: body.firstName ?? '',
      lastName: body.lastName ?? '',
      email: body.email,
      roleId: body.roleId,
      role: roleRef(body.roleId),
      supervisorId: body.supervisorId ?? null,
      createdAt: new Date().toISOString(),
    }
    MOCK_USERS = [user, ...MOCK_USERS]
    return HttpResponse.json(
      { status: 'success', message: 'OK', data: user, meta: meta() },
      { status: 201 },
    )
  }),

  http.post(`${BASE}/users/import`, () => {
    const id = crypto.randomUUID()
    MOCK_IMPORTS.set(id, {
      id,
      status: 'PENDING',
      totalRows: 12,
      successRows: 0,
      errorRows: 2,
      polls: 0,
    })
    return HttpResponse.json(
      { status: 'success', message: 'OK', data: { reportId: id, totalRows: 12 }, meta: meta() },
      { status: 202 },
    )
  }),

  http.patch(`${BASE}/users/:id`, async ({ request, params }) => {
    if (!request.headers.get('Authorization')) {
      return fail('UNAUTHORIZED', 'Missing credentials', 401)
    }
    const id = Number(params.id)
    const existing = MOCK_USERS.find((u) => u.id === id)
    if (!existing) return fail('NOT_FOUND', 'User not found', 404)
    const body = (await request.json()) as Partial<MockUser>
    const updated: MockUser = {
      ...existing,
      ...(body.firstName !== undefined ? { firstName: body.firstName } : {}),
      ...(body.lastName !== undefined ? { lastName: body.lastName } : {}),
      ...(body.email !== undefined ? { email: body.email } : {}),
      ...(body.roleId !== undefined ? { roleId: body.roleId, role: roleRef(body.roleId) } : {}),
      ...('supervisorId' in body ? { supervisorId: body.supervisorId ?? null } : {}),
    }
    MOCK_USERS = MOCK_USERS.map((u) => (u.id === id ? updated : u))
    return ok(updated)
  }),

  http.delete(`${BASE}/users/:id`, ({ request, params }) => {
    if (!request.headers.get('Authorization')) {
      return fail('UNAUTHORIZED', 'Missing credentials', 401)
    }
    const id = Number(params.id)
    if (!MOCK_USERS.some((u) => u.id === id)) {
      return fail('NOT_FOUND', 'User not found', 404)
    }
    MOCK_USERS = MOCK_USERS.filter((u) => u.id !== id)
    return new HttpResponse(null, { status: 204 })
  }),
]
