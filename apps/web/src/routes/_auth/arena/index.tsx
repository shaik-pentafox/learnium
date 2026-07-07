import { useState } from 'react'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useQuery, useMutation } from '@tanstack/react-query'
import {
  listMyPersonas,
  personaKeys,
  type PersonaSummary,
} from '@/services/personas'
import { startSession } from '@/services/roleplay'
import { personaOrbColors } from '@/lib/persona-color'
import { notify } from '@/lib/toast'
import { useAuthStore } from '@/stores/auth'
import { Button } from '@/components/ui/button'
import { ErrorState } from '@/components/ui/error-state'
import { Orb } from '@/components/chat/orb'
import { Mic } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'

export const Route = createFileRoute('/_auth/arena/')({
  beforeLoad: () => {
    if ((useAuthStore.getState().user?.role ?? 'USER') !== 'USER') {
      throw redirect({ to: '/dashboard' })
    }
  },
  component: PracticeLauncher,
})

const LANG_DISPLAY = new Intl.DisplayNames(['en'], { type: 'language' })
function langLabel(code: string): string {
  try { return LANG_DISPLAY.of(code) ?? code } catch { return code }
}

function PracticeLauncher() {
  const navigate = useNavigate()
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: personaKeys.mine(),
    queryFn: listMyPersonas,
  })

  // Persona waiting for language pick before voice start
  const [voicePicker, setVoicePicker] = useState<PersonaSummary | null>(null)
  const [launchingId, setLaunchingId] = useState<number | null>(null)

  const start = useMutation({
    mutationFn: (personaId: number) => startSession(personaId),
  })

  async function handleChat(personaId: number) {
    setLaunchingId(personaId)
    try {
      const { uid } = await start.mutateAsync(personaId)
      await navigate({ to: '/session/$uid', params: { uid } })
    } catch (err) {
      notify.error(err)
    } finally {
      setLaunchingId(null)
    }
  }

  async function handleVoiceLang(persona: PersonaSummary, langCode: string) {
    setVoicePicker(null)
    setLaunchingId(persona.id)
    try {
      const { uid } = await start.mutateAsync(persona.id)
      await navigate({
        to: '/session/$uid',
        params: { uid },
        search: { voice: langCode },
      })
    } catch (err) {
      notify.error(err)
    } finally {
      setLaunchingId(null)
    }
  }

  function handleVoiceClick(persona: PersonaSummary) {
    const langs = persona.languages ?? []
    if (langs.length === 0) return
    if (langs.length === 1) {
      void handleVoiceLang(persona, langs[0]!)
    } else {
      setVoicePicker(persona)
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Practice</h1>
        <p className="text-sm text-muted-foreground">
          Pick a persona and choose chat or voice.
        </p>
      </header>

      {isPending && <LauncherSkeleton />}
      {isError && <ErrorState title="Couldn't load personas" onRetry={() => refetch()} />}

      {data && data.personas.length === 0 && (
        <p className="rounded-lg border border-border bg-surface px-4 py-6 text-sm text-muted-foreground">
          No personas available yet. An admin or trainer needs to create one.
        </p>
      )}

      {data && data.personas.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.personas.map((p) => (
            <PersonaCard
              key={p.id}
              persona={p}
              launching={launchingId === p.id}
              onChat={() => handleChat(p.id)}
              onVoice={() => handleVoiceClick(p)}
            />
          ))}
        </ul>
      )}

      {/* Language picker dialog for multi-language personas */}
      <Dialog open={voicePicker !== null} onOpenChange={(v) => { if (!v) setVoicePicker(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Choose language</DialogTitle>
            <DialogDescription>
              Select the language you'll speak in for this voice session.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-2">
            {(voicePicker?.languages ?? []).map((code) => (
              <Button
                key={code}
                variant="secondary"
                className="justify-start gap-3 h-11"
                onClick={() => voicePicker && handleVoiceLang(voicePicker, code)}
              >
                <Mic className="size-4 shrink-0 text-muted-foreground" />
                <span>{langLabel(code)}</span>
                <span className="ml-auto font-mono text-xs text-muted-foreground">{code}</span>
              </Button>
            ))}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setVoicePicker(null)}>Cancel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

interface PersonaCardProps {
  persona: PersonaSummary
  launching: boolean
  onChat: () => void
  onVoice: () => void
}

function PersonaCard({ persona, launching, onChat, onVoice }: PersonaCardProps) {
  const hasVoice = (persona.languages?.length ?? 0) > 0
  return (
    <li className="flex flex-col rounded-lg border border-border bg-surface p-4">
      <div className="mb-3 flex items-start gap-3">
        <Orb
          colors={personaOrbColors(persona.color)}
          agentState="listening"
          className="size-10 shrink-0"
        />
        <div className="min-w-0">
          <div className="font-medium">{persona.name}</div>
          {persona.description && (
            <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">
              {persona.description}
            </p>
          )}
        </div>
      </div>
      <div className="mt-auto flex gap-2">
        <Button
          size="sm"
          className="flex-1"
          onClick={onChat}
          disabled={launching}
        >
          {launching ? 'Starting…' : 'Chat'}
        </Button>
        {hasVoice && (
          <Button
            size="sm"
            variant="secondary"
            onClick={onVoice}
            disabled={launching}
            aria-label="Start voice session"
            title="Start voice session"
          >
            <Mic className="size-4" />
          </Button>
        )}
      </div>
    </li>
  )
}

function LauncherSkeleton() {
  return (
    <div className="grid gap-3 grid-cols-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="h-28 animate-pulse rounded-lg border border-border bg-muted"
        />
      ))}
    </div>
  )
}
