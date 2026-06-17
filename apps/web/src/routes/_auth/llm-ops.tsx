import { useState } from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Plus, Cpu, Pencil } from 'lucide-react'
import {
  listProviders,
  listModels,
  llmKeys,
  type LlmProvider,
  type LlmModel,
} from '@/services/llm'
import { useAuthStore } from '@/stores/auth'
import { Button } from '@/components/ui/button'
import { ProviderFormSheet } from '@/components/llm-ops/provider-form-sheet'

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
  const models = useQuery({ queryKey: llmKeys.models(), queryFn: listModels })

  // `null` while closed; `{ provider: null }` for add; `{ provider }` for edit.
  const [editing, setEditing] = useState<{ provider: LlmProvider | null } | null>(
    null,
  )

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            LLM Operations
          </h1>
          <p className="text-sm text-muted-foreground">
            Manage provider credentials, model routing, and usage limits.
          </p>
        </div>
        <Button size="sm" onClick={() => setEditing({ provider: null })}>
          <Plus />
          Add provider
        </Button>
      </header>

      <ProviderFormSheet
        open={editing != null}
        provider={editing?.provider ?? null}
        onOpenChange={(open) => {
          if (!open) setEditing(null)
        }}
      />

      {/* Provider status cards */}
      <section className="space-y-3">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Providers
        </h2>
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
      </section>

      {/* Model registry */}
      <section className="space-y-3">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Model registry
        </h2>
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <Th>Model</Th>
                <Th>Provider</Th>
                <Th>Capabilities</Th>
                <Th className="text-right">In / Out ($/1M)</Th>
                <Th className="text-right">Default</Th>
              </tr>
            </thead>
            <tbody>
              {models.isPending && (
                <tr>
                  <td colSpan={5} className="px-4 py-6">
                    <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
                  </td>
                </tr>
              )}
              {models.data?.map((m) => <ModelRow key={m.id} model={m} />)}
              {models.data && models.data.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-6 text-sm text-muted-foreground"
                  >
                    No models registered.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
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

function ModelRow({ model }: { model: LlmModel }) {
  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-4 py-3">
        <span className="font-data">{model.name}</span>
        {model.contextWindowTokens != null && (
          <span className="ml-2 text-xs text-muted-foreground">
            {(model.contextWindowTokens / 1000).toFixed(0)}k ctx
          </span>
        )}
      </td>
      <td className="px-4 py-3 text-muted-foreground">
        {model.provider?.name ?? `#${model.providerId}`}
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap gap-1">
          {model.capabilities.map((c) => (
            <span
              key={c}
              className="rounded border border-border bg-muted px-1.5 py-0.5 text-xs"
            >
              {c}
            </span>
          ))}
        </div>
      </td>
      <td className="px-4 py-3 text-right font-data tabular-nums text-muted-foreground">
        {fmtPrice(model.inputPricePerMillion)} / {fmtPrice(model.outputPricePerMillion)}
      </td>
      <td className="px-4 py-3 text-right">
        {model.isDefault ? (
          <span className="rounded bg-success-soft px-1.5 py-0.5 text-xs font-medium text-success">
            default
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
    </tr>
  )
}

function fmtPrice(v?: number | null): string {
  return v != null ? `$${v}` : '—'
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

function Th({
  children,
  className = '',
}: {
  children: React.ReactNode
  className?: string
}) {
  return <th className={`px-4 py-2.5 font-medium ${className}`}>{children}</th>
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
