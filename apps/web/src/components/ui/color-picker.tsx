import { useEffect, useState } from 'react'
import { HexColorPicker } from 'react-colorful'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

/** Full 6-digit hex, lowercased. Anything else → null (invalid). */
function normalizeHex(value: string): string | null {
  const v = value.trim().toLowerCase()
  const withHash = v.startsWith('#') ? v : `#${v}`
  return /^#[0-9a-f]{6}$/.test(withHash) ? withHash : null
}

interface ColorPickerPopoverProps {
  /** Controlled hex value (#rrggbb). */
  value?: string
  /** Initial hex for uncontrolled use. */
  defaultValue?: string
  /** Fires with a normalized 6-digit hex whenever the color changes. */
  onValueChange: (hex: string) => void
  /** Quick-pick brand colors shown as a swatch grid. */
  swatches?: readonly string[]
  /** Text shown on the trigger next to the swatch chip. */
  triggerLabel?: string
  /** Show the current hex value on the trigger. */
  triggerShowValue?: boolean
  disabled?: boolean
  className?: string
}

/**
 * Hex-only color picker themed to the app: a swatch-chip trigger that opens a
 * popover with a saturation/hue field (react-colorful), the brand swatch grid,
 * and a hex input. No alpha, no format switching — persona accents are solid
 * `#rrggbb`.
 */
export function ColorPickerPopover({
  value,
  defaultValue = '#6366f1',
  onValueChange,
  swatches,
  triggerLabel,
  triggerShowValue,
  disabled,
  className,
}: ColorPickerPopoverProps) {
  const isControlled = value !== undefined
  const [internal, setInternal] = useState(
    () => normalizeHex(value ?? defaultValue) ?? '#6366f1',
  )
  const current = isControlled ? (normalizeHex(value) ?? internal) : internal

  function commit(next: string) {
    const hex = normalizeHex(next)
    if (!hex) return
    if (!isControlled) setInternal(hex)
    onValueChange(hex)
  }

  // Local text state so a partially-typed hex isn't clobbered mid-edit.
  const [draft, setDraft] = useState(current.replace(/^#/, ''))
  useEffect(() => {
    setDraft(current.replace(/^#/, ''))
  }, [current])

  return (
    <Popover>
      <PopoverTrigger asChild disabled={disabled}>
        <button
          type="button"
          className={cn(
            'flex items-center gap-2.5 rounded-lg border border-input bg-surface px-3 py-2 text-sm shadow-sm shadow-black/[0.02] transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50',
            className,
          )}
        >
          <span
            className="size-5 shrink-0 rounded-md border border-border"
            style={{ backgroundColor: current }}
          />
          {triggerShowValue && (
            <span className="font-data uppercase tracking-wide text-muted-foreground">
              {current}
            </span>
          )}
          {triggerLabel && !triggerShowValue && <span>{triggerLabel}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="tn-color-picker w-60 space-y-3 p-3">
        <HexColorPicker color={current} onChange={commit} />

        {swatches && swatches.length > 0 && (
          <div className="grid grid-cols-8 gap-1.5">
            {swatches.map((sw) => {
              const active = normalizeHex(sw) === current
              return (
                <button
                  key={sw}
                  type="button"
                  aria-label={sw}
                  onClick={() => commit(sw)}
                  className={cn(
                    'grid size-6 place-items-center rounded-md border border-border transition-transform hover:scale-110',
                    active && 'ring-2 ring-primary ring-offset-1 ring-offset-popover',
                  )}
                  style={{ backgroundColor: sw }}
                >
                  {active && <Check className="size-3.5 text-white drop-shadow" />}
                </button>
              )
            })}
          </div>
        )}

        <div className="flex items-center gap-2 rounded-lg border border-input bg-surface px-2.5 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/20">
          <span className="text-sm text-muted-foreground">#</span>
          <Input
            value={draft}
            onChange={(e) => {
              const raw = e.target.value.replace(/[^0-9a-fA-F]/g, '').slice(0, 6)
              setDraft(raw)
              if (raw.length === 6) commit(raw)
            }}
            onBlur={() => setDraft(current.replace(/^#/, ''))}
            aria-label="Hex color"
            maxLength={6}
            className="h-9 border-0 bg-transparent px-0 font-data uppercase tracking-wide shadow-none focus-visible:ring-0"
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}
