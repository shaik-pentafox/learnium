import { useRef, useState } from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { z } from 'zod'
import { Plus, Pencil, Trash2, Upload, Search } from 'lucide-react'
import { useAuthStore } from '@/stores/auth'
import { queryKeys } from '@/lib/query-keys'
import { notify } from '@/lib/toast'
import { listUsers, deleteUser, userKeys, type UserListItem } from '@/services/users'
import { listRoles, roleKeys, roleLabel } from '@/services/roles'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { UserFormDialog } from '@/components/users/user-form-dialog'
import { ImportUsersDialog } from '@/components/users/import-users-dialog'

const PAGE_SIZE = 20
const SEARCH_DEBOUNCE_MS = 300
const ALL_ROLES = 'all'

const usersSearchSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  q: z.string().optional(),
  roleId: z.coerce.number().int().optional(),
})
type UsersSearch = z.infer<typeof usersSearchSchema>

export const Route = createFileRoute('/_auth/users')({
  validateSearch: (search): UsersSearch => usersSearchSchema.parse(search),
  beforeLoad: () => {
    const role = useAuthStore.getState().user?.role
    if (role !== 'SUPER_ADMIN' && role !== 'TRAINER') {
      throw redirect({ to: '/dashboard' })
    }
  },
  component: UsersPage,
})

function UsersPage() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const isSuperAdmin = useAuthStore((s) => s.user?.role === 'SUPER_ADMIN')

  const params = {
    page: search.page,
    limit: PAGE_SIZE,
    q: search.q,
    roleId: search.roleId,
  }
  const users = useQuery({
    queryKey: userKeys.list(params),
    queryFn: () => listUsers(params),
    placeholderData: keepPreviousData,
  })

  const roles = useQuery({
    queryKey: roleKeys.all(),
    queryFn: listRoles,
    enabled: isSuperAdmin,
    staleTime: Infinity,
  })

  const [editing, setEditing] = useState<{ user: UserListItem | null } | null>(null)
  const [deleting, setDeleting] = useState<UserListItem | null>(null)
  const [importing, setImporting] = useState(false)

  function patchSearch(patch: Partial<typeof search>) {
    navigate({ search: (prev) => ({ ...prev, ...patch }) })
  }

  // Debounced text search → URL.
  const [qInput, setQInput] = useState(search.q ?? '')
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  function onSearchChange(value: string) {
    setQInput(value)
    clearTimeout(debounce.current)
    debounce.current = setTimeout(
      () => patchSearch({ q: value || undefined, page: 1 }),
      SEARCH_DEBOUNCE_MS,
    )
  }

  const data = users.data
  const totalPages = data?.totalPages ?? 1

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {isSuperAdmin ? 'Users' : 'My Trainees'}
          </h1>
          <p className="text-sm text-muted-foreground">
            {isSuperAdmin
              ? 'Manage members, roles, and supervisor assignments.'
              : 'Manage the trainees assigned to you.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isSuperAdmin && (
            <Button variant="secondary" size="sm" onClick={() => setImporting(true)}>
              <Upload />
              Import
            </Button>
          )}
          <Button size="sm" onClick={() => setEditing({ user: null })}>
            <Plus />
            {isSuperAdmin ? 'Add user' : 'Add trainee'}
          </Button>
        </div>
      </header>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={qInput}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search name, email, ID…"
            className="pl-9"
          />
        </div>
        {isSuperAdmin && (
          <Select
            value={search.roleId != null ? String(search.roleId) : ALL_ROLES}
            onValueChange={(v) =>
              patchSearch({
                roleId: v === ALL_ROLES ? undefined : Number(v),
                page: 1,
              })
            }
          >
            <SelectTrigger className="w-40">
              <SelectValue placeholder="All roles" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_ROLES}>All roles</SelectItem>
              {roles.data?.map((r) => (
                <SelectItem key={r.id} value={String(r.id)}>
                  {roleLabel(r.name)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <Th>Name</Th>
              <Th>Email</Th>
              <Th>Role</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {users.isPending && (
              <tr>
                <td colSpan={4} className="px-4 py-6">
                  <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
                </td>
              </tr>
            )}
            {users.isError && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-sm">
                  <span className="text-destructive">Couldn’t load users.</span>{' '}
                  <button
                    type="button"
                    onClick={() => users.refetch()}
                    className="text-primary hover:underline"
                  >
                    Retry
                  </button>
                </td>
              </tr>
            )}
            {data?.users.map((u) => (
              <UserRow
                key={u.id}
                user={u}
                onEdit={() => setEditing({ user: u })}
                onDelete={() => setDeleting(u)}
              />
            ))}
            {data && data.users.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-sm text-muted-foreground">
                  {search.q || search.roleId
                    ? 'No users match your filters.'
                    : 'No users yet.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {data && data.total > 0 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            {data.total} {data.total === 1 ? 'user' : 'users'} · page {data.page} of{' '}
            {totalPages}
          </span>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={data.page <= 1}
              onClick={() => patchSearch({ page: data.page - 1 })}
            >
              Previous
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={data.page >= totalPages}
              onClick={() => patchSearch({ page: data.page + 1 })}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      <UserFormDialog
        open={editing != null}
        user={editing?.user ?? null}
        onOpenChange={(open) => {
          if (!open) setEditing(null)
        }}
      />
      <DeleteUserDialog
        user={deleting}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
      />
      {isSuperAdmin && (
        <ImportUsersDialog open={importing} onOpenChange={setImporting} />
      )}
    </div>
  )
}

interface UserRowProps {
  user: UserListItem
  onEdit: () => void
  onDelete: () => void
}

function UserRow({ user, onEdit, onDelete }: UserRowProps) {
  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-4 py-3">
        <div className="font-medium">
          {user.firstName} {user.lastName}
        </div>
        <div className="font-data text-xs text-muted-foreground">
          {user.employeeId}
        </div>
      </td>
      <td className="px-4 py-3 text-muted-foreground">{user.email}</td>
      <td className="px-4 py-3">
        <RolePill name={user.role.name} />
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={onEdit}
            aria-label={`Edit ${user.firstName} ${user.lastName}`}
          >
            <Pencil className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:text-destructive"
            onClick={onDelete}
            aria-label={`Delete ${user.firstName} ${user.lastName}`}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </td>
    </tr>
  )
}

function RolePill({ name }: { name: string }) {
  const style =
    name === 'SUPER_ADMIN'
      ? 'bg-primary/10 text-primary'
      : name === 'TRAINER'
        ? 'bg-info/15 text-info'
        : 'bg-muted text-muted-foreground'
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${style}`}>
      {roleLabel(name)}
    </span>
  )
}

function DeleteUserDialog({
  user,
  onOpenChange,
}: {
  user: UserListItem | null
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: (id: number) => deleteUser(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.users })
      notify.success('User removed')
      onOpenChange(false)
    },
  })

  return (
    <Dialog open={user != null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Remove user</DialogTitle>
          <DialogDescription>
            {user
              ? `Remove ${user.firstName} ${user.lastName}? They’ll lose access immediately. This can be undone by an admin.`
              : ''}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={mutation.isPending}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => user && mutation.mutate(user.id)}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? 'Removing…' : 'Remove'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Th({
  children,
  className = '',
}: {
  children: React.ReactNode
  className?: string
}) {
  return <th className={`px-4 py-2.5 font-medium ${className}`}>{children}</th>
}
