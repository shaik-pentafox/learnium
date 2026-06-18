import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, LogOut, Settings, UserCircle } from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { getMe, accountKeys } from '@/services/account'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useAuthStore } from '@/stores/auth'
import { logout } from '@/services/auth'
import { notify } from '@/lib/toast'

const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin',
  TRAINER: 'Trainer',
  USER: 'Trainee',
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  const first = parts[0]?.[0] ?? '?'
  const second = parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : ''
  return (first + second).toUpperCase()
}

/** Account menu for the top bar — avatar + name/role trigger with an
 *  account/settings/logout dropdown. */
export function NavUser() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  // Prefer the real profile (full name) over the login username.
  const me = useQuery({
    queryKey: accountKeys.me(),
    queryFn: getMe,
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  })

  if (!user) return null

  async function onLogout() {
    await logout()
    notify.message('Signed out')
    await navigate({ to: '/login' })
  }

  const fullName = me.data
    ? `${me.data.firstName} ${me.data.lastName}`.trim()
    : ''
  const displayName = fullName || user.name
  const roleLabel = ROLE_LABEL[user.role] ?? user.role

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-2 rounded-md p-1 pr-2 transition-colors hover:bg-muted data-[state=open]:bg-muted"
        >
          <Avatar className="size-8 rounded-lg">
            <AvatarFallback className="rounded-lg bg-primary text-xs text-primary-foreground">
              {initials(displayName)}
            </AvatarFallback>
          </Avatar>
          <div className="hidden text-left leading-tight sm:grid">
            <span className="truncate text-sm font-medium">{displayName}</span>
            <span className="truncate text-xs text-muted-foreground">
              {roleLabel}
            </span>
          </div>
          <ChevronDown className="size-4 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="min-w-56 rounded-lg"
        side="bottom"
        align="end"
        sideOffset={6}
      >
        <DropdownMenuLabel className="p-0 font-normal">
          <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
            <Avatar className="size-8 rounded-lg">
              <AvatarFallback className="rounded-lg bg-primary text-xs text-primary-foreground">
                {initials(displayName)}
              </AvatarFallback>
            </Avatar>
            <div className="grid flex-1 leading-tight">
              <span className="truncate font-medium">{displayName}</span>
              <span className="truncate text-xs text-muted-foreground">
                {roleLabel}
              </span>
            </div>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={() => navigate({ to: '/settings' })}>
            <UserCircle />
            Account
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => navigate({ to: '/settings' })}>
            <Settings />
            Settings
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onLogout}>
          <LogOut />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
