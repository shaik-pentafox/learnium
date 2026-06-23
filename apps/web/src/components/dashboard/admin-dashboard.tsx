import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { Users, Drama, MessagesSquare, Coins } from 'lucide-react'
import type { DateRange } from 'react-day-picker'
import type { AdminSummary } from '@/services/dashboard'
import { listUsage, llmKeys, type UsageKeySeriesPoint } from '@/services/llm'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { AreaChart, Area } from '@/components/charts/area-chart'
import { Grid } from '@/components/charts/grid'
import { XAxis } from '@/components/charts/x-axis'
import { YAxis } from '@/components/charts/y-axis'
import { ChartTooltip } from '@/components/charts/tooltip'
import {
  chartCssVars,
  defaultScatterColors,
} from '@/components/charts/chart-context'
import { StatCard, Tile } from './primitives'
import { PeriodFilter } from './period-filter'
import { ProviderDonut, RankedBars } from './usage-breakdowns'

const DAY_MS = 86_400_000
const METRICS = [
  { key: 'totalTokens', label: 'Tokens' },
  { key: 'costUsd', label: 'Cost' },
  { key: 'calls', label: 'Calls' },
] as const
type MetricKey = (typeof METRICS)[number]['key']

const GROUPS = [
  { key: 'total', label: 'Total' },
  { key: 'model', label: 'Model' },
  { key: 'provider', label: 'Provider' },
] as const
type GroupKey = (typeof GROUPS)[number]['key']

const seriesColor = (i: number) =>
  defaultScatterColors[i % defaultScatterColors.length]

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function money(usd: number): string {
  return `$${usd.toFixed(usd < 1 ? 4 : 2)}`
}

export function AdminDashboard({ data }: { data: AdminSummary }) {
  const { totals } = data
  const [range, setRange] = useState<DateRange>({
    from: new Date(Date.now() - 29 * DAY_MS),
    to: new Date(),
  })
  const [metric, setMetric] = useState<MetricKey>('totalTokens')
  const [groupBy, setGroupBy] = useState<GroupKey>('total')

  const params = useMemo(
    () => ({
      ...(range.from ? { from: isoDate(range.from) } : {}),
      ...(range.to ? { to: isoDate(range.to) } : {}),
    }),
    [range],
  )
  const usage = useQuery({
    queryKey: llmKeys.usage(params),
    queryFn: () => listUsage(params),
    // Keep the prior range's data on screen while the new range loads, so the
    // chart stays mounted and morphs instead of unmounting → replaying its
    // grow animation on every filter change.
    placeholderData: keepPreviousData,
  })

  // One area for "total", or one area per model/provider (pivoted from the flat
  // per-day-per-key series onto the overall day range so gaps fill with 0).
  const { chartData, areaSeries } = useMemo(() => {
    const days = usage.data?.series ?? []
    if (groupBy === 'total') {
      return {
        chartData: days.map((p) => ({ date: new Date(p.date), value: p[metric] })),
        areaSeries: [{ key: 'value', color: chartCssVars.linePrimary }],
      }
    }
    const flat: UsageKeySeriesPoint[] =
      (groupBy === 'model'
        ? usage.data?.seriesByModel
        : usage.data?.seriesByProvider) ?? []
    const keys = Array.from(new Set(flat.map((r) => r.key)))
    const byDate = new Map<string, Record<string, number>>()
    for (const r of flat) {
      const row = byDate.get(r.date) ?? {}
      row[r.key] = r[metric]
      byDate.set(r.date, row)
    }
    return {
      chartData: days.map((p) => {
        const row: Record<string, unknown> = { date: new Date(p.date) }
        const hit = byDate.get(p.date)
        for (const k of keys) row[k] = hit?.[k] ?? 0
        return row
      }),
      areaSeries: keys.map((k, i) => ({ key: k, color: seriesColor(i) })),
    }
  }, [usage.data, groupBy, metric])

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Users" value={totals.users} icon={<Users />} hint={`${totals.trainers} trainers · ${totals.trainees} trainees`} />
      <StatCard label="Personas" value={totals.personas} icon={<Drama />} hint={`${totals.publishedPersonas} published`} />
      <StatCard label="Sessions" value={totals.sessions} icon={<MessagesSquare />} hint={`${totals.completed} completed`} />
      <StatCard
        label="LLM cost (range)"
        value={usage.data ? money(usage.data.totals.costUsd) : '…'}
        icon={<Coins />}
        hint={usage.data ? `${usage.data.totals.calls} calls` : undefined}
      />

      <Tile
        title="LLM usage"
        className="sm:col-span-2 xl:col-span-3"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              value={metric}
              onChange={(v) => setMetric(v as MetricKey)}
              options={METRICS}
            />
            <Segmented
              value={groupBy}
              onChange={(v) => setGroupBy(v as GroupKey)}
              options={GROUPS}
            />
            <PeriodFilter value={range} onChange={setRange} />
            <Link
              to="/llm-ops"
              className={buttonVariants({ variant: 'secondary', size: 'sm' })}
            >
              LLM Ops
            </Link>
          </div>
        }
      >
        {usage.isPending ? (
          <div className="h-56 animate-pulse rounded-md bg-muted" />
        ) : usage.isError ? (
          <p className="py-12 text-center text-sm text-destructive">
            Couldn’t load usage.
          </p>
        ) : chartData.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            No LLM activity in this range.
          </p>
        ) : (
          <div
            className={cn(
              'transition-opacity duration-500 ease-in-out',
              usage.isPlaceholderData && 'opacity-50',
            )}
          >
            <AreaChart
              key={`${groupBy}-${metric}-${usage.data?.since ?? ''}-${usage.data?.until ?? ''}`}
              data={chartData}
              aspectRatio="3 / 1"
              margin={{ top: 16, right: 16, bottom: 44, left: 52 }}
            >
              <Grid horizontal />
              {areaSeries.map((s) => (
                <Area
                  key={s.key}
                  dataKey={s.key}
                  fill={s.color}
                  fillOpacity={areaSeries.length > 1 ? 0.15 : 0.25}
                  fadeEdges
                />
              ))}
              <YAxis formatValue={metric === 'costUsd' ? money : undefined} />
              <XAxis numTicks={5} tickMode="domain" />
              <ChartTooltip />
            </AreaChart>
          </div>
        )}
      </Tile>

      {usage.data && (
        <>
          <Tile title="By provider" className="sm:col-span-2 xl:col-span-1">
            <ProviderDonut data={usage.data.byProvider} metric={metric} />
          </Tile>
          <Tile title="By model" className="sm:col-span-2">
            <RankedBars
              metric={metric}
              data={usage.data.byModel.map((m) => ({
                label: m.modelName,
                value: m[metric],
              }))}
            />
          </Tile>
          <Tile title="By kind" className="sm:col-span-2">
            <RankedBars
              metric={metric}
              data={usage.data.byKind.map((k) => ({
                label: k.label,
                value: k[metric],
              }))}
            />
          </Tile>
        </>
      )}
    </div>
  )
}

interface SegmentedProps {
  value: string
  onChange: (value: string) => void
  options: readonly { key: string; label: string }[]
}

function Segmented({ value, onChange, options }: SegmentedProps) {
  return (
    <div className="flex rounded-md border border-border p-0.5">
      {options.map((o) => (
        <button
          key={o.key}
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
