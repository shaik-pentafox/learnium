import { render, screen } from '@testing-library/react'
import { describe, it, expect, beforeAll } from 'vitest'
import { ProviderDonut } from '@/components/dashboard/usage-breakdowns'
import type { UsageBucket } from '@/services/llm'

const EMPTY_TEXT = 'No activity in this range.'

// @visx ParentSize needs ResizeObserver, absent in jsdom.
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})

function bucket(label: string, costUsd: number | null): UsageBucket {
  return {
    label,
    calls: 10,
    totalTokens: 1000,
    costUsd: costUsd as unknown as number,
  }
}

describe('ProviderDonut cost metric', () => {
  it('shows empty when every cost is 0', () => {
    render(
      <ProviderDonut
        data={[bucket('openai', 0), bucket('gemini', 0)]}
        metric="costUsd"
      />,
    )
    expect(screen.getByText(EMPTY_TEXT)).toBeInTheDocument()
  })

  it('shows empty when cost is null/undefined (no pricing → NaN total)', () => {
    render(
      <ProviderDonut
        data={[bucket('openai', null), bucket('gemini', null)]}
        metric="costUsd"
      />,
    )
    // NaN total must still trigger the empty guard, not render garbage arcs.
    expect(screen.getByText(EMPTY_TEXT)).toBeInTheDocument()
  })

  it('renders the ring (not empty) when costs are present', () => {
    render(
      <ProviderDonut
        data={[bucket('openai', 3.2), bucket('gemini', 0.67)]}
        metric="costUsd"
      />,
    )
    expect(screen.queryByText(EMPTY_TEXT)).not.toBeInTheDocument()
  })
})
