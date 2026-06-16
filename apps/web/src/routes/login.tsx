import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useState } from 'react'
import { apiPost } from '@/lib/api-client'
import { useAuthStore, type AuthUser } from '@/stores/auth'
import { notify } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import { ShaderBackground } from '@/components/shader-background'

export const Route = createFileRoute('/login')({
  beforeLoad: () => {
    if (useAuthStore.getState().isAuthenticated) {
      throw redirect({ to: '/dashboard' })
    }
  },
  component: LoginPage,
})

const loginSchema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
})

type LoginInput = z.infer<typeof loginSchema>

interface LoginResponse {
  user: AuthUser
  accessToken: string
}

function LoginPage() {
  const navigate = useNavigate()
  const setAuth = useAuthStore((s) => s.setAuth)
  const [submitting, setSubmitting] = useState(false)
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) })

  async function onSubmit(values: LoginInput) {
    setSubmitting(true)
    try {
      const { user, accessToken } = await apiPost<LoginResponse>(
        '/auth/login',
        values,
      )
      setAuth(user, accessToken)
      notify.success(`Welcome back, ${user.name}`)
      await navigate({ to: '/dashboard' })
    } catch (error) {
      notify.error(error)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="relative grid min-h-svh place-items-center overflow-hidden bg-background px-4">
      <ShaderBackground />
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface/95 p-8 shadow-lg backdrop-blur-sm">
        <div className="mb-6 space-y-1">
          <div
            className="mb-4 h-8 w-8 rounded-md"
            style={{
              background:
                'linear-gradient(135deg, var(--primary), var(--chart-2))',
            }}
          />
          <h1 className="text-2xl font-semibold tracking-tight">Learnium</h1>
          <p className="text-sm text-muted-foreground">
            Sign in to your training workspace.
          </p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <Field label="Email" error={errors.email?.message}>
            <input
              type="email"
              autoComplete="email"
              className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring"
              placeholder="you@company.com"
              {...register('email')}
            />
          </Field>

          <Field label="Password" error={errors.password?.message}>
            <input
              type="password"
              autoComplete="current-password"
              className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring"
              placeholder="••••••••"
              {...register('password')}
            />
          </Field>

          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={submitting}
          >
            {submitting ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>

        <p className="mt-4 text-center text-xs text-faint-foreground">
          Mock login — use any email + password{' '}
          <span className="font-data">password</span>
        </p>
      </div>
    </div>
  )
}

interface FieldProps {
  label: string
  error?: string
  children: React.ReactNode
}

function Field({ label, error, children }: FieldProps) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium">{label}</label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
