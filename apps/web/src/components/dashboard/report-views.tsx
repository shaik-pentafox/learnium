import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import type { DateRange } from 'react-day-picker'
import { Search } from 'lucide-react'
import {
  reportTrainers,
  reportPersonas,
  dashboardKeys,
  type TraineeSummary,
  type TrainerSummary,
  type TraineePersonaStat,
  type TrainerTraineeRow,
  type TrainerReportRow,
  type PersonaReportRow,
  type AdminSummary,
} from '@/services/dashboard'
import {
  listSessions,
  sessionKeys,
  type SessionSummary,
  type SessionScore,
} from '@/services/sessions'
import {
  listUsage,
  llmKeys,
  type UsageByModel,
  type UsageBucket,
} from '@/services/llm'
import { StatusBadge, scoreLabel, fmtMs } from './primitives'
import { PeriodFilter } from './period-filter'
import { DataTable } from '@/components/shared/data-table'
import { FacetFilter } from '@/components/shared/facet-filter'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'

const DAY_MS = 86_400_000

// ── shared helpers ───────────────────────────────────────────────────────────

function pooledPct(scores: SessionScore[]): number | null {
  const scored = scores.filter((s) => s.score !== null)
  if (scored.length === 0) return null
  const earned = scored.reduce((sum, s) => sum + (s.score ?? 0), 0)
  const max = scored.reduce((sum, s) => sum + s.maxScore, 0)
  return max > 0 ? Math.round((earned / max) * 100) : null
}

function durationMs(s: SessionSummary): number | null {
  if (!s.endedAt) return null
  const ms = new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime()
  return ms > 0 ? ms : null
}

function fmtDuration(ms: number | null): string {
  if (ms === null) return '—'
  const totalSec = Math.round(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function money(usd: number): string {
  return `$${usd.toFixed(usd < 1 ? 4 : 2)}`
}

function num(n: number): string {
  return n.toLocaleString()
}

function scoreTone(pct: number | null): string {
  if (pct === null) return 'text-muted-foreground'
  if (pct >= 80) return 'text-success'
  if (pct >= 60) return 'text-warning'
  return 'text-destructive'
}

function Score({ pct }: { pct: number | null }) {
  return <span className={scoreTone(pct)}>{scoreLabel(pct)}</span>
}

const PAGE_SIZE = 20

interface TabView {
  value: string
  label: string
  content: ReactNode
}

/** A role report: a tab strip wired to the URL `?tab=` param. Falls back to the
 *  first tab when the param is absent or not valid for this role. */
function ReportTabs({
  tabs,
  tab,
  onTabChange,
}: {
  tabs: TabView[]
  tab?: string
  onTabChange: (tab: string) => void
}) {
  const active = tabs.some((t) => t.value === tab) ? (tab as string) : tabs[0].value
  return (
    <Tabs value={active} onValueChange={onTabChange}>
      <TabsList>
        {tabs.map((t) => (
          <TabsTrigger key={t.value} value={t.value}>
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((t) => (
        <TabsContent key={t.value} value={t.value}>
          {t.content}
        </TabsContent>
      ))}
    </Tabs>
  )
}

// ── server-paginated session history (trainee/trainer) ───────────────────────

function SessionsTab({ withTrainee }: { withTrainee: boolean }) {
  const [pageIndex, setPageIndex] = useState(0)
  const query = useQuery({
    queryKey: sessionKeys.list({ page: pageIndex + 1, limit: PAGE_SIZE }),
    queryFn: () => listSessions({ page: pageIndex + 1, limit: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  })

  const rows = query.data?.sessions ?? []
  const columns: ColumnDef<SessionSummary>[] = [
    ...(withTrainee
      ? [
          {
            id: 'trainee',
            header: 'Trainee',
            accessorFn: (s: SessionSummary) =>
              s.user ? `${s.user.firstName} ${s.user.lastName}`.trim() : '—',
            cell: ({ getValue }) => (
              <span className="font-medium">{getValue() as string}</span>
            ),
          } as ColumnDef<SessionSummary>,
        ]
      : []),
    {
      id: 'scenario',
      header: 'Persona',
      accessorFn: (s) => s.persona.name,
      cell: ({ getValue }) => (
        <span className={withTrainee ? '' : 'font-medium'}>
          {getValue() as string}
        </span>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      accessorFn: (s) => s.status,
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
    },
    {
      id: 'score',
      header: 'Score',
      accessorFn: (s) => pooledPct(s.scores) ?? -1,
      cell: ({ row }) => <Score pct={pooledPct(row.original.scores)} />,
    },
    {
      id: 'duration',
      header: 'Duration',
      accessorFn: (s) => durationMs(s) ?? -1,
      cell: ({ row }) => fmtDuration(durationMs(row.original)),
    },
    {
      id: 'started',
      header: 'Started',
      accessorFn: (s) => s.startedAt,
      cell: ({ row }) => (
        <span className="text-muted-foreground">{fmtDate(row.original.startedAt)}</span>
      ),
    },
  ]

  return (
    <DataTable
      columns={columns}
      data={rows}
      isLoading={query.isPending}
      emptyMessage="No sessions yet."
      pageSizeOptions={[PAGE_SIZE]}
      manualPagination={{
        pageIndex,
        pageSize: PAGE_SIZE,
        pageCount: query.data?.totalPages ?? 1,
        rowCount: query.data?.total ?? 0,
        onPaginationChange: (updater) => {
          const next =
            typeof updater === 'function'
              ? updater({ pageIndex, pageSize: PAGE_SIZE })
              : updater
          setPageIndex(next.pageIndex)
        },
      }}
    />
  )
}

// ── shared paged-table bits ──────────────────────────────────────────────────

function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

function TableSearch({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
}) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-8 w-56 pl-7 text-xs"
      />
    </div>
  )
}

function PublishedBadge({ published }: { published: boolean }) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-xs font-medium ${
        published ? 'bg-success-soft text-success' : 'bg-muted text-muted-foreground'
      }`}
    >
      {published ? 'published' : 'draft'}
    </span>
  )
}

const ADMIN_PAGE_SIZE = 20

// ── Admin: trainers rollup (paginated + search) ──────────────────────────────

function TrainersTab() {
  const [page, setPage] = useState(1)
  const [qInput, setQInput] = useState('')
  const q = useDebounced(qInput)
  useEffect(() => setPage(1), [q])

  const query = useQuery({
    queryKey: dashboardKeys.reportTrainers({ page, limit: ADMIN_PAGE_SIZE, q }),
    queryFn: () => reportTrainers({ page, limit: ADMIN_PAGE_SIZE, q: q || undefined }),
    placeholderData: keepPreviousData,
  })

  const columns: ColumnDef<TrainerReportRow>[] = [
    {
      id: 'name',
      header: 'Trainer',
      accessorFn: (t) => t.name,
      cell: ({ row }) => (
        <div>
          <div className="font-medium">{row.original.name}</div>
          <div className="text-xs text-muted-foreground">{row.original.email}</div>
        </div>
      ),
    },
    { accessorKey: 'trainees', header: 'Trainees' },
    { accessorKey: 'sessions', header: 'Sessions' },
    { accessorKey: 'completed', header: 'Completed' },
    {
      id: 'avg',
      header: 'Avg score',
      accessorFn: (t) => t.avgScorePct ?? -1,
      cell: ({ row }) => <Score pct={row.original.avgScorePct} />,
    },
  ]

  return (
    <DataTable
      columns={columns}
      data={query.data?.rows ?? []}
      isLoading={query.isPending}
      emptyMessage="No trainers found."
      pageSizeOptions={[ADMIN_PAGE_SIZE]}
      toolbar={<TableSearch value={qInput} onChange={setQInput} placeholder="Search trainers…" />}
      manualPagination={manualPage(page, setPage, query.data)}
    />
  )
}

// ── Admin: personas rollup (paginated + search + published filter) ───────────

function PersonasTab() {
  const [page, setPage] = useState(1)
  const [qInput, setQInput] = useState('')
  const [published, setPublished] = useState<string[]>([])
  const q = useDebounced(qInput)
  useEffect(() => setPage(1), [q, published])

  const publishedFlag =
    published.length === 1 ? published[0] === 'true' : undefined
  const query = useQuery({
    queryKey: dashboardKeys.reportPersonas({
      page,
      limit: ADMIN_PAGE_SIZE,
      q,
      published: publishedFlag,
    }),
    queryFn: () =>
      reportPersonas({
        page,
        limit: ADMIN_PAGE_SIZE,
        q: q || undefined,
        published: publishedFlag,
      }),
    placeholderData: keepPreviousData,
  })

  const columns: ColumnDef<PersonaReportRow>[] = [
    {
      accessorKey: 'name',
      header: 'Persona',
      cell: ({ getValue }) => <span className="font-medium">{getValue() as string}</span>,
    },
    {
      accessorKey: 'owner',
      header: 'Owner',
      cell: ({ getValue }) => (
        <span className="text-muted-foreground">{getValue() as string}</span>
      ),
    },
    {
      id: 'published',
      header: 'State',
      accessorFn: (p) => (p.published ? 1 : 0),
      cell: ({ row }) => <PublishedBadge published={row.original.published} />,
    },
    { accessorKey: 'sessions', header: 'Sessions' },
    {
      id: 'avg',
      header: 'Avg score',
      accessorFn: (p) => p.avgScorePct ?? -1,
      cell: ({ row }) => <Score pct={row.original.avgScorePct} />,
    },
  ]

  return (
    <DataTable
      columns={columns}
      data={query.data?.rows ?? []}
      isLoading={query.isPending}
      emptyMessage="No personas found."
      pageSizeOptions={[ADMIN_PAGE_SIZE]}
      toolbar={
        <>
          <TableSearch value={qInput} onChange={setQInput} placeholder="Search personas…" />
          <FacetFilter
            title="State"
            single
            options={[
              { label: 'Published', value: 'true' },
              { label: 'Draft', value: 'false' },
            ]}
            selected={published}
            onChange={setPublished}
          />
        </>
      }
      manualPagination={manualPage(page, setPage, query.data)}
    />
  )
}

/** Build DataTable manualPagination wiring from a 1-based page + paged result. */
function manualPage(
  page: number,
  setPage: (p: number) => void,
  data?: { totalPages: number; total: number },
) {
  return {
    pageIndex: page - 1,
    pageSize: ADMIN_PAGE_SIZE,
    pageCount: data?.totalPages ?? 1,
    rowCount: data?.total ?? 0,
    onPaginationChange: (updater: unknown) => {
      const next =
        typeof updater === 'function'
          ? (updater as (s: { pageIndex: number; pageSize: number }) => {
              pageIndex: number
            })({ pageIndex: page - 1, pageSize: ADMIN_PAGE_SIZE })
          : (updater as { pageIndex: number })
      setPage(next.pageIndex + 1)
    },
  }
}

// ── Trainee report ───────────────────────────────────────────────────────────

export function TraineeReport({
  data,
  tab,
  onTabChange,
}: {
  data: TraineeSummary
  tab?: string
  onTabChange: (tab: string) => void
}) {
  const { byPersona, totals } = data

  const scenarioCols: ColumnDef<TraineePersonaStat>[] = [
    { accessorKey: 'personaName', header: 'Scenario', cell: ({ getValue }) => (
      <span className="font-medium">{getValue() as string}</span>
    ) },
    { accessorKey: 'sessions', header: 'Sessions' },
    {
      id: 'avg',
      header: 'Avg score',
      accessorFn: (p) => p.avgScorePct ?? -1,
      cell: ({ row }) => <Score pct={row.original.avgScorePct} />,
    },
  ]

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Metric label="Your avg reply" value={fmtMs(totals.avgResponseMs)} />
        <Metric label="AI avg reply" value={fmtMs(totals.avgLlmLatencyMs)} />
        <Metric label="Avg score" value={scoreLabel(totals.avgScorePct)} />
        <Metric label="Best score" value={scoreLabel(totals.bestScorePct)} />
      </div>

      <ReportTabs
        tab={tab}
        onTabChange={onTabChange}
        tabs={[
        {
          value: 'scenarios',
          label: 'Personas',
          content: (
            <DataTable
              columns={scenarioCols}
              data={byPersona}
              searchable
              searchPlaceholder="Search personas…"
              emptyMessage="No sessions yet."
            />
          ),
        },
        {
          value: 'sessions',
          label: 'Sessions',
          content: <SessionsTab withTrainee={false} />,
        },
        ]}
      />
    </div>
  )
}

// ── Trainer report ───────────────────────────────────────────────────────────

export function TrainerReport({
  data,
  tab,
  onTabChange,
}: {
  data: TrainerSummary
  tab?: string
  onTabChange: (tab: string) => void
}) {
  const { trainees, byPersona, totals, personas } = data

  const traineeCols: ColumnDef<TrainerTraineeRow>[] = [
    { accessorKey: 'name', header: 'Name', cell: ({ getValue }) => (
      <span className="font-medium">{getValue() as string}</span>
    ) },
    { accessorKey: 'sessions', header: 'Sessions' },
    { accessorKey: 'completed', header: 'Completed' },
    {
      id: 'avg',
      header: 'Avg score',
      accessorFn: (t) => t.avgScorePct ?? -1,
      cell: ({ row }) => <Score pct={row.original.avgScorePct} />,
    },
    {
      id: 'lastActive',
      header: 'Last active',
      accessorFn: (t) => t.lastActiveAt ?? '',
      cell: ({ row }) => (
        <span className="text-muted-foreground">
          {row.original.lastActiveAt ? fmtDate(row.original.lastActiveAt) : '—'}
        </span>
      ),
    },
  ]

  const scenarioCols: ColumnDef<TraineePersonaStat>[] = [
    { accessorKey: 'personaName', header: 'Scenario', cell: ({ getValue }) => (
      <span className="font-medium">{getValue() as string}</span>
    ) },
    { accessorKey: 'sessions', header: 'Sessions' },
    {
      id: 'avg',
      header: 'Avg score',
      accessorFn: (p) => p.avgScorePct ?? -1,
      cell: ({ row }) => <Score pct={row.original.avgScorePct} />,
    },
  ]

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <Metric label="Trainees" value={String(totals.trainees)} />
        <Metric label="Sessions" value={String(totals.sessions)} />
        <Metric label="Completed" value={String(totals.completed)} />
        <Metric label="Team avg score" value={scoreLabel(totals.avgScorePct)} />
        <Metric label="Avg reply" value={fmtMs(totals.avgResponseMs)} />
        <Metric label="Personas" value={`${personas.published}/${personas.total}`} />
      </div>

      <ReportTabs
        tab={tab}
        onTabChange={onTabChange}
        tabs={[
        {
          value: 'trainees',
          label: 'Trainees',
          content: (
            <DataTable
              columns={traineeCols}
              data={trainees}
              searchable
              searchPlaceholder="Search trainees…"
              emptyMessage="No trainees yet."
            />
          ),
        },
        {
          value: 'scenarios',
          label: 'Personas',
          content: (
            <DataTable
              columns={scenarioCols}
              data={byPersona}
              searchable
              searchPlaceholder="Search personas…"
              emptyMessage="No sessions yet."
            />
          ),
        },
        {
          value: 'sessions',
          label: 'Sessions',
          content: <SessionsTab withTrainee />,
        },
        ]}
      />
    </div>
  )
}

// ── Admin report ─────────────────────────────────────────────────────────────

export function AdminReport({
  data,
  tab,
  onTabChange,
}: {
  data: AdminSummary
  tab?: string
  onTabChange: (tab: string) => void
}) {
  const { totals } = data
  const [range, setRange] = useState<DateRange>({
    from: new Date(Date.now() - 29 * DAY_MS),
    to: new Date(),
  })
  const params = useMemo(
    () => ({
      ...(range.from ? { from: range.from.toISOString().slice(0, 10) } : {}),
      ...(range.to ? { to: range.to.toISOString().slice(0, 10) } : {}),
    }),
    [range],
  )
  const usage = useQuery({
    queryKey: llmKeys.usage(params),
    queryFn: () => listUsage(params),
    placeholderData: keepPreviousData,
  })

  const modelCols: ColumnDef<UsageByModel>[] = [
    { accessorKey: 'modelName', header: 'Model', cell: ({ getValue }) => (
      <span className="font-medium">{getValue() as string}</span>
    ) },
    { accessorKey: 'calls', header: 'Calls', cell: ({ getValue }) => num(getValue() as number) },
    { accessorKey: 'totalTokens', header: 'Tokens', cell: ({ getValue }) => num(getValue() as number) },
    { accessorKey: 'costUsd', header: 'Cost', cell: ({ getValue }) => money(getValue() as number) },
    {
      id: 'latency',
      header: 'Avg latency',
      accessorFn: (m) => m.avgLatencyMs ?? -1,
      cell: ({ row }) => fmtMs(row.original.avgLatencyMs),
    },
  ]

  const providerCols: ColumnDef<UsageBucket>[] = [
    { accessorKey: 'label', header: 'Provider', cell: ({ getValue }) => (
      <span className="font-medium">{getValue() as string}</span>
    ) },
    { accessorKey: 'calls', header: 'Calls', cell: ({ getValue }) => num(getValue() as number) },
    { accessorKey: 'totalTokens', header: 'Tokens', cell: ({ getValue }) => num(getValue() as number) },
    { accessorKey: 'costUsd', header: 'Cost', cell: ({ getValue }) => money(getValue() as number) },
  ]

  const filter = <PeriodFilter value={range} onChange={setRange} />
  const loading = usage.isPending

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
        <Metric label="Users" value={String(totals.users)} />
        <Metric label="Trainers" value={String(totals.trainers)} />
        <Metric label="Trainees" value={String(totals.trainees)} />
        <Metric label="Personas" value={`${totals.publishedPersonas}/${totals.personas}`} />
        <Metric label="Sessions" value={String(totals.sessions)} />
        <Metric label="AI avg latency" value={fmtMs(totals.avgLlmLatencyMs)} />
        <Metric label="User avg reply" value={fmtMs(totals.avgResponseMs)} />
      </div>

      <ReportTabs
        tab={tab}
        onTabChange={onTabChange}
        tabs={[
          { value: 'trainers', label: 'Trainers', content: <TrainersTab /> },
          { value: 'personas', label: 'Personas', content: <PersonasTab /> },
          {
            value: 'sessions',
            label: 'Sessions',
            content: <SessionsTab withTrainee />,
          },
          {
            value: 'models',
            label: 'Models',
            content: (
              <DataTable
                columns={modelCols}
                data={usage.data?.byModel ?? []}
                isLoading={loading}
                searchable
                searchPlaceholder="Search models…"
                emptyMessage="No usage in this range."
                toolbarRight={filter}
              />
            ),
          },
          {
            value: 'providers',
            label: 'Providers',
            content: (
              <DataTable
                columns={providerCols}
                data={usage.data?.byProvider ?? []}
                isLoading={loading}
                emptyMessage="No usage in this range."
                toolbarRight={filter}
              />
            ),
          },
        ]}
      />
    </div>
  )
}

// ── small UI bits ────────────────────────────────────────────────────────────

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-sm shadow-black/5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="mt-2 font-data text-2xl font-semibold leading-none tracking-tight tabular-nums text-primary">
        {value}
      </div>
    </div>
  )
}
