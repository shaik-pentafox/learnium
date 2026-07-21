import { Medal, Trophy, Flame } from 'lucide-react'
import type { Leaderboard, LeaderboardRow } from '@/services/leaderboard'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'

/** Medal tint for the top three; everyone else renders a plain number. */
const PODIUM: Record<number, string> = {
  1: 'text-amber-500',
  2: 'text-slate-400',
  3: 'text-amber-700',
}

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
}

function RankBadge({ rank }: { rank: number }) {
  const tint = PODIUM[rank]
  if (!tint) {
    return <span className="text-sm text-muted-foreground tabular-nums">{rank}</span>
  }
  return <Medal className={cn('size-5', tint)} aria-label={`Rank ${rank}`} />
}

function TraineeCell({ row, isMe }: { row: LeaderboardRow; isMe: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <Avatar className="size-8">
        {row.avatarUrl && <AvatarImage src={row.avatarUrl} alt="" />}
        <AvatarFallback className="text-xs">{initials(row.name)}</AvatarFallback>
      </Avatar>
      <span className="font-medium">
        {row.name}
        {isMe && <span className="ml-2 text-xs text-primary">You</span>}
      </span>
    </div>
  )
}

interface PodiumCardProps {
  row: LeaderboardRow
  isMe: boolean
}

function PodiumCard({ row, isMe }: PodiumCardProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-2 rounded-xl border bg-card p-4 text-center',
        isMe && 'border-primary ring-1 ring-primary/30',
      )}
    >
      <Medal className={cn('size-6', PODIUM[row.rank])} />
      <Avatar className="size-12">
        {row.avatarUrl && <AvatarImage src={row.avatarUrl} alt="" />}
        <AvatarFallback>{initials(row.name)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">
          {row.name}
          {isMe && <span className="ml-1 text-xs text-primary">You</span>}
        </p>
        <p className="text-xs text-muted-foreground">
          {row.sessions} session{row.sessions === 1 ? '' : 's'}
          {row.avgScorePct !== null && ` · ${row.avgScorePct}% avg`}
        </p>
      </div>
      <p className="text-lg font-semibold tabular-nums">{row.points}</p>
    </div>
  )
}

interface LeaderboardTableProps {
  data: Leaderboard
  currentUserId?: number
}

export function LeaderboardTable({ data, currentUserId }: LeaderboardTableProps) {
  if (data.rows.length === 0) {
    return (
      <div className="rounded-xl border bg-card p-10 text-center">
        <Trophy className="mx-auto size-8 text-muted-foreground" />
        <p className="mt-3 font-medium">No one has scored yet</p>
        <p className="text-sm text-muted-foreground">
          Complete a practice session in the last {data.days} days to open the board.
        </p>
      </div>
    )
  }

  const isMe = (row: LeaderboardRow) => row.userId === currentUserId
  const podium = data.rows.slice(0, 3)
  // Own row is always worth showing, even when the trainee ranks below the cut.
  const meOffBoard =
    data.me && !data.rows.some((r) => r.userId === data.me?.userId) ? data.me : null

  return (
    <div className="space-y-6">
      {podium.length === 3 && (
        <div className="grid gap-3 sm:grid-cols-3">
          {podium.map((row) => (
            <PodiumCard key={row.userId} row={row} isMe={isMe(row)} />
          ))}
        </div>
      )}

      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-14">#</TableHead>
              <TableHead>Trainee</TableHead>
              <TableHead className="text-right">Sessions</TableHead>
              <TableHead className="text-right">Avg score</TableHead>
              <TableHead className="text-right">Points</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.rows.map((row) => (
              <TableRow key={row.userId} className={cn(isMe(row) && 'bg-primary/5')}>
                <TableCell>
                  <RankBadge rank={row.rank} />
                </TableCell>
                <TableCell>
                  <TraineeCell row={row} isMe={isMe(row)} />
                </TableCell>
                <TableCell className="text-right tabular-nums">{row.sessions}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.avgScorePct === null ? '—' : `${row.avgScorePct}%`}
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {row.points}
                </TableCell>
              </TableRow>
            ))}

            {meOffBoard && (
              <TableRow className="bg-primary/5">
                <TableCell>
                  <RankBadge rank={meOffBoard.rank} />
                </TableCell>
                <TableCell>
                  <TraineeCell row={meOffBoard} isMe />
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {meOffBoard.sessions}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {meOffBoard.avgScorePct === null ? '—' : `${meOffBoard.avgScorePct}%`}
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {meOffBoard.points}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {data.me && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Flame className="size-4 text-primary" />
          You rank <span className="font-medium text-foreground">#{data.me.rank}</span> of{' '}
          {data.totalRanked} with {data.me.points} points.
        </p>
      )}
    </div>
  )
}
