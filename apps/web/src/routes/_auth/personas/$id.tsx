import { createFileRoute, redirect, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { PersonaBuilder } from '@/components/personas/persona-builder'
import { getPersona, personaKeys } from '@/services/personas'
import { useAuthStore } from '@/stores/auth'

export const Route = createFileRoute('/_auth/personas/$id')({
  beforeLoad: () => {
    // Persona authoring is trainer + admin (personas:write); trainees bounce.
    if (useAuthStore.getState().user?.role === 'USER') {
      throw redirect({ to: '/dashboard' })
    }
  },
  component: EditPersonaPage,
})

function EditPersonaPage() {
  const { id } = Route.useParams()
  const personaId = Number(id)

  const { data, isPending, isError, refetch } = useQuery({
    queryKey: personaKeys.detail(personaId),
    queryFn: () => getPersona(personaId),
    enabled: Number.isFinite(personaId),
  })

  if (isPending) return <BuilderSkeleton />

  if (isError || !data) {
    return (
      <div className="mx-auto max-w-md rounded-lg border border-border bg-surface p-6 text-center text-sm">
        <p className="text-destructive">Couldn’t load this persona.</p>
        <div className="mt-3 flex justify-center gap-3">
          <button
            type="button"
            onClick={() => refetch()}
            className="text-primary hover:underline"
          >
            Retry
          </button>
          <Link to="/personas" className="text-muted-foreground hover:underline">
            Back to personas
          </Link>
        </div>
      </div>
    )
  }

  return <PersonaBuilder persona={data} />
}

function BuilderSkeleton() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 lg:flex-row">
      <div className="flex-1 space-y-4">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-32 animate-pulse rounded-lg border border-border bg-muted" />
        ))}
      </div>
      <div className="h-64 w-full shrink-0 animate-pulse rounded-lg border border-border bg-muted lg:w-80" />
    </div>
  )
}
