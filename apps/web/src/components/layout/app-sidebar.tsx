import { Link } from '@tanstack/react-router'
import {
  LayoutDashboard,
  MessagesSquare,
  Users,
  Drama,
  BarChart3,
  Cpu,
  Settings,
  type LucideIcon,
} from 'lucide-react'
import type { UserRole } from '@/stores/auth'
import { useAuthStore } from '@/stores/auth'
import { Logo } from '@/components/logo'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'

interface NavItem {
  label: string
  to: string
  icon: LucideIcon
  roles: UserRole[]
}

const ALL: UserRole[] = ['SUPER_ADMIN', 'TRAINER', 'USER']

// Most targets land in F1+; Dashboard, Practice and LLM Ops route today.
const NAV: NavItem[] = [
  { label: 'Dashboard', to: '/dashboard', icon: LayoutDashboard, roles: ALL },
  { label: 'Practice', to: '/practice', icon: MessagesSquare, roles: ALL },
  {
    label: 'Personas',
    to: '/personas',
    icon: Drama,
    roles: ['SUPER_ADMIN', 'TRAINER'],
  },
  {
    label: 'Users',
    to: '/users',
    icon: Users,
    roles: ['SUPER_ADMIN', 'TRAINER'],
  },
  {
    label: 'Analytics',
    to: '/dashboard',
    icon: BarChart3,
    roles: ['SUPER_ADMIN', 'TRAINER'],
  },
  { label: 'LLM Ops', to: '/llm-ops', icon: Cpu, roles: ['SUPER_ADMIN'] },
]

// Settings pinned to the bottom of the rail.
const SETTINGS: NavItem = {
  label: 'Settings',
  to: '/settings',
  icon: Settings,
  roles: ALL,
}

function NavLink({ item }: { item: NavItem }) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild tooltip={item.label}>
        <Link
          to={item.to}
          activeProps={{ 'data-active': 'true' }}
          activeOptions={{ exact: item.to === '/dashboard' }}
        >
          <item.icon />
          <span>{item.label}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

export function AppSidebar() {
  const role = useAuthStore((s) => s.user?.role ?? 'USER')
  const items = NAV.filter((item) => item.roles.includes(role))

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              size="lg"
              className="data-[slot=sidebar-menu-button]:!p-1.5"
            >
              <Link
                to="/dashboard"
                className="group-data-[collapsible=icon]:!justify-center"
              >
                {/* Override the sidebar button's [&>svg]:size-4 clamp. */}
                <Logo className="size-7! shrink-0" />
                <span className="font-brand text-xl group-data-[collapsible=icon]:hidden">
                  Learnium
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            {items.map((item) => (
              <NavLink key={item.label} item={item} />
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <NavLink item={SETTINGS} />
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
