import { ParentSize } from '@visx/responsive'
import type { UsageBucket, UsageByModel } from '@/services/llm'
import { BarChart } from '@/components/charts/bar-chart'
import { Bar } from '@/components/charts/bar'
import { BarXAxis } from '@/components/charts/bar-x-axis'
import { ChartTooltip } from '@/components/charts/tooltip'
import { RingChart } from '@/components/charts/ring-chart'
import { Ring } from '@/components/charts/ring'
import { RingCenter } from '@/components/charts/ring-center'
import {
  chartCssVars,
  defaultScatterColors,
} from '@/components/charts/chart-context'

export type MetricKey = 'totalTokens' | 'costUsd' | 'calls'

const color = (i: number) =>
  defaultScatterColors[i % defaultScatterColors.length]

function fmt(metric: MetricKey, n: number): string {
  if (metric === 'costUsd') return `$${n < 1 ? n.toFixed(4) : n.toFixed(2)}`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

/** Ranked horizontal-bar list — scales to many categories (scrollable), unlike
 *  a bar chart whose axis labels crowd as items grow. */
export function RankedBars({
  data,
  metric,
}: {
  data: { label: string; value: number }[]
  metric: MetricKey
}) {
  const sorted = [...data].sort((a, b) => b.value - a.value)
  if (sorted.length === 0 || sorted.every((d) => d.value <= 0)) return <Empty />
  const max = Math.max(...sorted.map((d) => d.value), 1)
  return (
    <ul className="max-h-72 space-y-3 overflow-y-auto scrollbar-hide">
      {sorted.map((d, i) => (
        <li key={d.label} className="space-y-1">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="min-w-0 truncate font-medium">{d.label}</span>
            <span className="shrink-0 font-data tabular-nums text-muted-foreground">
              {fmt(metric, d.value)}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${(d.value / max) * 100}%`, background: color(i) }}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}

interface BreakdownProps {
  byModel: UsageByModel[]
  byProvider: UsageBucket[]
  byKind: UsageBucket[]
  metric: MetricKey
}

export function UsageBreakdowns({
  byModel,
  byProvider,
  byKind,
  metric,
}: BreakdownProps) {
  return (
    <div className="grid divide-y divide-border/60 lg:grid-cols-3 lg:divide-x lg:divide-y-0">
      <ProviderDonut data={byProvider} metric={metric} />
      <CategoryBars
        data={byModel.map((m) => ({ label: m.modelName, value: m[metric] }))}
      />
      <CategoryBars
        data={byKind.map((k) => ({ label: k.label, value: k[metric] }))}
      />
    </div>
  )
}

export function ProviderDonut({
  data,
  metric,
}: {
  data: UsageBucket[]
  metric: MetricKey
}) {
  // Coerce: a missing/null metric (e.g. costUsd with no pricing) is NaN, and
  // `NaN <= 0` is false — without this the Empty guard is skipped and the ring
  // renders garbage arcs.
  const value = (b: UsageBucket) => Number(b[metric]) || 0
  const total = data.reduce((s, b) => s + value(b), 0)
  if (!(total > 0)) return <Empty />

  const rings = data.map((b, i) => ({
    label: b.label,
    value: value(b),
    maxValue: total,
    color: color(i),
  }))

  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="w-full max-w-[340px]">
        <ParentSize>
          {({ width }) =>
            width > 0 ? (
              <RingChart
                data={rings}
                size={width}
                strokeWidth={Math.max(8, width * 0.06)}
                baseInnerRadius={width * 0.26}
              >
                {rings.map((r, i) => (
                  <Ring key={r.label} index={i} color={r.color} />
                ))}
                <RingCenter
                  defaultLabel={metric === 'costUsd' ? 'total cost' : 'total'}
                  prefix={metric === 'costUsd' ? '$' : undefined}
                />
              </RingChart>
            ) : null
          }
        </ParentSize>
      </div>
    </div>
  )
}

export function CategoryBars({ data }: { data: { label: string; value: number }[] }) {
  // Coerce null/NaN metric values to 0 so the empty-guard and bars stay valid.
  const rows = data.map((d) => ({ label: d.label, value: Number(d.value) || 0 }))
  if (rows.length === 0 || rows.every((d) => d.value <= 0)) return <Empty />
  return (
    <BarChart
      data={rows.map((d) => ({ name: d.label, value: d.value }))}
      xDataKey="name"
      aspectRatio="2 / 1"
      margin={{ top: 12, right: 12, bottom: 40, left: 12 }}
    >
      <Bar dataKey="value" fill={chartCssVars.linePrimary} />
      <BarXAxis />
      <ChartTooltip />
    </BarChart>
  )
}

function Empty() {
  return (
    <p className="px-4 py-10 text-center text-sm text-muted-foreground">
      No activity in this range.
    </p>
  )
}
