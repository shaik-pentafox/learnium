import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { getDashboardSummary, dashboardKeys } from '@/services/dashboard'
import { useAuthStore } from '@/stores/auth'
import { DashboardSkeleton, DashboardError } from '@/components/dashboard/primitives'
import {
  TraineeReport,
  TrainerReport,
  AdminReport,
} from '@/components/dashboard/report-views'

interface ReportSearch {
  tab?: string
}

export const Route = createFileRoute('/_auth/report')({
  validateSearch: (search: Record<string, unknown>): ReportSearch => ({
    tab: typeof search.tab === 'string' ? search.tab : undefined,
  }),
  component: ReportPage,
})

const SUBTITLE: Record<string, string> = {
  USER: 'Your full training history and persona breakdown.',
  TRAINER: 'Trainees, sessions, and scenario performance.',
  SUPER_ADMIN: 'Platform activity with model and provider usage.',
}

function ReportPage() {
  const user = useAuthStore((s) => s.user)
  const { tab } = Route.useSearch()
  const navigate = useNavigate()
  const onTabChange = (next: string) =>
    navigate({ to: '/report', search: { tab: next }, replace: true })

  const { data, isPending, isError, refetch } = useQuery({
    queryKey: dashboardKeys.summary(user?.id),
    queryFn: getDashboardSummary,
  })

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Report</h1>
        <p className="text-sm text-muted-foreground">
          {SUBTITLE[user?.role ?? 'USER'] ?? SUBTITLE.USER}
        </p>
      </header>

      {isPending && <DashboardSkeleton />}
      {isError && <DashboardError onRetry={() => refetch()} />}

      {data?.role === 'USER' && (
        <TraineeReport data={data} tab={tab} onTabChange={onTabChange} />
      )}
      {data?.role === 'TRAINER' && (
        <TrainerReport data={data} tab={tab} onTabChange={onTabChange} />
      )}
      {data?.role === 'SUPER_ADMIN' && (
        <AdminReport data={data} tab={tab} onTabChange={onTabChange} />
      )}
    </div>
  )
}
