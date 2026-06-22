import { createFileRoute, redirect, Link, useNavigate } from '@tanstack/react-router'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Plus, Pencil, Drama, Rocket } from 'lucide-react'
import {
  listMyPersonas,
  personaKeys,
  type PersonaSummary,
} from '@/services/personas'
import { startSession } from '@/services/roleplay'
import { useAuthStore } from '@/stores/auth'
import { personaOrbColors } from '@/lib/persona-color'
import { notify } from '@/lib/toast'
import { Button, buttonVariants } from '@/components/ui/button'

export const Route = createFileRoute('/_auth/personas/')({
  beforeLoad: () => {
    // Persona authoring is trainer + admin (personas:write); trainees bounce.
    if (useAuthStore.getState().user?.role === 'USER') {
      throw redirect({ to: '/dashboard' })
    }
  },
  component: PersonasListPage,
})

function PersonasListPage() {
  const navigate = useNavigate()
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: personaKeys.mine(),
    queryFn: listMyPersonas,
  })

  // Owner "Test" = a simulation session against this persona (draft or published).
  const test = useMutation({
    mutationFn: (personaId: number) => startSession(personaId, { simulation: true }),
    onSuccess: ({ uid }) => navigate({ to: '/session/$uid', params: { uid } }),
    onError: (err) => notify.error(err),
  })

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Personas</h1>
          <p className="text-sm text-muted-foreground">
            The characters your trainees roleplay against.
          </p>
        </div>
        <Link to="/personas/new" className={buttonVariants()}>
          <Plus />
          New persona
        </Link>
      </header>

      {isPending && <ListSkeleton />}
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
        <div className="rounded-lg border border-dashed border-border bg-surface px-4 py-10 text-center">
          <Drama className="mx-auto size-8 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">
            No personas yet. Create one to get started.
          </p>
          <Link to="/personas/new" className={buttonVariants({ className: 'mt-4' })}>
            <Plus />
            New persona
          </Link>
        </div>
      )}

      {data && data.personas.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.personas.map((p) => (
            <PersonaCard
              key={p.id}
              persona={p}
              testing={test.isPending && test.variables === p.id}
              onTest={() => test.mutate(p.id)}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function PersonaCard({
  persona,
  testing,
  onTest,
}: {
  persona: PersonaSummary
  testing: boolean
  onTest: () => void
}) {
  return (
    <li className="group relative flex flex-col rounded-xl border border-border bg-surface p-4 transition-colors hover:border-primary/40">
      <div className="mb-3 flex items-start gap-3">
        <PersonaBadge color={persona.color} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{persona.name}</span>
            <PublishBadge published={persona.isPublished} />
            {persona.readonly && (
              <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                Shared
              </span>
            )}
          </div>
          {persona.description && (
            <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">
              {persona.description}
            </p>
          )}
        </div>
      </div>
      <div className="mt-auto flex items-center gap-2">
        {!persona.readonly && (
          <Link
            to="/personas/$id"
            params={{ id: String(persona.id) }}
            className={buttonVariants({ variant: 'secondary', size: 'sm' })}
          >
            <Pencil className="size-4" />
            Edit
          </Link>
        )}
        <Button size="sm" onClick={onTest} disabled={testing}>
          <Rocket className="size-4" />
          {testing ? 'Starting…' : 'Test'}
        </Button>
      </div>
    </li>
  )
}

/** Published vs draft pill — drafts are hidden from trainees. */
function PublishBadge({ published }: { published?: boolean }) {
  return (
    <span
      className={
        published
          ? 'shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary'
          : 'shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground'
      }
    >
      {published ? 'Published' : 'Draft'}
    </span>
  )
}

/** Persona-colored orb badge (CSS gradient — cheap for long lists). */
function PersonaBadge({ color }: { color?: string | null }) {
  const [base, light] = personaOrbColors(color)
  return (
    <div
      className="size-10 shrink-0 rounded-full ring-1 ring-border"
      style={{
        background: `radial-gradient(circle at 32% 28%, ${light}, ${base} 72%)`,
      }}
    />
  )
}

function ListSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className="h-16 animate-pulse rounded-lg border border-border bg-muted"
        />
      ))}
    </div>
  )
}
