import { createFileRoute } from '@tanstack/react-router'
import { AccountSection } from '@/components/settings/account-section'

export const Route = createFileRoute('/_auth/settings')({
  component: SettingsPage,
})

function SettingsPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">Manage your account.</p>
      </header>
      <AccountSection />
    </div>
  )
}
