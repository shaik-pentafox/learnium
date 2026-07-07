import { AlertTriangle, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface ErrorStateProps {
  /** Short headline, e.g. "Couldn't load personas". */
  title?: string
  /** Optional supporting line under the title. */
  message?: string
  /** Retry handler. Omit to hide the button (e.g. a fatal state). */
  onRetry?: () => void
  /** Retry button label. */
  retryLabel?: string
  /**
   * `inline` — bordered card that sits in the content flow (list/panel load
   * failures). `page` — centered, full-height, borderless (route-level fatal).
   */
  variant?: 'inline' | 'page'
  className?: string
}

/**
 * The single "something failed, try again" surface for the app. Every
 * query-load-failure and the router's error boundary render this, so the retry
 * affordance looks and reads the same everywhere.
 */
export function ErrorState({
  title = 'Something went wrong',
  message = "We couldn't load this. Please try again.",
  onRetry,
  retryLabel = 'Try again',
  variant = 'inline',
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg border border-border bg-surface p-6 text-center',
        variant === 'page' && 'min-h-[60vh] border-0 bg-transparent',
        className,
      )}
    >
      <div className="grid size-11 place-items-center rounded-full bg-destructive-soft text-destructive">
        <AlertTriangle className="size-5" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {message && <p className="max-w-sm text-sm text-muted-foreground">{message}</p>}
      </div>
      {onRetry && (
        <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
          <RotateCcw className="size-4" />
          {retryLabel}
        </Button>
      )}
    </div>
  )
}
