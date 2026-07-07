import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Star, MessageSquare, Mic, Trash2 } from 'lucide-react'
import { listModels, promoteModel, deleteModel, llmKeys, type LlmModel } from '@/services/llm'
import { notify } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import { ErrorState } from '@/components/ui/error-state'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { SettingsSection } from '@/components/settings/settings-section'
import { AddModelDialog } from '@/components/llm-ops/add-model-dialog'

export function ModelsSection() {
  const queryClient = useQueryClient()
  const models = useQuery({ queryKey: llmKeys.models(), queryFn: () => listModels() })
  const [adding, setAdding] = useState(false)
  const [deleting, setDeleting] = useState<LlmModel | null>(null)

  const promote = useMutation({
    mutationFn: (id: number) => promoteModel(id),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: llmKeys.models() })
      notify.success(`Primary ${r.kind} model updated`)
    },
    onError: (err) => notify.error(err),
  })

  const remove = useMutation({
    mutationFn: (id: number) => deleteModel(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: llmKeys.models() })
      notify.success('Model removed')
      setDeleting(null)
    },
    onError: (err) => notify.error(err),
  })

  return (
    <SettingsSection
      id="models"
      title="Models"
      description="Registered models. One primary chat model + one primary voice model (may be different providers)."
      action={
        <Button size="sm" onClick={() => setAdding(true)}>
          <Plus />
          Add model
        </Button>
      }
    >
      <AddModelDialog open={adding} onOpenChange={setAdding} />

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <Th>Model</Th>
              <Th>Kind</Th>
              <Th>Provider</Th>
              <Th className="text-right">In / Out ($/1M)</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {models.isPending && (
              <tr>
                <td colSpan={5} className="px-6 py-6">
                  <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
                </td>
              </tr>
            )}
            {models.isError && (
              <tr>
                <td colSpan={5} className="px-6 py-6">
                  <ErrorState title="Couldn’t load models" onRetry={() => models.refetch()} />
                </td>
              </tr>
            )}
            {models.data?.map((m) => (
              <ModelRow
                key={m.id}
                model={m}
                onPromote={() => promote.mutate(m.id)}
                promoting={promote.isPending && promote.variables === m.id}
                onDelete={() => setDeleting(m)}
              />
            ))}
            {models.data && models.data.length === 0 && (
              <tr>
                <td colSpan={5} className="px-6 py-6 text-sm text-muted-foreground">
                  No models registered yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={deleting !== null} onOpenChange={(v) => { if (!v) setDeleting(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Remove model?</DialogTitle>
            <DialogDescription>
              <span className="font-data">{deleting?.name}</span> will be removed.
              Personas pinned to it fall back to the primary {deleting?.kind} model.
              {deleting?.isDefault && ' This is the current primary — a replacement will be promoted automatically.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleting && remove.mutate(deleting.id)}
              disabled={remove.isPending}
            >
              {remove.isPending ? 'Removing…' : 'Remove'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsSection>
  )
}

interface ModelRowProps {
  model: LlmModel
  onPromote: () => void
  promoting: boolean
  onDelete: () => void
}

function ModelRow({ model, onPromote, promoting, onDelete }: ModelRowProps) {
  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-6 py-3">
        <span className="font-data">{model.name}</span>
        {model.isDefault && (
          <span className="ml-2 rounded bg-success-soft px-1.5 py-0.5 text-xs font-medium text-success">
            primary {model.kind}
          </span>
        )}
        {model.contextWindowTokens != null && (
          <span className="ml-2 text-xs text-muted-foreground">
            {(model.contextWindowTokens / 1000).toFixed(0)}k ctx
          </span>
        )}
        {model.kind === 'voice' && model.masterModel?.voicePipeline && (
          <span className="ml-2 text-xs text-muted-foreground">
            {model.masterModel.voicePipeline}
          </span>
        )}
      </td>
      <td className="px-6 py-3">
        <KindBadge kind={model.kind} />
      </td>
      <td className="px-6 py-3 text-muted-foreground">
        {model.provider?.name ?? `#${model.providerId}`}
      </td>
      <td className="px-6 py-3 text-right font-data tabular-nums text-muted-foreground">
        {fmtPrice(model.inputPricePerMillion)} / {fmtPrice(model.outputPricePerMillion)}
      </td>
      <td className="px-6 py-3">
        <div className="flex items-center justify-end gap-1">
          {!model.isDefault && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs"
              onClick={onPromote}
              disabled={promoting}
            >
              <Star className="size-3.5" />
              {promoting ? 'Setting…' : 'Set primary'}
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:text-destructive"
            onClick={onDelete}
            aria-label={`Remove ${model.name}`}
            title="Remove model"
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </td>
    </tr>
  )
}

function KindBadge({ kind }: { kind: string }) {
  const voice = kind === 'voice'
  const Icon = voice ? Mic : MessageSquare
  return (
    <span className="inline-flex items-center gap-1 rounded border border-border bg-muted px-1.5 py-0.5 text-xs">
      <Icon className="size-3" />
      {kind}
    </span>
  )
}

function fmtPrice(v?: number | null): string {
  return v != null ? `$${v}` : '—'
}

function Th({
  children,
  className = '',
}: {
  children: React.ReactNode
  className?: string
}) {
  return <th className={`px-6 py-2.5 font-medium ${className}`}>{children}</th>
}
