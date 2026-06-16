import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import {
  listSessions,
  sessionKeys,
  type SessionSummary,
} from '@/services/sessions'
import { useAuthStore } from '@/stores/auth'

export const Route = createFileRoute('/_auth/dashboard')({
  component: DashboardPage,
})

const RECENT_LIMIT = 5

function sessionScore(s: SessionSummary): number | null {
  // Score is null until async scoring completes; ignore unscored criteria.
  const scored = s.scores.filter((c) => c.score !== null)
  if (scored.length === 0) return null
  const earned = scored.reduce((sum, c) => sum + (c.score ?? 0), 0)
  const max = scored.reduce((sum, c) => sum + c.maxScore, 0)
  return max > 0 ? Math.round((earned / max) * 100) : null
}

function DashboardPage() {
  const user = useAuthStore((s) => s.user)
  const params = { limit: RECENT_LIMIT }
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: sessionKeys.list(params),
    queryFn: () => listSessions(params),
  })

  const sessions = data?.sessions ?? []
  const completed = sessions.filter((s) => s.status === 'COMPLETED').length
  const scored = sessions.map(sessionScore).filter((v): v is number => v !== null)
  const avgScore = scored.length
    ? Math.round(scored.reduce((a, b) => a + b, 0) / scored.length)
    : null

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          Welcome back{user ? `, ${user.name}` : ''}
        </h1>
        <p className="text-sm text-muted-foreground">
          Your recent training activity.
        </p>
      </header>

      {isPending && <DashboardSkeleton />}
      {isError && (
        <div className="rounded-lg border border-border bg-surface p-4 text-sm">
          <p className="text-destructive">Couldn’t load your sessions.</p>
          <button
            type="button"
            onClick={() => refetch()}
            className="mt-2 text-primary hover:underline"
          >
            Retry
          </button>
        </div>
      )}

      {data && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label="Total sessions" value={data.total} />
            <StatCard label="Completed (recent)" value={completed} />
            <StatCard
              label="Avg score (recent)"
              value={avgScore === null ? '—' : `${avgScore}%`}
            />
          </div>

          <section className="rounded-lg border border-border bg-surface">
            <h2 className="border-b border-border px-4 py-3 text-sm font-medium">
              Recent sessions
            </h2>
            {sessions.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted-foreground">
                No sessions yet. Start a practice session to see it here.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {sessions.map((s) => {
                  const score = sessionScore(s)
                  return (
                    <li
                      key={s.uid}
                      className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
                    >
                      <span className="min-w-0 truncate">{s.persona.name}</span>
                      <span className="flex items-center gap-3">
                        <StatusBadge status={s.status} />
                        <span className="font-data tabular-nums text-muted-foreground">
                          {score === null ? '—' : `${score}%`}
                        </span>
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  )
}

interface StatCardProps {
  label: string
  value: string | number
}

function StatCard({ label, value }: StatCardProps) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 font-data text-2xl font-semibold tabular-nums">
        {value}
      </div>
    </div>
  )
}

const STATUS_STYLE: Record<string, string> = {
  ACTIVE: 'bg-info/15 text-info',
  COMPLETED: 'bg-success-soft text-success',
  ABANDONED: 'bg-muted text-muted-foreground',
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_STYLE[status] ?? 'bg-muted'}`}
    >
      {status.toLowerCase()}
    </span>
  )
}

function DashboardSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className="h-20 animate-pulse rounded-lg border border-border bg-muted"
        />
      ))}
    </div>
  )
}
