import { ErrorState } from '@/components/ui/error-state'

/** A failed dynamic import (stale Vite optimize dep in dev, or a stale chunk
 *  hash after a deploy in prod). `reset()` re-renders into the same broken
 *  chunk, so the only real recovery is a full reload. */
function isChunkLoadError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error)
  return /dynamically imported module|Failed to fetch dynamically imported|Importing a module script failed|Outdated Optimize Dep/i.test(
    msg,
  )
}

/**
 * Router-level error boundary (wired as `defaultErrorComponent`). Renders the
 * shared {@link ErrorState} full-page. Chunk-load failures reload; everything
 * else retries the route via `reset`.
 */
export function RouteError({ error, reset }: { error: unknown; reset: () => void }) {
  const chunk = isChunkLoadError(error)
  return (
    <ErrorState
      variant="page"
      title="This page failed to load"
      message={
        chunk
          ? 'A newer version may be available. Reload to get the latest.'
          : "Something went wrong while loading this page."
      }
      retryLabel={chunk ? 'Reload' : 'Try again'}
      onRetry={chunk ? () => window.location.reload() : reset}
    />
  )
}
