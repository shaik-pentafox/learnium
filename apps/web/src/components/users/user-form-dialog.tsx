import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/ui/password-input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { notify } from '@/lib/toast'
import { queryKeys } from '@/lib/query-keys'
import { useAuthStore } from '@/stores/auth'
import { listRoles, roleKeys, roleLabel } from '@/services/roles'
import {
  createUser,
  updateUser,
  listUsers,
  type UserDetail,
  type UserListItem,
} from '@/services/users'

interface UserFormDialogProps {
  open: boolean
  /** `null` opens create mode; a user opens edit mode. */
  user: UserListItem | UserDetail | null
  onOpenChange: (open: boolean) => void
}

interface FormState {
  employeeId: string
  firstName: string
  lastName: string
  email: string
  roleId: string
  supervisorId: string // '' = none
  username: string
  password: string
}

const NO_SUPERVISOR = 'none'

function initialState(user: UserListItem | UserDetail | null): FormState {
  return {
    employeeId: user?.employeeId ?? '',
    firstName: user?.firstName ?? '',
    lastName: user?.lastName ?? '',
    email: user?.email ?? '',
    roleId: user?.roleId != null ? String(user.roleId) : '',
    supervisorId: user?.supervisorId != null ? String(user.supervisorId) : '',
    username: '',
    password: '',
  }
}

export function UserFormDialog({ open, user, onOpenChange }: UserFormDialogProps) {
  const isEdit = user != null
  const queryClient = useQueryClient()
  const isSuperAdmin = useAuthStore((s) => s.user?.role === 'SUPER_ADMIN')

  const roles = useQuery({
    queryKey: roleKeys.all(),
    queryFn: listRoles,
    enabled: open,
    staleTime: Infinity,
  })
  const traineeRoleId = roles.data?.find((r) => r.name === 'USER')?.id
  const trainerRoleId = roles.data?.find((r) => r.name === 'TRAINER')?.id

  // Supervisor options (trainers) — only Super Admin assigns them.
  const supervisors = useQuery({
    queryKey: [...queryKeys.users, 'supervisors'],
    queryFn: () => listUsers({ roleId: trainerRoleId, limit: 100 }),
    enabled: open && isSuperAdmin && trainerRoleId != null,
  })

  const [form, setForm] = useState<FormState>(() => initialState(user))
  const [wasOpen, setWasOpen] = useState(false)
  if (open && !wasOpen) {
    setWasOpen(true)
    setForm(initialState(user))
  } else if (!open && wasOpen) {
    setWasOpen(false)
  }

  const mutation = useMutation({
    mutationFn: () => {
      if (isEdit) {
        return updateUser(user.id, {
          firstName: form.firstName,
          lastName: form.lastName,
          email: form.email,
          // Only Super Admin may change role/supervisor.
          ...(isSuperAdmin
            ? {
                roleId: Number(form.roleId),
                supervisorId: form.supervisorId ? Number(form.supervisorId) : null,
              }
            : {}),
        })
      }
      // Create. Trainers always create trainees (backend forces supervisor=self).
      const roleId = isSuperAdmin ? Number(form.roleId) : (traineeRoleId ?? NaN)
      return createUser({
        employeeId: form.employeeId,
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email,
        roleId,
        ...(isSuperAdmin && form.supervisorId
          ? { supervisorId: Number(form.supervisorId) }
          : {}),
        ...(form.username ? { username: form.username } : {}),
        ...(form.password ? { password: form.password } : {}),
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.users })
      notify.success(isEdit ? 'User updated' : 'User created')
      onOpenChange(false)
    },
  })

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (isSuperAdmin && !form.roleId) {
      notify.message('Pick a role')
      return
    }
    mutation.mutate()
  }

  // Trainers can only create trainees; hide the role picker entirely for them.
  const showRolePicker = isSuperAdmin

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-lg"
        onInteractOutside={(e) => {
          const target = (e.detail.originalEvent.target ?? e.target) as Element | null
          if (target?.closest('[data-slot="select-content"]')) e.preventDefault()
        }}
      >
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit user' : 'Add user'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Update this user’s details.'
              : isSuperAdmin
                ? 'Create a user and assign their role.'
                : 'Create a trainee. They’ll be assigned to you.'}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={handleSubmit}
          className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto"
        >
          {!isEdit && (
            <Field label="Employee ID">
              <Input
                value={form.employeeId}
                onChange={(e) => set('employeeId', e.target.value)}
                required
                placeholder="E-1024"
              />
            </Field>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="First name">
              <Input
                value={form.firstName}
                onChange={(e) => set('firstName', e.target.value)}
                required
              />
            </Field>
            <Field label="Last name">
              <Input
                value={form.lastName}
                onChange={(e) => set('lastName', e.target.value)}
                required
              />
            </Field>
          </div>

          <Field label="Email">
            <Input
              type="email"
              value={form.email}
              onChange={(e) => set('email', e.target.value)}
              required
            />
          </Field>

          {showRolePicker && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Role">
                <Select value={form.roleId} onValueChange={(v) => set('roleId', v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a role" />
                  </SelectTrigger>
                  <SelectContent>
                    {roles.data?.map((r) => (
                      <SelectItem key={r.id} value={String(r.id)}>
                        {roleLabel(r.name)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Supervisor" hint="Optional">
                <Select
                  value={form.supervisorId || NO_SUPERVISOR}
                  onValueChange={(v) =>
                    set('supervisorId', v === NO_SUPERVISOR ? '' : v)
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_SUPERVISOR}>None</SelectItem>
                    {supervisors.data?.users.map((s) => (
                      <SelectItem key={s.id} value={String(s.id)}>
                        {s.firstName} {s.lastName} ({s.employeeId})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
          )}

          {!isEdit && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Username" hint="Defaults to Employee ID">
                <Input
                  value={form.username}
                  onChange={(e) => set('username', e.target.value)}
                  autoComplete="off"
                  placeholder={form.employeeId || 'username'}
                />
              </Field>
              <Field label="Temp password" hint="Defaults to Employee ID">
                <PasswordInput
                  value={form.password}
                  onChange={(e) => set('password', e.target.value)}
                  autoComplete="new-password"
                  placeholder="••••••"
                />
              </Field>
            </div>
          )}

          <DialogFooter className="mt-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending
                ? 'Saving…'
                : isEdit
                  ? 'Save changes'
                  : 'Create user'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

interface FieldProps {
  label: string
  hint?: string
  children: React.ReactNode
}

function Field({ label, hint, children }: FieldProps) {
  return (
    <label className="block space-y-2 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
    </label>
  )
}
