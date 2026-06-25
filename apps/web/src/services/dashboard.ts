import { apiGet } from '@/lib/api-client'

export interface TraineeRecent {
  uid: string
  personaName: string
  status: string
  scorePct: number | null
}

export interface TraineePersonaStat {
  personaName: string
  sessions: number
  avgScorePct: number | null
}

export interface TraineeDayPoint {
  date: string
  sessions: number
  avgScorePct: number | null
}

export interface TraineeSummary {
  firstName: string | null
  role: 'USER'
  totals: {
    sessions: number
    completed: number
    abandoned: number
    avgScorePct: number | null
    bestScorePct: number | null
    avgResponseMs: number | null
    avgLlmLatencyMs: number | null
  }
  byPersona: TraineePersonaStat[]
  series: TraineeDayPoint[]
  recent: TraineeRecent[]
}

export interface TrainerTraineeRow {
  id: number
  name: string
  sessions: number
  completed: number
  avgScorePct: number | null
  lastActiveAt: string | null
}

export interface TrainerPersonaStat {
  personaName: string
  sessions: number
  avgScorePct: number | null
}

export interface TrainerRecent {
  uid: string
  traineeName: string
  personaName: string
  status: string
  scorePct: number | null
}

export interface TrainerDayPoint {
  date: string
  sessions: number
  avgScorePct: number | null
}

export interface TrainerSummary {
  firstName: string | null
  role: 'TRAINER'
  totals: {
    trainees: number
    sessions: number
    completed: number
    abandoned: number
    avgScorePct: number | null
    avgResponseMs: number | null
    avgLlmLatencyMs: number | null
  }
  trainees: TrainerTraineeRow[]
  byPersona: TrainerPersonaStat[]
  recent: TrainerRecent[]
  series: TrainerDayPoint[]
  personas: { total: number; published: number }
}

export interface AdminSummary {
  firstName: string | null
  role: 'SUPER_ADMIN'
  totals: {
    users: number
    trainers: number
    trainees: number
    personas: number
    publishedPersonas: number
    sessions: number
    completed: number
    avgResponseMs: number | null
    avgLlmLatencyMs: number | null
  }
}

export type DashboardSummary = TraineeSummary | TrainerSummary | AdminSummary

/** GET /dashboard/summary — role-aware home metrics for the current user. */
export async function getDashboardSummary(): Promise<DashboardSummary> {
  return apiGet<DashboardSummary>('/dashboard/summary')
}

// ── Admin report (paginated rollups) ─────────────────────────────────────────

export interface Paginated<T> {
  rows: T[]
  total: number
  page: number
  limit: number
  totalPages: number
}

export interface TrainerReportRow {
  id: number
  name: string
  email: string
  trainees: number
  sessions: number
  completed: number
  avgScorePct: number | null
}

export interface PersonaReportRow {
  id: number
  name: string
  owner: string
  published: boolean
  sessions: number
  avgScorePct: number | null
}

export interface ReportPageParams {
  page?: number
  limit?: number
  q?: string
  published?: boolean
}

function reportParams(p: ReportPageParams) {
  return {
    ...(p.page ? { page: p.page } : {}),
    ...(p.limit ? { limit: p.limit } : {}),
    ...(p.q ? { q: p.q } : {}),
    ...(p.published !== undefined ? { published: p.published } : {}),
  }
}

/** GET /dashboard/report/trainers — admin per-trainer rollup. */
export async function reportTrainers(
  params: ReportPageParams,
): Promise<Paginated<TrainerReportRow>> {
  return apiGet('/dashboard/report/trainers', { params: reportParams(params) })
}

/** GET /dashboard/report/personas — admin per-persona rollup. */
export async function reportPersonas(
  params: ReportPageParams,
): Promise<Paginated<PersonaReportRow>> {
  return apiGet('/dashboard/report/personas', { params: reportParams(params) })
}

export const dashboardKeys = {
  summary: (userId?: number) => ['dashboard', 'summary', userId] as const,
  reportTrainers: (params: ReportPageParams) =>
    ['dashboard', 'report', 'trainers', params] as const,
  reportPersonas: (params: ReportPageParams) =>
    ['dashboard', 'report', 'personas', params] as const,
}
