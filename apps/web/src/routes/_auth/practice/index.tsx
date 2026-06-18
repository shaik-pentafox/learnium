import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery, useMutation } from '@tanstack/react-query'
import {
  listMyPersonas,
  personaKeys,
  type PersonaSummary,
} from '@/services/personas'
import { startSession } from '@/services/roleplay'
import { personaOrbColors } from '@/lib/persona-color'
import { notify } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import { Orb } from '@/components/chat/orb'

export const Route = createFileRoute('/_auth/practice/')({
  component: PracticeLauncher,
})

function PracticeLauncher() {
  const navigate = useNavigate()
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: personaKeys.mine(),
    queryFn: listMyPersonas,
  })

  const start = useMutation({
    mutationFn: (personaId: number) => startSession(personaId),
    onSuccess: ({ uid }) =>
      navigate({ to: '/practice/$uid', params: { uid } }),
    onError: (err) => notify.error(err),
  })

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Practice</h1>
        <p className="text-sm text-muted-foreground">
          Pick a persona to start a text roleplay session.
        </p>
      </header>

      {isPending && <LauncherSkeleton />}
      {isError && (
        <div className="rounded-lg border border-border bg-surface p-4 text-sm">
          <p className="text-destructive">Couldn’t load personas.</p>
          <button
            type="button"
            onClick={() => refetch()}
            className="mt-2 text-primary hover:underline"
          >
            Retry
          </button>
        </div>
      )}

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
              starting={start.isPending && start.variables === p.id}
              onStart={() => start.mutate(p.id)}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

interface PersonaCardProps {
  persona: PersonaSummary
  starting: boolean
  onStart: () => void
}

function PersonaCard({ persona, starting, onStart }: PersonaCardProps) {
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
      <Button
        size="sm"
        className="mt-auto self-start"
        onClick={onStart}
        disabled={starting}
      >
        {starting ? 'Starting…' : 'Start session'}
      </Button>
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
