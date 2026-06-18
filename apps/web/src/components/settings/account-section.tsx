import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getMe,
  updateProfile,
  changePassword,
  accountKeys,
  type Account,
} from '@/services/account'
import { notify } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/ui/password-input'
import { SettingsSection } from '@/components/settings/settings-section'

const MIN_PASSWORD_LENGTH = 6

export function AccountSection() {
  const me = useQuery({ queryKey: accountKeys.me(), queryFn: getMe })

  return (
    <SettingsSection
      id="account"
      title="Account"
      description="Manage your profile and password."
    >
      {me.isPending ? (
        <div className="p-6">
          <div className="h-32 animate-pulse rounded-lg bg-muted" />
        </div>
      ) : me.isError ? (
        <div className="p-6 text-sm">
          <p className="text-destructive">Couldn’t load your account.</p>
          <button
            type="button"
            onClick={() => me.refetch()}
            className="mt-2 text-primary hover:underline"
          >
            Retry
          </button>
        </div>
      ) : (
        <div className="divide-y divide-border">
          {/* Remount the form when the loaded account changes. */}
          <ProfileForm key={me.data.id} account={me.data} />
          <PasswordForm />
        </div>
      )}
    </SettingsSection>
  )
}

function ProfileForm({ account }: { account: Account }) {
  const queryClient = useQueryClient()
  const [firstName, setFirstName] = useState(account.firstName)
  const [lastName, setLastName] = useState(account.lastName)
  const [email, setEmail] = useState(account.email)

  const mutation = useMutation({
    mutationFn: () => updateProfile({ firstName, lastName, email }),
    onSuccess: (updated) => {
      queryClient.setQueryData(accountKeys.me(), updated)
      notify.success('Profile updated')
    },
  })

  const initials = `${firstName[0] ?? ''}${lastName[0] ?? ''}`.toUpperCase()

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        mutation.mutate()
      }}
      className="flex flex-col gap-4 p-6"
    >
      <div className="flex items-center gap-4">
        <div className="grid size-14 shrink-0 place-items-center rounded-full bg-accent text-lg font-semibold text-accent-foreground">
          {initials || '—'}
        </div>
        <div className="text-sm">
          <div className="font-medium">
            {account.username ?? account.employeeId}
          </div>
          <div className="text-xs text-muted-foreground">
            {account.role} · {account.employeeId}
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="First name">
          <Input
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            required
          />
        </Field>
        <Field label="Last name">
          <Input
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            required
          />
        </Field>
      </div>

      <Field label="Email">
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </Field>

      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={mutation.isPending}>
          {mutation.isPending ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </form>
  )
}

function PasswordForm() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')

  const mutation = useMutation({
    mutationFn: () =>
      changePassword({ currentPassword: current, newPassword: next }),
    onSuccess: () => {
      setCurrent('')
      setNext('')
      setConfirm('')
      notify.success('Password changed. You may need to sign in again soon.')
    },
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (next.length < MIN_PASSWORD_LENGTH) {
      notify.message(`New password must be at least ${MIN_PASSWORD_LENGTH} characters`)
      return
    }
    if (next !== confirm) {
      notify.message('New password and confirmation do not match')
      return
    }
    mutation.mutate()
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 p-6">
      <div>
        <h4 className="text-sm font-medium">Change password</h4>
        <p className="text-xs text-muted-foreground">
          Choose a strong password you don’t use elsewhere.
        </p>
      </div>

      <Field label="Current password">
        <PasswordInput
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          autoComplete="current-password"
          required
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="New password">
          <PasswordInput
            value={next}
            onChange={(e) => setNext(e.target.value)}
            autoComplete="new-password"
            required
          />
        </Field>
        <Field label="Confirm new password">
          <PasswordInput
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            required
          />
        </Field>
      </div>

      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={mutation.isPending}>
          {mutation.isPending ? 'Updating…' : 'Update password'}
        </Button>
      </div>
    </form>
  )
}

interface FieldProps {
  label: string
  children: React.ReactNode
}

function Field({ label, children }: FieldProps) {
  return (
    <label className="block space-y-2 text-sm">
      <span className="font-medium">{label}</span>
      {children}
    </label>
  )
}
