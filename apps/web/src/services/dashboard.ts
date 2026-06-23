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
  }
}

export type DashboardSummary = TraineeSummary | TrainerSummary | AdminSummary

/** GET /dashboard/summary — role-aware home metrics for the current user. */
export async function getDashboardSummary(): Promise<DashboardSummary> {
  return apiGet<DashboardSummary>('/dashboard/summary')
}

export const dashboardKeys = {
  summary: (userId?: number) => ['dashboard', 'summary', userId] as const,
}
