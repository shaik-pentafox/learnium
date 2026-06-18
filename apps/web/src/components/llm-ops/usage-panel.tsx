import { useQuery } from '@tanstack/react-query'
import { listUsage, llmKeys, type UsageRow } from '@/services/llm'

const PARAMS = { days: 30, limit: 50 }

export function UsagePanel() {
  const usage = useQuery({
    queryKey: llmKeys.usage(PARAMS),
    queryFn: () => listUsage(PARAMS),
  })

  return (
    <section className="space-y-3">
      <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Usage &amp; cost · last {PARAMS.days} days
      </h2>

      {usage.isPending ? (
        <div className="grid gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-20 animate-pulse rounded-lg border border-border bg-muted"
            />
          ))}
        </div>
      ) : usage.isError ? (
        <div className="rounded-lg border border-border bg-surface p-4 text-sm">
          <p className="text-destructive">Couldn’t load usage.</p>
          <button
            type="button"
            onClick={() => usage.refetch()}
            className="mt-2 text-primary hover:underline"
          >
            Retry
          </button>
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label="LLM calls" value={usage.data.totals.calls.toLocaleString()} />
            <StatCard label="Tokens" value={fmtTokens(usage.data.totals.totalTokens)} />
            <StatCard label="Cost" value={fmtCost(usage.data.totals.costUsd)} />
          </div>

          {/* Per-model breakdown */}
          <div className="overflow-hidden rounded-lg border border-border bg-surface">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <Th>Model</Th>
                  <Th className="text-right">Calls</Th>
                  <Th className="text-right">Tokens</Th>
                  <Th className="text-right">Cost</Th>
                </tr>
              </thead>
              <tbody>
                {usage.data.byModel.map((m) => (
                  <tr key={m.modelName} className="border-b border-border last:border-0">
                    <td className="px-4 py-2.5 font-data">{m.modelName}</td>
                    <td className="px-4 py-2.5 text-right font-data tabular-nums text-muted-foreground">
                      {m.calls.toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5 text-right font-data tabular-nums text-muted-foreground">
                      {fmtTokens(m.totalTokens)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-data tabular-nums">
                      {fmtCost(m.costUsd)}
                    </td>
                  </tr>
                ))}
                {usage.data.byModel.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-sm text-muted-foreground">
                      No usage recorded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Recent calls */}
          {usage.data.recent.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-border bg-surface">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <Th>When</Th>
                    <Th>Kind</Th>
                    <Th>Model</Th>
                    <Th className="text-right">In / Out</Th>
                    <Th className="text-right">Cost</Th>
                  </tr>
                </thead>
                <tbody>
                  {usage.data.recent.map((r) => (
                    <RecentRow key={r.id} row={r} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  )
}

function RecentRow({ row }: { row: UsageRow }) {
  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-4 py-2.5 text-muted-foreground">{fmtWhen(row.createdAt)}</td>
      <td className="px-4 py-2.5">
        <span className="rounded bg-muted px-1.5 py-0.5 text-xs">{row.kind}</span>
      </td>
      <td className="px-4 py-2.5 font-data">
        {row.modelName}
        {row.estimated && (
          <span className="ml-2 text-xs text-muted-foreground" title="Tokens estimated (no provider usage)">
            est
          </span>
        )}
      </td>
      <td className="px-4 py-2.5 text-right font-data tabular-nums text-muted-foreground">
        {row.inputTokens.toLocaleString()} / {row.outputTokens.toLocaleString()}
      </td>
      <td className="px-4 py-2.5 text-right font-data tabular-nums">{fmtCost(row.costUsd)}</td>
    </tr>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 font-data text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  )
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-4 py-2.5 font-medium ${className}`}>{children}</th>
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function fmtCost(n: number): string {
  return n > 0 && n < 0.01 ? '<$0.01' : `$${n.toFixed(2)}`
}

function fmtWhen(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
}
