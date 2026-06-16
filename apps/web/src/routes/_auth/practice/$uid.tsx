import { useEffect, useRef, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { SendHorizonal } from 'lucide-react'
import { useRoleplaySession } from '@/features/roleplay/use-roleplay-session'
import type { ChannelStatus } from '@/lib/ws-client'
import type { ChatMessage } from '@/features/roleplay/use-roleplay-session'
import { notify } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/_auth/practice/$uid')({
  component: ChatSession,
})

interface ScoreRow {
  criterionId: number
  score: number | null
  maxScore: number
  feedback: string | null
}

function ChatSession() {
  const { uid } = Route.useParams()
  const session = useRoleplaySession(uid)
  const [draft, setDraft] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const lastError = useRef<string | null>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [session.messages, session.thinking])

  useEffect(() => {
    if (session.error && session.error !== lastError.current) {
      lastError.current = session.error
      notify.error(session.error)
    }
  }, [session.error])

  function submit() {
    if (!draft.trim() || session.ended) return
    session.sendMessage(draft)
    setDraft('')
  }

  const canChat = session.status === 'open' && !session.ended

  return (
    <div className="mx-auto flex h-[calc(100svh-3.5rem-3rem)] max-w-3xl flex-col">
      <header className="flex items-center justify-between pb-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">
            {session.personaName ?? 'Roleplay session'}
          </h1>
          <ConnectionLabel status={session.status} ended={session.ended} />
        </div>
        {!session.ended && (
          <Button
            variant="secondary"
            size="sm"
            onClick={session.endSession}
            disabled={session.status !== 'open'}
          >
            End & score
          </Button>
        )}
      </header>

      <div
        ref={scrollRef}
        className="flex-1 space-y-3 overflow-y-auto rounded-lg border border-border bg-surface p-4"
      >
        {session.messages.length === 0 && !session.thinking && (
          <p className="grid h-full place-items-center text-sm text-muted-foreground">
            Say something to begin the roleplay.
          </p>
        )}
        {session.messages.map((m) => (
          <Bubble key={m.localId} message={m} />
        ))}
        {session.thinking && session.messages.at(-1)?.role !== 'assistant' && (
          <TypingBubble />
        )}

        {session.ended && (
          <ScoreReveal
            scores={(session.scores ?? []) as ScoreRow[]}
            feedback={session.feedback}
          />
        )}
      </div>

      {session.ended ? (
        <div className="pt-3">
          <Link to="/practice" className="text-sm text-primary hover:underline">
            ← Back to personas
          </Link>
        </div>
      ) : (
        <div className="flex items-end gap-2 pt-3">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                submit()
              }
            }}
            rows={1}
            placeholder={canChat ? 'Type a message…' : 'Connecting…'}
            disabled={!canChat}
            className="max-h-32 flex-1 resize-none rounded-md border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring disabled:opacity-60"
          />
          <Button
            size="icon"
            aria-label="Send"
            onClick={submit}
            disabled={!canChat || !draft.trim()}
          >
            <SendHorizonal />
          </Button>
        </div>
      )}
    </div>
  )
}

function Bubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user'
  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[80%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm',
          isUser
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted text-foreground',
        )}
      >
        {message.content}
        {message.pending && <Caret />}
      </div>
    </div>
  )
}

function TypingBubble() {
  return (
    <div className="flex justify-start">
      <div className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
        <span className="inline-flex gap-1">
          <Dot /> <Dot /> <Dot />
        </span>
      </div>
    </div>
  )
}

function Caret() {
  return <span className="ml-0.5 inline-block w-1.5 animate-pulse">▍</span>
}

function Dot() {
  return <span className="inline-block size-1.5 animate-pulse rounded-full bg-current" />
}

const STATUS_TEXT: Record<ChannelStatus, string> = {
  connecting: 'Connecting…',
  open: 'Connected',
  reconnecting: 'Reconnecting…',
  closed: 'Disconnected',
}

function ConnectionLabel({
  status,
  ended,
}: {
  status: ChannelStatus
  ended: boolean
}) {
  if (ended) return <span className="text-xs text-success">Session complete</span>
  const tone =
    status === 'open'
      ? 'text-success'
      : status === 'reconnecting'
        ? 'text-warning'
        : 'text-muted-foreground'
  return <span className={cn('text-xs', tone)}>{STATUS_TEXT[status]}</span>
}

function ScoreReveal({
  scores,
  feedback,
}: {
  scores: ScoreRow[]
  feedback: string | null
}) {
  return (
    <div className="mt-2 rounded-lg border border-border bg-background p-4">
      <h2 className="text-sm font-semibold">Session feedback</h2>
      {feedback && (
        <p className="mt-1 text-sm text-muted-foreground">{feedback}</p>
      )}
      {scores.length > 0 && (
        <ul className="mt-3 space-y-2">
          {scores.map((s) => (
            <li
              key={s.criterionId}
              className="flex items-center justify-between gap-3 text-sm"
            >
              <span className="text-muted-foreground">
                Criterion #{s.criterionId}
              </span>
              <span className="font-data tabular-nums">
                {s.score ?? '—'} / {s.maxScore}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
