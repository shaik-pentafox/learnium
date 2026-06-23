import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { useAuthStore } from '@/stores/auth'
import { AppSidebar } from '@/components/layout/app-sidebar'
import { ThemeToggle } from '@/components/layout/theme-toggle'
import { NavUser } from '@/components/layout/nav-user'
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import { Separator } from '@/components/ui/separator'

export const Route = createFileRoute('/_auth')({
  beforeLoad: () => {
    if (!useAuthStore.getState().isAuthenticated) {
      throw redirect({ to: '/login' })
    }
  },
  component: AuthLayout,
})

function AuthLayout() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="h-svh overflow-hidden bg-sidebar">
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 bg-sidebar px-4 text-sidebar-foreground">
          <SidebarTrigger className="-ml-1" />
          <Separator
            orientation="vertical"
            className="mx-1 data-[orientation=vertical]:h-4"
          />
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <Separator
              orientation="vertical"
              className="data-[orientation=vertical]:h-4"
            />
            <NavUser />
          </div>
        </header>
        <main className="flex-1 overflow-auto rounded-tl-2xl bg-background py-6 px-8">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
