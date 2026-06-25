import { Check, PlusCircle, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

export interface FacetOption {
  label: string
  value: string
}

interface FacetFilterProps {
  title: string
  /** Options as `{label, value}`, or plain strings (label === value). */
  options: (FacetOption | string)[]
  selected: string[]
  onChange: (next: string[]) => void
  /** Single-select (radio-like): picking one replaces the selection. */
  single?: boolean
}

/** tablecn-style faceted filter: a dashed trigger with a count badge and a
 *  popover of toggleable options. Multi-select by default; `single` swaps to
 *  radio behaviour. Emits the full selection of values. */
export function FacetFilter({
  title,
  options,
  selected,
  onChange,
  single = false,
}: FacetFilterProps) {
  const opts: FacetOption[] = options.map((o) =>
    typeof o === 'string' ? { label: o, value: o } : o,
  )
  const set = new Set(selected)
  const toggle = (value: string) => {
    if (single) {
      onChange(set.has(value) ? [] : [value])
      return
    }
    const next = new Set(set)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    onChange([...next])
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="secondary"
          size="sm"
          className="h-8 gap-1.5 border border-dashed text-xs font-normal"
        >
          <PlusCircle className="size-3.5" />
          {title}
          {selected.length > 0 && (
            <span className="ml-1 rounded bg-primary/10 px-1.5 text-xs font-medium tabular-nums text-primary">
              {selected.length}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-52 p-1">
        {opts.length === 0 ? (
          <p className="px-2 py-3 text-center text-xs text-muted-foreground">
            No options.
          </p>
        ) : (
          <ul className="max-h-64 overflow-auto">
            {opts.map((opt) => {
              const active = set.has(opt.value)
              return (
                <li key={opt.value}>
                  <button
                    type="button"
                    onClick={() => toggle(opt.value)}
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground"
                  >
                    <span
                      className={cn(
                        'flex size-4 items-center justify-center rounded-sm border border-primary [&_svg]:size-3',
                        active
                          ? 'bg-primary text-primary-foreground'
                          : 'opacity-50 [&_svg]:invisible',
                      )}
                    >
                      <Check />
                    </span>
                    <span className="truncate">{opt.label}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        {selected.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            className="mt-1 flex w-full items-center justify-center gap-1 border-t border-border px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <X className="size-3" />
            Clear
          </button>
        )}
      </PopoverContent>
    </Popover>
  )
}
