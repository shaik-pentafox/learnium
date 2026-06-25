import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useState } from 'react'
import { login } from '@/services/auth'
import { useAuthStore } from '@/stores/auth'
import { notify } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/ui/password-input'
import { Logo } from '@/components/logo'
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
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
})

type LoginInput = z.infer<typeof loginSchema>

function LoginPage() {
  const navigate = useNavigate()
  const [submitting, setSubmitting] = useState(false)
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) })

  async function onSubmit(values: LoginInput) {
    setSubmitting(true)
    try {
      await login(values)
      notify.success('Welcome back')
      await navigate({ to: '/dashboard' })
    } catch (error) {
      notify.error(error)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="relative grid min-h-svh place-items-center overflow-hidden px-4">
      <ShaderBackground />
      <div className="relative z-10 w-full max-w-sm rounded-lg border border-border bg-surface/95 p-8 shadow-lg backdrop-blur-sm">
        <div className="mb-6 space-y-3">
          <div className="flex items-center gap-2.5">
            <Logo className="size-9 shrink-0" />
            <h1 className="font-brand text-3xl">Traineon</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Sign in to your training workspace.
          </p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <Field label="Username" error={errors.username?.message}>
            <Input
              type="text"
              autoComplete="username"
              className="h-11"
              placeholder="your.username"
              {...register('username')}
            />
          </Field>

          <Field label="Password" error={errors.password?.message}>
            <PasswordInput
              autoComplete="current-password"
              className="h-11"
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
          Dev mock — any username + password{' '}
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
    <div>
      <label className="mb-2 block text-sm font-medium">{label}</label>
      {children}
      {error && <p className="mt-1.5 text-xs text-destructive">{error}</p>}
    </div>
  )
}
