import { useState } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import {
  listUsage,
  listUsageCalls,
  llmKeys,
  type UsageRow,
} from '@/services/llm'
import { DataTable } from '@/components/shared/data-table'
import { FacetFilter } from '@/components/shared/facet-filter'

const PARAMS = { days: 30 }
const CALLS_PAGE_SIZE = 20

const RECENT_COLUMNS: ColumnDef<UsageRow>[] = [
  {
    accessorKey: 'createdAt',
    header: 'When',
    cell: ({ getValue }) => (
      <span className="text-muted-foreground">{fmtWhen(getValue() as string)}</span>
    ),
  },
  {
    accessorKey: 'kind',
    header: 'Kind',
    cell: ({ getValue }) => (
      <span className="rounded bg-muted px-1.5 py-0.5 text-xs">{getValue() as string}</span>
    ),
  },
  {
    accessorKey: 'modelName',
    header: 'Model',
    cell: ({ row }) => (
      <span className="font-data">
        {row.original.modelName}
        {row.original.estimated && (
          <span
            className="ml-2 text-xs text-muted-foreground"
            title="Tokens estimated (no provider usage)"
          >
            est
          </span>
        )}
      </span>
    ),
  },
  {
    id: 'inout',
    header: 'In / Out',
    accessorFn: (r) => r.totalTokens,
    cell: ({ row }) => (
      <span className="font-data tabular-nums text-muted-foreground">
        {row.original.inputTokens.toLocaleString()} /{' '}
        {row.original.outputTokens.toLocaleString()}
      </span>
    ),
  },
  {
    accessorKey: 'costUsd',
    header: 'Cost',
    cell: ({ getValue }) => fmtCost(getValue() as number),
  },
]

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

          {/* Recent calls — own paginated, filterable query */}
          <RecentCallsTable />
        </>
      )}
    </section>
  )
}

function RecentCallsTable() {
  const [page, setPage] = useState(1)
  const [kinds, setKinds] = useState<string[]>([])
  const [models, setModels] = useState<string[]>([])

  const calls = useQuery({
    queryKey: llmKeys.usageCalls({ page, limit: CALLS_PAGE_SIZE, kind: kinds, model: models }),
    queryFn: () =>
      listUsageCalls({ page, limit: CALLS_PAGE_SIZE, kind: kinds, model: models }),
    placeholderData: keepPreviousData,
  })

  const facets = calls.data?.facets ?? { kinds: [], models: [] }

  const toolbar = (
    <>
      <FacetFilter
        title="Kind"
        options={facets.kinds}
        selected={kinds}
        onChange={(next) => {
          setKinds(next)
          setPage(1)
        }}
      />
      <FacetFilter
        title="Model"
        options={facets.models}
        selected={models}
        onChange={(next) => {
          setModels(next)
          setPage(1)
        }}
      />
    </>
  )

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-medium text-muted-foreground">Recent calls</h3>
      <DataTable
        columns={RECENT_COLUMNS}
        data={calls.data?.rows ?? []}
        isLoading={calls.isPending}
        emptyMessage="No calls match the filters."
        pageSizeOptions={[CALLS_PAGE_SIZE]}
        toolbar={toolbar}
        manualPagination={{
          pageIndex: page - 1,
          pageSize: CALLS_PAGE_SIZE,
          pageCount: calls.data?.totalPages ?? 1,
          rowCount: calls.data?.total ?? 0,
          onPaginationChange: (updater) => {
            const next =
              typeof updater === 'function'
                ? updater({ pageIndex: page - 1, pageSize: CALLS_PAGE_SIZE })
                : updater
            setPage(next.pageIndex + 1)
          },
        }}
      />
    </div>
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
