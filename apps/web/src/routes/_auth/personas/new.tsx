import { createFileRoute, redirect } from '@tanstack/react-router'
import { PersonaBuilder } from '@/components/personas/persona-builder'
import { useAuthStore } from '@/stores/auth'

export const Route = createFileRoute('/_auth/personas/new')({
  beforeLoad: () => {
    // Persona authoring is trainer + admin (personas:write); trainees bounce.
    if (useAuthStore.getState().user?.role === 'USER') {
      throw redirect({ to: '/dashboard' })
    }
  },
  component: () => <PersonaBuilder />,
})
