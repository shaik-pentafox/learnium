import { useEffect, useState, type ReactNode } from 'react'
import { animate } from 'motion/react'
import { cn } from '@/lib/utils'

interface StatCardProps {
  label: string
  value: string | number
  hint?: string
  icon?: ReactNode
}

export function StatCard({ label, value, hint, icon }: StatCardProps) {
  return (
    <div className="group relative overflow-hidden rounded-xl border border-border bg-surface p-4 shadow-sm shadow-black/5 transition-all duration-200">
      {/* faint icon watermark behind the content. */}
      {icon && (
        <span className="pointer-events-none absolute -top-4 -right-2 text-primary/10 transition-colors duration-300 [&_svg]:size-24">
          {icon}
        </span>
      )}

      <div className="relative">
        <span className="text-xs font-medium text-muted-foreground">
          {label}
        </span>
        <div className="mt-2.5 font-data text-3xl font-semibold leading-none tracking-tight text-primary tabular-nums">
          <AnimatedValue value={value} />
        </div>
        {hint && <div className="mt-2 text-xs text-muted-foreground">{hint}</div>}
      </div>
    </div>
  )
}

/** Count-up from 0 to `target`, ~0.9s ease-out. */
function Count({ target, decimals }: { target: number; decimals: number }) {
  const [display, setDisplay] = useState(0)
  useEffect(() => {
    const controls = animate(0, target, {
      duration: 0.9,
      ease: 'easeOut',
      onUpdate: (v) => setDisplay(v),
    })
    return () => controls.stop()
  }, [target])
  const rounded = Number(display.toFixed(decimals))
  return <>{decimals === 0 ? rounded.toLocaleString() : rounded.toFixed(decimals)}</>
}

/** Animate the numeric part of a value; keep any prefix/suffix ($, %). Renders
 *  static for non-numeric placeholders like "—" or "…". */
function AnimatedValue({ value }: { value: string | number }) {
  if (typeof value === 'number') return <Count target={value} decimals={0} />
  const match = value.match(/^(\D*)(-?[\d,]*\.?\d+)(\D*)$/)
  if (!match) return <>{value}</>
  const [, prefix, raw, suffix] = match
  const decimals = raw.includes('.') ? (raw.split('.')[1]?.length ?? 0) : 0
  return (
    <>
      {prefix}
      <Count target={parseFloat(raw.replace(/,/g, ''))} decimals={decimals} />
      {suffix}
    </>
  )
}

interface TileProps {
  title?: string
  action?: ReactNode
  className?: string
  children: ReactNode
}

/** A bordered card tile for the bento dashboard grid. */
export function Tile({ title, action, className, children }: TileProps) {
  return (
    <div
      className={cn(
        'flex flex-col rounded-xl border border-border bg-surface p-4 shadow-sm shadow-black/5',
        className,
      )}
    >
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-3">
          {title && <h3 className="text-sm font-medium">{title}</h3>}
          {action}
        </div>
      )}
      {children}
    </div>
  )
}

interface PanelProps {
  title: string
  action?: ReactNode
  children: ReactNode
}

export function Panel({ title, action, children }: PanelProps) {
  return (
    <section className="rounded-xl border border-border bg-surface shadow-sm shadow-black/5">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h2 className="text-sm font-medium">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

const STATUS_STYLE: Record<string, string> = {
  ACTIVE: 'bg-info/15 text-info',
  COMPLETED: 'bg-success-soft text-success',
  ABANDONED: 'bg-muted text-muted-foreground',
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_STYLE[status] ?? 'bg-muted'}`}
    >
      {status.toLowerCase()}
    </span>
  )
}

export function scoreLabel(pct: number | null): string {
  return pct === null ? '—' : `${pct}%`
}

export function DashboardSkeleton() {
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

export function DashboardError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4 text-sm">
      <p className="text-destructive">Couldn’t load your dashboard.</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-2 text-primary hover:underline"
      >
        Retry
      </button>
    </div>
  )
}
