import { useState } from 'react'
import { format, startOfWeek, startOfMonth, startOfYear } from 'date-fns'
import type { DateRange } from 'react-day-picker'
import { cn } from '@/lib/utils'
import { Calendar } from '@/components/ui/calendar'
import {
  Popover,
  PopoverContent,
  PopoverAnchor,
} from '@/components/ui/popover'
import { Button } from '@/components/ui/button'

type PeriodType = 'W' | 'M' | 'Y' | 'Custom'

interface PeriodFilterProps {
  value: DateRange
  onChange: (range: DateRange) => void
}

const PRESETS = [
  { key: 'W', label: 'WTD' },
  { key: 'M', label: 'MTD' },
  { key: 'Y', label: 'YTD' },
] as const

const ITEM_CLASS =
  'rounded px-2 py-1 text-xs font-medium transition-colors'

/** Week-/month-/year-to-date ranges relative to now (week starts Monday). */
function presetRange(type: 'W' | 'M' | 'Y'): DateRange {
  const now = new Date()
  if (type === 'W') return { from: startOfWeek(now, { weekStartsOn: 1 }), to: now }
  if (type === 'M') return { from: startOfMonth(now), to: now }
  return { from: startOfYear(now), to: now }
}

export function PeriodFilter({ value, onChange }: PeriodFilterProps) {
  const [type, setType] = useState<PeriodType>('Custom')
  const [open, setOpen] = useState(false)
  const [range, setRange] = useState<DateRange>(value)
  const today = new Date()

  function pickPreset(t: 'W' | 'M' | 'Y') {
    setType(t)
    setOpen(false)
    onChange(presetRange(t))
  }

  function applyRange() {
    if (!range.from || !range.to) return
    onChange(range)
    setOpen(false)
  }

  const customLabel =
    type === 'Custom' && range.from && range.to
      ? `${format(range.from, 'MMM d')} – ${format(range.to, 'MMM d')}`
      : 'Custom'

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div className="flex rounded-md border border-border p-0.5">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => pickPreset(p.key)}
              className={cn(
                ITEM_CLASS,
                type === p.key
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {p.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              setType('Custom')
              // Show the active range (don't wipe it); first click restarts via
              // the onSelect handler below.
              setRange(value)
              setOpen(true)
            }}
            className={cn(
              ITEM_CLASS,
              type === 'Custom'
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {customLabel}
          </button>
        </div>
      </PopoverAnchor>

      <PopoverContent className="w-auto p-3" align="end">
        <div className="space-y-3">
          <Calendar
            mode="range"
            numberOfMonths={1}
            defaultMonth={value.to ?? value.from ?? today}
            selected={range}
            onSelect={(r, clickedDay) =>
              // A complete range + a click means "start over" from the clicked
              // day, instead of RDP extending the existing range to a new `to`.
              setRange((prev) =>
                prev.from && prev.to
                  ? { from: clickedDay, to: undefined }
                  : (r ?? { from: undefined }),
              )
            }
            disabled={{ after: today }}
          />
          <Button
            onClick={applyRange}
            disabled={!range.from || !range.to}
            className="w-full"
          >
            Apply
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
