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
import { NavUser } from '@/components/layout/nav-user'
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

// Most targets land in F1+; only Dashboard and Practice route today.
const NAV: NavItem[] = [
  { label: 'Dashboard', to: '/dashboard', icon: LayoutDashboard, roles: ALL },
  { label: 'Practice', to: '/practice', icon: MessagesSquare, roles: ALL },
  {
    label: 'Personas',
    to: '/dashboard',
    icon: Drama,
    roles: ['SUPER_ADMIN', 'TRAINER'],
  },
  {
    label: 'Users',
    to: '/dashboard',
    icon: Users,
    roles: ['SUPER_ADMIN', 'TRAINER'],
  },
  {
    label: 'Analytics',
    to: '/dashboard',
    icon: BarChart3,
    roles: ['SUPER_ADMIN', 'TRAINER'],
  },
  { label: 'LLM Ops', to: '/dashboard', icon: Cpu, roles: ['SUPER_ADMIN'] },
  { label: 'Settings', to: '/dashboard', icon: Settings, roles: ALL },
]

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
              <Link to="/dashboard">
                {/* Override the sidebar button's [&>svg]:size-4 clamp; shrink in the icon rail. */}
                <Logo className="size-7!" />
                <span className="font-brand text-xl">Learnium</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            {items.map((item) => (
              <SidebarMenuItem key={item.label}>
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
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
    </Sidebar>
  )
}
