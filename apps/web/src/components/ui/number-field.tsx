import { ChevronUp, ChevronDown } from "lucide-react"

import { cn } from "@/lib/utils"

interface NumberFieldProps {
  value: string
  onChange: (value: string) => void
  min?: number
  max?: number
  step?: number
  placeholder?: string
  disabled?: boolean
  className?: string
  "aria-label"?: string
}

/**
 * Themed number input with stacked chevron steppers (right side). Native spinner
 * is hidden; the input accepts any decimal (step="any") while the chevrons jump
 * by `step`. Value stays a string so the field can be empty (e.g. unset price).
 */
function NumberField({
  value,
  onChange,
  min,
  max,
  step = 1,
  placeholder,
  disabled,
  className,
  "aria-label": ariaLabel,
}: NumberFieldProps) {
  function clamp(n: number): number {
    if (min != null && n < min) return min
    if (max != null && n > max) return max
    return n
  }

  function step_(direction: 1 | -1) {
    const current = value === "" ? (min ?? 0) : Number(value)
    if (Number.isNaN(current)) return
    // toFixed(10) strips float drift (0.1 + 0.2), Number() trims trailing zeros.
    const next = Number(clamp(current + direction * step).toFixed(10))
    onChange(String(next))
  }

  const atMin = min != null && value !== "" && Number(value) <= min
  const atMax = max != null && value !== "" && Number(value) >= max

  return (
    <div
      className={cn(
        "relative inline-flex h-9 w-full items-center overflow-hidden whitespace-nowrap rounded-lg border border-input text-sm shadow-sm shadow-black/5 transition-shadow focus-within:border-ring focus-within:outline-none focus-within:ring-[3px] focus-within:ring-ring/20",
        disabled && "pointer-events-none opacity-50",
        className
      )}
    >
      <input
        type="number"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        min={min}
        max={max}
        step="any"
        placeholder={placeholder}
        disabled={disabled}
        aria-label={ariaLabel}
        className="min-w-0 flex-1 [appearance:textfield] bg-background px-3 py-2 tabular-nums text-foreground outline-none placeholder:text-muted-foreground/70 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <div className="flex h-[calc(100%+2px)] flex-col">
        <button
          type="button"
          tabIndex={-1}
          aria-label="Increase"
          onClick={() => step_(1)}
          disabled={disabled || atMax}
          className="-me-px flex h-1/2 w-6 flex-1 items-center justify-center border border-input bg-background text-muted-foreground/80 transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
        >
          <ChevronUp size={12} strokeWidth={2} aria-hidden="true" />
        </button>
        <button
          type="button"
          tabIndex={-1}
          aria-label="Decrease"
          onClick={() => step_(-1)}
          disabled={disabled || atMin}
          className="-me-px -mt-px flex h-1/2 w-6 flex-1 items-center justify-center border border-input bg-background text-muted-foreground/80 transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
        >
          <ChevronDown size={12} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}

export { NumberField }
