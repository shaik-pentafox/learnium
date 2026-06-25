import { useState, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { Users, MessagesSquare, CheckCircle2, Target, Timer } from 'lucide-react'
import type {
  TrainerSummary,
  TrainerTraineeRow,
  TrainerPersonaStat,
  TrainerRecent,
} from '@/services/dashboard'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { AreaChart, Area } from '@/components/charts/area-chart'
import { Grid } from '@/components/charts/grid'
import { XAxis } from '@/components/charts/x-axis'
import { YAxis } from '@/components/charts/y-axis'
import { ChartTooltip } from '@/components/charts/tooltip'
import { chartCssVars } from '@/components/charts/chart-context'
import { StatCard, Tile, StatusBadge, scoreLabel, fmtMs, ViewAll } from './primitives'
import { StatusDonut } from './dashboard-charts'

function scoreBarColor(pct: number | null): string {
  if (pct === null) return 'bg-muted'
  if (pct >= 80) return 'bg-success'
  if (pct >= LOW_SCORE_PCT) return 'bg-warning'
  return 'bg-destructive'
}

const LOW_SCORE_PCT = 60
const PREVIEW = 5
const INACTIVE_DAYS = 7
const DAY_MS = 86_400_000

const WINDOWS = [
  { key: 7, label: '7d' },
  { key: 30, label: '30d' },
  { key: 90, label: '90d' },
] as const
type WindowDays = (typeof WINDOWS)[number]['key']

const ACT_METRICS = [
  { key: 'sessions', label: 'Sessions' },
  { key: 'avgScorePct', label: 'Avg score' },
] as const
type ActMetric = (typeof ACT_METRICS)[number]['key']

function Toggle<T extends string | number>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (v: T) => void
  options: readonly { key: T; label: string }[]
}) {
  return (
    <div className="flex rounded-md border border-border p-0.5">
      {options.map((o) => (
        <button
          key={String(o.key)}
          type="button"
          onClick={() => onChange(o.key)}
          className={cn(
            'rounded px-2.5 py-1 text-xs font-medium transition-colors',
            value === o.key
              ? 'bg-muted text-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function TrainerDashboard({ data }: { data: TrainerSummary }) {
  const { totals, trainees, byPersona, recent, series, personas } = data
  const completionRate = totals.sessions
    ? Math.round((totals.completed / totals.sessions) * 100)
    : null
  // Highlight the strongest trainee (list is sorted weakest-first).
  const topId = trainees.reduce<{ id: number; pct: number } | null>((best, t) => {
    if (t.avgScorePct === null) return best
    return best === null || t.avgScorePct > best.pct
      ? { id: t.id, pct: t.avgScorePct }
      : best
  }, null)?.id

  const [windowDays, setWindowDays] = useState<WindowDays>(30)
  const [actMetric, setActMetric] = useState<ActMetric>('sessions')
  // Key the series by its display label so the tooltip reads "Sessions" /
  // "Avg score" instead of the raw API field name.
  const actLabel = ACT_METRICS.find((m) => m.key === actMetric)?.label ?? 'Sessions'
  const windowed = series.slice(-windowDays)
  // Key by the raw metric (no spaces — used in the gradient's SVG id); the
  // friendly label is shown via the tooltip row.
  const chartData = windowed.map((p) => ({
    date: new Date(p.date),
    [actMetric]: actMetric === 'sessions' ? p.sessions : (p.avgScorePct ?? 0),
  }))
  const hasActivity = windowed.some((p) => p.sessions > 0)

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
      <StatCard label="Trainees" value={totals.trainees} icon={<Users />} />
      <StatCard label="Sessions" value={totals.sessions} icon={<MessagesSquare />} />
      <StatCard
        label="Completed"
        value={totals.completed}
        icon={<CheckCircle2 />}
        hint={
          completionRate === null
            ? undefined
            : `${completionRate}% rate · ${totals.abandoned} abandoned`
        }
      />
      <StatCard label="Team avg score" value={scoreLabel(totals.avgScorePct)} icon={<Target />} />
      <StatCard
        label="Trainees avg reply"
        value={fmtMs(totals.avgResponseMs)}
        icon={<Timer />}
        hint="team response speed"
      />

      <Tile
        title="Activity"
        className="sm:col-span-2 xl:col-span-3"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Toggle value={actMetric} onChange={setActMetric} options={ACT_METRICS} />
            <Toggle value={windowDays} onChange={setWindowDays} options={WINDOWS} />
          </div>
        }
      >
        {hasActivity ? (
          <AreaChart
            key={actMetric}
            data={chartData}
            aspectRatio="auto"
            className="min-h-64 flex-1"
            margin={{ top: 16, right: 16, bottom: 44, left: 44 }}
          >
            <Grid horizontal />
            <Area dataKey={actMetric} fill={chartCssVars.linePrimary} fillOpacity={0.25} fadeEdges />
            <YAxis />
            <XAxis numTicks={5} tickMode="domain" />
            <ChartTooltip
              rows={(point) => [
                {
                  label: actLabel,
                  value: Number(point[actMetric] ?? 0),
                  color: chartCssVars.linePrimary,
                },
              ]}
            />
          </AreaChart>
        ) : (
          <p className="flex-1 py-10 text-center text-sm text-muted-foreground">
            No trainee activity in this period.
          </p>
        )}
      </Tile>

      <Tile title="Session outcomes" className="sm:col-span-2 xl:col-span-2">
        <div className="flex flex-1 items-center justify-center">
          <StatusDonut
            completed={totals.completed}
            abandoned={totals.abandoned}
            ongoing={Math.max(
              0,
              totals.sessions - totals.completed - totals.abandoned,
            )}
          />
        </div>
      </Tile>

      <Tile
        title="Trainees"
        className="sm:col-span-2 xl:col-span-2"
        action={
          <div className="flex items-center gap-3">
            <ViewAll tab="trainees" />
            <Link
              to="/users"
              search={{ page: 1 }}
              className={buttonVariants({ variant: 'secondary', size: 'sm' })}
            >
              Manage
            </Link>
          </div>
        }
      >
        {trainees.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No trainees yet. Add team members from the Users tab.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {trainees.slice(0, PREVIEW).map((t) => (
              <TraineeRow key={t.id} row={t} isTop={t.id === topId} />
            ))}
          </ul>
        )}
      </Tile>

      <Tile
        title="Personas"
        className="sm:col-span-2 xl:col-span-3"
        action={<ViewAll tab="scenarios" />}
      >
        {byPersona.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No sessions yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {byPersona.slice(0, PREVIEW).map((p) => (
              <PersonaRow key={p.personaName} row={p} />
            ))}
          </ul>
        )}
      </Tile>

      <Tile
        title="Recent sessions"
        className="sm:col-span-2 xl:col-span-3"
        action={<ViewAll tab="sessions" />}
      >
        {recent.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No sessions yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {recent.map((r) => (
              <RecentRow key={r.uid} row={r} />
            ))}
          </ul>
        )}
      </Tile>

      <Tile title="Persona library" className="self-start sm:col-span-2 xl:col-span-2">
        <div className="flex items-center justify-around gap-4 py-2">
          <PersonaStat label="Total" value={personas.total} />
          <span className="h-10 w-px bg-border" />
          <PersonaStat label="Published" value={personas.published} tone="text-primary" />
          <span className="h-10 w-px bg-border" />
          <PersonaStat
            label="Draft"
            value={personas.total - personas.published}
            tone="text-muted-foreground"
          />
        </div>
      </Tile>
    </div>
  )
}

function PersonaStat({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone?: string
}) {
  return (
    <div className="text-center">
      <div className={cn('font-data text-3xl font-semibold tabular-nums', tone)}>
        {value}
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{label}</div>
    </div>
  )
}

function TraineeRow({ row, isTop }: { row: TrainerTraineeRow; isTop: boolean }) {
  const low = row.avgScorePct !== null && row.avgScorePct < LOW_SCORE_PCT
  const inactive =
    !row.lastActiveAt ||
    Date.now() - new Date(row.lastActiveAt).getTime() > INACTIVE_DAYS * DAY_MS
  return (
    <li className="flex items-center justify-between gap-3 py-3 text-sm">
      <div className="min-w-0">
        <div className="truncate font-medium">{row.name}</div>
        <div className="text-xs text-muted-foreground">
          {row.sessions} session{row.sessions === 1 ? '' : 's'} · {row.completed} completed
        </div>
      </div>
      <span className="flex shrink-0 items-center gap-2">
        {isTop && row.avgScorePct !== null && (
          <Badge tone="success">top</Badge>
        )}
        {inactive && <Badge tone="muted">inactive</Badge>}
        {low && <Badge tone="warning">needs help</Badge>}
        <span
          className={cn(
            'font-data tabular-nums',
            low ? 'text-warning' : 'text-muted-foreground',
          )}
        >
          {scoreLabel(row.avgScorePct)}
        </span>
      </span>
    </li>
  )
}

function PersonaRow({ row }: { row: TrainerPersonaStat }) {
  return (
    <li className="space-y-1.5 py-3">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="min-w-0 truncate font-medium">{row.personaName}</span>
        <span className="shrink-0 font-data tabular-nums text-muted-foreground">
          {scoreLabel(row.avgScorePct)}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
          <div
            className={cn('h-full rounded-full', scoreBarColor(row.avgScorePct))}
            style={{ width: `${row.avgScorePct ?? 0}%` }}
          />
        </div>
        <span className="shrink-0 font-data text-xs tabular-nums text-muted-foreground">
          {row.sessions}×
        </span>
      </div>
    </li>
  )
}

function RecentRow({ row }: { row: TrainerRecent }) {
  return (
    <li className="flex items-center justify-between gap-3 py-3 text-sm">
      <div className="min-w-0">
        <div className="truncate font-medium">{row.traineeName}</div>
        <div className="truncate text-xs text-muted-foreground">{row.personaName}</div>
      </div>
      <span className="flex shrink-0 items-center gap-2">
        <StatusBadge status={row.status} />
        <span className="font-data tabular-nums text-muted-foreground">
          {scoreLabel(row.scorePct)}
        </span>
      </span>
    </li>
  )
}

function Badge({
  tone,
  children,
}: {
  tone: 'success' | 'warning' | 'muted'
  children: ReactNode
}) {
  const styles = {
    success: 'bg-success/15 text-success',
    warning: 'bg-warning/15 text-warning',
    muted: 'bg-muted text-muted-foreground',
  }
  return (
    <span className={cn('rounded px-1.5 py-0.5 text-xs font-medium', styles[tone])}>
      {children}
    </span>
  )
}
