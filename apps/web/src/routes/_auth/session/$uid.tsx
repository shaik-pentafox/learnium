import { useEffect, useRef, useState } from 'react'
import {
  createFileRoute,
  Link,
  useBlocker,
  useNavigate,
} from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { SendHorizonal, FlaskConical } from 'lucide-react'
import { z } from 'zod'
import { getSession, sessionKeys } from '@/services/sessions'
import type { SessionTiming } from '@/services/sessions'
import { fmtMs } from '@/components/dashboard/primitives'
import { abandonSession } from '@/services/roleplay'
import { useRoleplaySession } from '@/features/roleplay/use-roleplay-session'
import type { ChannelStatus } from '@/lib/ws-client'
import type { ChatMessage } from '@/features/roleplay/use-roleplay-session'
import { personaOrbColors } from '@/lib/persona-color'
import { notify } from '@/lib/toast'
import { useAuthStore } from '@/stores/auth'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Orb, type AgentState } from '@/components/chat/orb'
import { VoiceBar } from '@/components/chat/voice-bar'
import { MarkdownText } from '@/components/chat/markdown'
import { ShimmeringText } from '@/components/shimmering-text'
import { useSidebar } from '@/components/ui/sidebar'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/chat/conversation'

export const Route = createFileRoute('/_auth/session/$uid')({
  validateSearch: z.object({ voice: z.string().optional() }).parse,
  component: ChatSession,
})

interface ScoreRow {
  criterionId: number
  name?: string
  score: number | null
  maxScore: number
  feedback: string | null
}

function ChatSession() {
  const { uid } = Route.useParams()
  const { voice: voiceLang } = Route.useSearch()
  const voiceMode = !!voiceLang

  const role = useAuthStore((s) => s.user?.role ?? 'USER')
  const backTo = role === 'USER' ? '/arena' : '/personas'
  const detail = useQuery({
    queryKey: sessionKeys.detail(uid),
    queryFn: () => getSession(uid),
  })
  const isSimulation = detail.data?.isSimulation === true
  const session = useRoleplaySession(uid)
  const navigate = useNavigate()
  const [draft, setDraft] = useState('')
  const [startConfirmed, setStartConfirmed] = useState(false)
  const lastError = useRef<string | null>(null)
  const leavingRef = useRef(false)

  const { open: sidebarOpen, setOpen: setSidebarOpen, isMobile } = useSidebar()
  const sidebarWasOpen = useRef(sidebarOpen)
  useEffect(() => {
    if (isMobile) return
    setSidebarOpen(false)
    return () => {
      if (sidebarWasOpen.current) setSidebarOpen(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (session.error && session.error !== lastError.current) {
      lastError.current = session.error
      notify.error(session.error)
    }
  }, [session.error])

  useEffect(() => {
    if (session.ended) void detail.refetch()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.ended])

  // Auto-start voice when the session is ready (voice mode only). One attempt
  // per mount — an upstream failure sends voice_stopped, and retrying in a loop
  // would hammer the provider; the user can retry by reloading.
  const voiceAutoStarted = useRef(false)
  useEffect(() => {
    if (!voiceLang || session.voiceActive || session.ended) return
    if (voiceAutoStarted.current) return
    const ready = session.status === 'open' && (session.hasStarted || startConfirmed)
    if (ready) {
      voiceAutoStarted.current = true
      session.startVoice(voiceLang)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceLang, session.status, session.hasStarted, startConfirmed, session.voiceActive, session.ended])

  const blocker = useBlocker({
    shouldBlockFn: () =>
      !session.ended && !session.ending && !leavingRef.current,
    enableBeforeUnload: () => !session.ended && !session.ending,
    withResolver: true,
  })

  const showStartDialog =
    session.hasStarted === false && !startConfirmed && !session.ended

  function confirmStart() {
    setStartConfirmed(true)
    session.begin()
  }

  async function cancelStart() {
    leavingRef.current = true
    try { await abandonSession(uid) } catch { /* best-effort */ }
    void navigate({ to: backTo })
  }

  async function confirmLeave() {
    leavingRef.current = true
    try { await abandonSession(uid) } catch { /* best-effort */ }
    blocker.proceed?.()
  }

  function submit() {
    if (!draft.trim() || session.ended) return
    session.sendMessage(draft)
    setDraft('')
  }

  const canChat = session.status === 'open' && !session.ended && !session.ending
  const orbColors = personaOrbColors(session.personaColor)

  // Orb state for header / voice overlay
  const orbState: AgentState =
    session.status !== 'open' || session.ended
      ? null
      : session.thinking
        ? 'talking'
        : 'listening'

  return (
    <div className="relative mx-auto flex h-[calc(100svh-3.5rem-3rem)] max-w-3xl flex-col">
      {/* Start-confirm dialog */}
      <Dialog open={showStartDialog}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>
              {voiceMode ? 'Start voice roleplay' : 'Start roleplay'}
            </DialogTitle>
            <DialogDescription>
              {voiceMode
                ? `You are the support agent. ${session.personaName ?? 'The customer'} will open the conversation. Speak naturally — the AI will respond in your chosen language.`
                : `You are the support agent. ${session.personaName ?? 'The customer'} will open the conversation — read their first message, then reply in character. Ready to begin?`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={cancelStart}>
              Cancel
            </Button>
            <Button onClick={confirmStart} disabled={session.status !== 'open'}>
              {voiceMode ? 'Start voice session' : 'Start conversation'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Leave-confirm dialog */}
      <Dialog
        open={blocker.status === 'blocked'}
        onOpenChange={(open) => { if (!open) blocker.reset?.() }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Leave this session?</DialogTitle>
            <DialogDescription>
              Leaving now ends the roleplay without scoring — it won't count as a
              completed attempt. To get feedback, finish and use "End &amp; score"
              instead.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => blocker.reset?.()}>
              Keep practicing
            </Button>
            <Button variant="destructive" onClick={confirmLeave}>
              Leave &amp; abandon
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Persona header */}
      <header className="relative z-10 flex items-center justify-between gap-3 pb-3">
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
            disabled={session.status !== 'open' || session.ending}
          >
            {session.ending ? 'Scoring…' : 'End & score'}
          </Button>
        )}
      </header>

      {isSimulation && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm font-medium text-amber-700 dark:text-amber-400">
          <FlaskConical className="size-4 shrink-0" />
          Simulation — persona test session, not a graded trainee session.
        </div>
      )}

      {!session.ended &&
        !session.ending &&
        (session.status === 'reconnecting' || session.status === 'closed') && (
          <ReconnectBanner status={session.status} />
        )}

      {/* Transcript */}
      <div className="relative flex-1 overflow-hidden">
        <Conversation className="h-full rounded-xl border border-border bg-surface">
          <ConversationContent className="space-y-1">
            {session.messages.length === 0 && !session.thinking && (
              <EmptyState colors={orbColors} />
            )}
            {session.messages.map((m) => (
              <Bubble key={m.localId} message={m} />
            ))}
            {/* Live utterance: STT partial rendered as an in-progress user
                bubble; replaced by the real message on stt_final. */}
            {voiceMode && session.sttCaption && (
              <Bubble
                message={{
                  localId: 'stt-partial',
                  role: 'user',
                  content: session.sttCaption,
                  pending: true,
                }}
              />
            )}
            {session.thinking &&
              !session.ending &&
              session.messages.at(-1)?.role !== 'assistant' && <TypingBubble />}
            {session.ending && !session.ended && (
              <ScoringIndicator
                colors={orbColors}
                connected={session.status === 'open'}
              />
            )}
            {session.ended && (
              <ScoreReveal
                scores={(session.scores ?? []) as ScoreRow[]}
                feedback={session.feedback}
                timing={detail.data?.timing}
              />
            )}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
      </div>

      {/* Composer — text mode only */}
      {!voiceMode && (
        session.ended ? (
          <div className="pt-3">
            <Link to={backTo} className="text-sm text-primary hover:underline">
              ← Back
            </Link>
          </div>
        ) : session.ending ? (
          <div className="mt-3 flex items-center justify-center gap-2 rounded-xl border border-border bg-background p-3 shadow-sm shadow-black/5">
            <Dot /> <Dot /> <Dot />
            <ShimmeringText
              text={
                session.status === 'open'
                  ? 'Scoring your conversation…'
                  : 'Reconnecting…'
              }
              className="text-sm"
            />
          </div>
        ) : (
          <div className="mt-3 flex items-end gap-2 rounded-xl border border-border bg-background p-2 shadow-sm shadow-black/5">
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
        )
      )}

      {/* Voice bar — replaces the composer while the voice loop runs */}
      {voiceMode && session.voiceActive && !session.ending && !session.ended && (
        <VoiceBar session={session} />
      )}

      {/* Voice mode: scoring in progress */}
      {voiceMode && session.ending && !session.ended && (
        <div className="mt-3 flex items-center justify-center gap-2 rounded-xl border border-border bg-background p-3 shadow-sm shadow-black/5">
          <Dot /> <Dot /> <Dot />
          <ShimmeringText
            text={
              session.status === 'open'
                ? 'Scoring your conversation…'
                : 'Reconnecting…'
            }
            className="text-sm"
          />
        </div>
      )}

      {/* Voice mode: upstream dropped (voice_stopped) — offer a manual restart */}
      {voiceMode &&
        !session.ended &&
        !session.ending &&
        !session.voiceActive &&
        voiceAutoStarted.current && (
          <div className="mt-3 flex items-center justify-center gap-3 rounded-xl border border-border bg-background p-3 text-sm shadow-sm shadow-black/5">
            <span className="text-muted-foreground">Voice stopped.</span>
            <Button
              size="sm"
              variant="secondary"
              disabled={session.status !== 'open'}
              onClick={() => voiceLang && session.startVoice(voiceLang)}
            >
              Restart voice
            </Button>
          </div>
        )}

      {/* Voice mode ended — back link */}
      {voiceMode && session.ended && (
        <div className="pt-3">
          <Link to={backTo} className="text-sm text-primary hover:underline">
            ← Back
          </Link>
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
        Waiting for the customer to start the conversation…
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
          'max-w-[80%] rounded-2xl px-4 py-2.5 text-sm',
          isUser
            ? 'whitespace-pre-wrap rounded-br-md bg-primary text-primary-foreground'
            : 'rounded-bl-md bg-muted text-foreground',
        )}
      >
        {isUser ? (
          message.content
        ) : (
          <MarkdownText>{message.content}</MarkdownText>
        )}
        {message.pending && <Caret />}
      </div>
    </div>
  )
}

function ScoringIndicator({
  colors,
  connected,
}: {
  colors: [string, string]
  connected: boolean
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-10 text-center">
      <Orb
        colors={colors}
        agentState={connected ? 'thinking' : null}
        className="size-20"
      />
      <ShimmeringText
        text={
          connected
            ? 'Scoring your conversation…'
            : 'Connection lost — reconnecting to fetch your score…'
        }
        className="text-sm font-medium"
      />
    </div>
  )
}

function ReconnectBanner({ status }: { status: ChannelStatus }) {
  const closed = status === 'closed'
  return (
    <div
      className={cn(
        'mb-3 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium',
        closed
          ? 'border-destructive/40 bg-destructive/10 text-destructive'
          : 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400',
      )}
    >
      <span className="inline-flex gap-1">
        <Dot /> <Dot /> <Dot />
      </span>
      {closed
        ? 'Disconnected. Trying to restore the session…'
        : 'Reconnecting… messages will resume automatically.'}
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

function overallPct(scores: ScoreRow[]): number | null {
  const scored = scores.filter((s) => s.score !== null)
  if (scored.length === 0) return null
  const earned = scored.reduce((sum, s) => sum + (s.score ?? 0), 0)
  const max = scored.reduce((sum, s) => sum + s.maxScore, 0)
  return max > 0 ? Math.round((earned / max) * 100) : null
}

function scoreTone(pct: number): string {
  if (pct >= 80) return 'text-success'
  if (pct >= 60) return 'text-warning'
  return 'text-destructive'
}

function fmtDuration(ms: number | null): string {
  if (ms === null) return '—'
  const totalSec = Math.round(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

function TimingStrip({ timing }: { timing: SessionTiming }) {
  const cells: { label: string; value: string }[] = [
    { label: 'Duration', value: fmtDuration(timing.durationMs) },
    { label: 'Turns', value: String(timing.turns) },
    { label: 'Your avg reply', value: fmtMs(timing.avgUserResponseMs) },
    { label: 'AI avg reply', value: fmtMs(timing.avgLlmLatencyMs) },
  ]
  return (
    <div className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-background p-3 sm:grid-cols-4">
      {cells.map((c) => (
        <div key={c.label} className="text-center">
          <div className="font-data text-lg font-semibold tabular-nums text-primary">
            {c.value}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">{c.label}</div>
        </div>
      ))}
    </div>
  )
}

function ScoreReveal({
  scores,
  feedback,
  timing,
}: {
  scores: ScoreRow[]
  feedback: string | null
  timing?: SessionTiming
}) {
  const pct = overallPct(scores)
  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">Session feedback</h2>
        {pct !== null && (
          <span
            className={cn(
              'font-data text-lg font-semibold tabular-nums',
              scoreTone(pct),
            )}
          >
            {pct}%
          </span>
        )}
      </div>

      <div className="space-y-4 p-4">
        {timing && <TimingStrip timing={timing} />}
        {feedback && (
          <MarkdownText className="text-sm text-muted-foreground">
            {feedback}
          </MarkdownText>
        )}

        {scores.length > 0 ? (
          <ul className="space-y-3">
            {scores.map((s) => (
              <CriterionRow key={s.criterionId} row={s} />
            ))}
          </ul>
        ) : (
          !feedback && (
            <p className="text-sm text-muted-foreground">
              No scores recorded. This persona has no scoring rubric, or no
              scoring model is configured.
            </p>
          )
        )}
      </div>
    </div>
  )
}

function CriterionRow({ row }: { row: ScoreRow }) {
  const pct =
    row.score !== null && row.maxScore > 0
      ? Math.round((row.score / row.maxScore) * 100)
      : null
  return (
    <li className="space-y-1.5">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="min-w-0 truncate font-medium">
          {row.name ?? `Criterion #${row.criterionId}`}
        </span>
        <span className="shrink-0 font-data tabular-nums text-muted-foreground">
          {row.score ?? '—'} / {row.maxScore}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            'h-full rounded-full transition-all',
            pct === null
              ? 'bg-muted'
              : pct >= 80
                ? 'bg-success'
                : pct >= 60
                  ? 'bg-warning'
                  : 'bg-destructive',
          )}
          style={{ width: `${pct ?? 0}%` }}
        />
      </div>
      {row.feedback && (
        <p className="text-xs text-muted-foreground">{row.feedback}</p>
      )}
    </li>
  )
}
