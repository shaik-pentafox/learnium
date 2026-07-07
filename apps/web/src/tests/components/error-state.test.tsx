import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { ErrorState } from '@/components/ui/error-state'
import { RouteError } from '@/components/route-error'

describe('ErrorState', () => {
  it('renders the title and a working retry button', async () => {
    const onRetry = vi.fn()
    render(<ErrorState title="Couldn’t load personas" onRetry={onRetry} />)

    expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t load personas')
    await userEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('hides the retry button when no handler is given', () => {
    render(<ErrorState title="Fatal" />)
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('RouteError', () => {
  it('offers Try again (reset) for a generic error', async () => {
    const reset = vi.fn()
    render(<RouteError error={new Error('boom')} reset={reset} />)

    await userEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(reset).toHaveBeenCalledOnce()
  })

  it('offers Reload for a failed dynamic import (stale chunk)', () => {
    const reset = vi.fn()
    render(
      <RouteError
        error={new Error('Failed to fetch dynamically imported module: /x.js')}
        reset={reset}
      />,
    )

    // Chunk-load errors must NOT use reset (it re-renders the broken chunk).
    expect(screen.getByRole('button', { name: /reload/i })).toBeInTheDocument()
    expect(reset).not.toHaveBeenCalled()
  })
})
