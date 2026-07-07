import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PersonaBuilder } from '@/components/personas/persona-builder'

// Orb is a react-three-fiber canvas (WebGL) — jsdom can't render it. Stub it.
vi.mock('@/components/chat/orb', () => ({ Orb: () => null }))

// Builder navigates on save; router context isn't under test.
vi.mock('@tanstack/react-router', async (orig) => ({
  ...(await orig<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
}))

// Voice catalog queries fire on mount — stub them so no network is hit.
vi.mock('@/services/voice', async (orig) => ({
  ...(await orig<typeof import('@/services/voice')>()),
  listVoices: vi.fn(async () => []),
  listVoiceLanguages: vi.fn(async () => []),
  fetchVoicePreview: vi.fn(async () => ''),
}))

function renderBuilder() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <PersonaBuilder />
    </QueryClientProvider>,
  )
}

describe('PersonaBuilder input limits', () => {
  it('hard-caps the persona name and shows a live counter', async () => {
    renderBuilder()

    const name = screen.getByPlaceholderText('e.g., Double-charged Dana')
    // Native cap = the backend max (persona.dto.ts name.max(200)).
    expect(name).toHaveAttribute('maxlength', '200')
    expect(screen.getByText('0/200')).toBeInTheDocument()

    await userEvent.type(name, 'Dana')
    expect(screen.getByText('4/200')).toBeInTheDocument()
  })

  it('caps the short description at its backend max (300)', () => {
    renderBuilder()

    const desc = screen.getByPlaceholderText(
      'Billing dispute, frustrated premium customer…',
    )
    expect(desc).toHaveAttribute('maxlength', '300')
    expect(screen.getByText('0/300')).toBeInTheDocument()
  })
})
