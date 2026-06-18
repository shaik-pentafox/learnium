import { useEffect, useRef, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { SendHorizonal, Mic } from 'lucide-react'
import { useRoleplaySession } from '@/features/roleplay/use-roleplay-session'
import type { ChannelStatus } from '@/lib/ws-client'
import type { ChatMessage } from '@/features/roleplay/use-roleplay-session'
import { personaOrbColors } from '@/lib/persona-color'
import { notify } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Orb, type AgentState } from '@/components/chat/orb'
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/chat/conversation'

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
  const lastError = useRef<string | null>(null)

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
  const orbColors = personaOrbColors(session.personaColor)
  // No voice yet: idle persona "listens", streams as "talking".
  const orbState: AgentState =
    session.status !== 'open' || session.ended
      ? null
      : session.thinking
        ? 'talking'
        : 'listening'

  return (
    <div className="mx-auto flex h-[calc(100svh-3.5rem-3rem)] max-w-3xl flex-col">
      {/* Persona header */}
      <header className="flex items-center justify-between gap-3 pb-3">
        <div className="flex items-center gap-3">
          <div
            className="size-11 shrink-0 rounded-full"
            style={{ boxShadow: `0 0 0 1px ${orbColors[0]}33` }}
          >
            <Orb colors={orbColors} agentState={orbState} className="size-11" />
          </div>
          <div>
            <h1 className="text-lg font-semibold leading-tight tracking-tight">
              {session.personaName ?? 'Roleplay session'}
            </h1>
            <ConnectionLabel status={session.status} ended={session.ended} />
          </div>
        </div>
        {!session.ended && (
          <Button
            variant="secondary"
            size="sm"
            onClick={session.endSession}
            disabled={session.status !== 'open'}
          >
            End &amp; score
          </Button>
        )}
      </header>

      {/* Transcript */}
      <Conversation className="rounded-xl border border-border bg-surface">
        <ConversationContent className="space-y-1">
          {session.messages.length === 0 && !session.thinking && (
            <EmptyState colors={orbColors} />
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
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      {/* Composer (voice-ready shell — mic slot reserved) */}
      {session.ended ? (
        <div className="pt-3">
          <Link to="/practice" className="text-sm text-primary hover:underline">
            ← Back to personas
          </Link>
        </div>
      ) : (
        <div className="mt-3 flex items-end gap-2 rounded-xl border border-border bg-background p-2 shadow-sm shadow-black/5">
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0"
            disabled
            aria-label="Voice (coming soon)"
            title="Voice mode — coming soon"
          >
            <Mic className="text-muted-foreground/60" />
          </Button>
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
            className="max-h-32 flex-1 resize-none bg-transparent px-1 py-2 text-sm outline-none placeholder:text-muted-foreground/70 disabled:opacity-60"
          />
          <Button
            size="icon"
            className="shrink-0"
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

function EmptyState({ colors }: { colors: [string, string] }) {
  return (
    <div className="flex h-[40vh] flex-col items-center justify-center gap-4 text-center">
      <Orb colors={colors} agentState="listening" className="size-28" />
      <p className="text-sm text-muted-foreground">
        Say something to begin the roleplay.
      </p>
    </div>
  )
}

function Bubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user'
  return (
    <div className={cn('flex py-1.5', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[80%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm',
          isUser
            ? 'rounded-br-md bg-primary text-primary-foreground'
            : 'rounded-bl-md bg-muted text-foreground',
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
    <div className="flex justify-start py-1.5">
      <div className="rounded-2xl rounded-bl-md bg-muted px-4 py-2.5 text-sm text-muted-foreground">
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
  return (
    <span className="inline-block size-1.5 animate-pulse rounded-full bg-current" />
  )
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
  if (ended)
    return <span className="text-xs text-success">Session complete</span>
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
    <div className="mt-3 rounded-xl border border-border bg-background p-4">
      <h2 className="text-sm font-semibold">Session feedback</h2>
      {feedback && (
        <p className="mt-1 text-sm text-muted-foreground">{feedback}</p>
      )}
      {scores.length > 0 ? (
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
      ) : (
        !feedback && (
          <p className="mt-1 text-sm text-muted-foreground">
            No scores recorded. This persona has no scoring rubric, or no scoring
            model is configured.
          </p>
        )
      )}
    </div>
  )
}
