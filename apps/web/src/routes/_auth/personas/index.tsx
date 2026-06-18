import { createFileRoute, redirect, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Plus, Pencil, Drama } from 'lucide-react'
import {
  listMyPersonas,
  personaKeys,
  type PersonaSummary,
} from '@/services/personas'
import { useAuthStore } from '@/stores/auth'
import { personaOrbColors } from '@/lib/persona-color'
import { buttonVariants } from '@/components/ui/button'

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
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: personaKeys.mine(),
    queryFn: listMyPersonas,
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
            <PersonaCard key={p.id} persona={p} />
          ))}
        </ul>
      )}
    </div>
  )
}

function PersonaCard({ persona }: { persona: PersonaSummary }) {
  return (
    <li className="group relative flex flex-col rounded-xl border border-border bg-surface p-4 transition-colors hover:border-primary/40">
      <div className="mb-3 flex items-start gap-3">
        <PersonaBadge color={persona.color} />
        <div className="min-w-0">
          <div className="truncate font-medium">{persona.name}</div>
          {persona.description && (
            <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">
              {persona.description}
            </p>
          )}
        </div>
      </div>
      <Link
        to="/personas/$id"
        params={{ id: String(persona.id) }}
        className={buttonVariants({
          variant: 'secondary',
          size: 'sm',
          className: 'mt-auto self-start',
        })}
      >
        <Pencil className="size-4" />
        Edit
      </Link>
    </li>
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
