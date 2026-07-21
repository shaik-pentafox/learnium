import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { getLeaderboard, leaderboardKeys } from '@/services/leaderboard'
import { useAuthStore } from '@/stores/auth'
import { LeaderboardTable } from '@/components/leaderboard/leaderboard-table'
import { DashboardSkeleton, DashboardError } from '@/components/dashboard/primitives'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

const WINDOWS = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
]

const DEFAULT_DAYS = 30

interface LeaderboardSearch {
  days?: number
}

export const Route = createFileRoute('/_auth/leaderboard')({
  validateSearch: (search: Record<string, unknown>): LeaderboardSearch => {
    const days = Number(search.days)
    return WINDOWS.some((w) => w.value === String(days)) ? { days } : {}
  },
  component: LeaderboardPage,
})

function LeaderboardPage() {
  const user = useAuthStore((s) => s.user)
  const { days = DEFAULT_DAYS } = Route.useSearch()
  const navigate = useNavigate()

  const params = { days }
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: leaderboardKeys.board(params, user?.id),
    queryFn: () => getLeaderboard(params),
  })

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Leaderboard</h1>
          <p className="text-sm text-muted-foreground">
            Ranked by points — practise more and score higher to climb.
          </p>
        </div>

        <Tabs
          value={String(days)}
          onValueChange={(next) =>
            navigate({
              to: '/leaderboard',
              search: { days: Number(next) },
              replace: true,
            })
          }
        >
          <TabsList>
            {WINDOWS.map((w) => (
              <TabsTrigger key={w.value} value={w.value}>
                {w.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </header>

      {isPending && <DashboardSkeleton />}
      {isError && <DashboardError onRetry={() => refetch()} />}
      {data && <LeaderboardTable data={data} currentUserId={user?.id} />}
    </div>
  )
}
