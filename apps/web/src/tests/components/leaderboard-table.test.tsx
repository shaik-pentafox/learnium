import { render, screen, within } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { LeaderboardTable } from '@/components/leaderboard/leaderboard-table'
import type { Leaderboard, LeaderboardRow } from '@/services/leaderboard'

function row(overrides: Partial<LeaderboardRow> & Pick<LeaderboardRow, 'rank' | 'userId' | 'name'>): LeaderboardRow {
  return {
    avatarUrl: null,
    sessions: 5,
    scoredSessions: 5,
    avgScorePct: 80,
    points: 400,
    ...overrides,
  }
}

function board(overrides: Partial<Leaderboard> = {}): Leaderboard {
  const rows = overrides.rows ?? [
    row({ rank: 1, userId: 1, name: 'Ana Alpha', points: 500 }),
    row({ rank: 2, userId: 2, name: 'Bo Beta', points: 400 }),
    row({ rank: 3, userId: 3, name: 'Cy Gamma', points: 300 }),
  ]
  return {
    days: 30,
    since: '2026-06-21T00:00:00.000Z',
    rows,
    me: null,
    totalRanked: rows.length,
    ...overrides,
  }
}

describe('LeaderboardTable', () => {
  it('renders every trainee by name in rank order', () => {
    render(<LeaderboardTable data={board()} />)

    const table = screen.getByRole('table')
    const names = within(table)
      .getAllByRole('row')
      .slice(1) // drop the header row
      .map((r) => within(r).getAllByRole('cell')[1]?.textContent ?? '')

    expect(names[0]).toContain('Ana Alpha')
    expect(names[1]).toContain('Bo Beta')
    expect(names[2]).toContain('Cy Gamma')
  })

  it('marks the current user so they can find themselves', () => {
    render(<LeaderboardTable data={board()} currentUserId={2} />)

    expect(screen.getAllByText('You').length).toBeGreaterThan(0)
  })

  it('shows the empty state when nobody has scored', () => {
    render(<LeaderboardTable data={board({ rows: [], totalRanked: 0 })} />)

    expect(screen.getByText('No one has scored yet')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('appends the user\'s own row when they rank below the visible cut', () => {
    const me = row({ rank: 47, userId: 99, name: 'Zed Omega', points: 12 })
    render(<LeaderboardTable data={board({ me })} currentUserId={99} />)

    expect(screen.getByText(/Zed Omega/)).toBeInTheDocument()
    expect(screen.getByText(/You rank/)).toHaveTextContent('#47')
  })

  it('renders a dash when a trainee has no average score', () => {
    render(
      <LeaderboardTable
        data={board({
          rows: [row({ rank: 1, userId: 1, name: 'Ana Alpha', avgScorePct: null, points: 0 })],
        })}
      />,
    )

    expect(screen.getByText('—')).toBeInTheDocument()
  })
})
