import { useState } from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Plus, Cpu, Pencil, Plug, BarChart3 } from 'lucide-react'
import { listProviders, llmKeys, type LlmProvider } from '@/services/llm'
import { useAuthStore } from '@/stores/auth'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { ProviderFormSheet } from '@/components/llm-ops/provider-form-sheet'
import { ModelsSection } from '@/components/settings/models-section'
import { UsagePanel } from '@/components/llm-ops/usage-panel'

export const Route = createFileRoute('/_auth/llm-ops')({
  beforeLoad: () => {
    // LLM Ops is Super Admin only; trainers/trainees bounce to the dashboard.
    if (useAuthStore.getState().user?.role !== 'SUPER_ADMIN') {
      throw redirect({ to: '/dashboard' })
    }
  },
  component: LlmOpsPage,
})

function LlmOpsPage() {
  const providers = useQuery({
    queryKey: llmKeys.providers(),
    queryFn: listProviders,
  })

  // `null` while closed; `{ provider: null }` for add; `{ provider }` for edit.
  const [editing, setEditing] = useState<{ provider: LlmProvider | null } | null>(
    null,
  )

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">LLM Operations</h1>
        <p className="text-sm text-muted-foreground">
          Providers, model registry, and usage — all in one place.
        </p>
      </header>

      <ProviderFormSheet
        open={editing != null}
        provider={editing?.provider ?? null}
        onOpenChange={(open) => {
          if (!open) setEditing(null)
        }}
      />

      <Tabs defaultValue="providers">
        <TabsList>
          <TabsTrigger value="providers">
            <Plug />
            Providers
          </TabsTrigger>
          <TabsTrigger value="models">
            <Cpu />
            Models
          </TabsTrigger>
          <TabsTrigger value="usage">
            <BarChart3 />
            Usage
          </TabsTrigger>
        </TabsList>

        {/* Providers */}
        <TabsContent value="providers" className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Providers
            </h2>
            <Button size="sm" onClick={() => setEditing({ provider: null })}>
              <Plus />
              Add provider
            </Button>
          </div>
          {providers.isPending ? (
            <CardSkeleton count={3} />
          ) : providers.isError ? (
            <ErrorRow onRetry={() => providers.refetch()} />
          ) : providers.data && providers.data.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {providers.data.map((p) => (
                <ProviderCard
                  key={p.id}
                  provider={p}
                  onEdit={() => setEditing({ provider: p })}
                />
              ))}
            </div>
          ) : (
            <EmptyRow text="No providers configured yet." />
          )}
        </TabsContent>

        {/* Models — full CRUD (moved here from Settings) */}
        <TabsContent value="models">
          <ModelsSection />
        </TabsContent>

        {/* Usage telemetry */}
        <TabsContent value="usage">
          <UsagePanel />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function ProviderCard({
  provider,
  onEdit,
}: {
  provider: LlmProvider
  onEdit: () => void
}) {
  return (
    <div className="group rounded-lg border border-border bg-surface p-4">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <div className="grid size-8 place-items-center rounded-md bg-accent text-accent-foreground">
            <Cpu className="size-4" />
          </div>
          <div>
            <div className="font-medium">{provider.name}</div>
            <div className="text-xs text-muted-foreground">{provider.type}</div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <StatusPill enabled={provider.isEnabled} />
          <Button
            variant="ghost"
            size="icon"
            className="size-7 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
            onClick={onEdit}
            aria-label={`Edit ${provider.name}`}
          >
            <Pencil className="size-3.5" />
          </Button>
        </div>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Priority</dt>
          <dd className="font-data tabular-nums">{provider.priority}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Budget (MTD)</dt>
          <dd className="font-data tabular-nums">
            {provider.monthlyBudgetUsd != null
              ? `$${provider.monthlyBudgetUsd.toLocaleString()}`
              : '—'}
          </dd>
        </div>
      </dl>
    </div>
  )
}

function StatusPill({ enabled }: { enabled: boolean }) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-xs font-medium ${
        enabled
          ? 'bg-success-soft text-success'
          : 'bg-muted text-muted-foreground'
      }`}
    >
      {enabled ? 'Enabled' : 'Disabled'}
    </span>
  )
}

function CardSkeleton({ count }: { count: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="h-28 animate-pulse rounded-lg border border-border bg-muted"
        />
      ))}
    </div>
  )
}

function ErrorRow({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4 text-sm">
      <p className="text-destructive">Couldn’t load providers.</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-2 text-primary hover:underline"
      >
        Retry
      </button>
    </div>
  )
}

function EmptyRow({ text }: { text: string }) {
  return (
    <p className="rounded-lg border border-border bg-surface px-4 py-6 text-sm text-muted-foreground">
      {text}
    </p>
  )
}
