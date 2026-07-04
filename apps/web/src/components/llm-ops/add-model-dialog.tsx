import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MessageSquare, Mic } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { notify } from '@/lib/toast'
import { cn } from '@/lib/utils'
import {
  createModel,
  listProviders,
  listMasterModels,
  llmKeys,
  type MasterModel,
  type ModelKind,
} from '@/services/llm'

interface AddModelDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Master-driven add-model flow: pick a configured provider, choose Chat or
 * Voice, then pick from that provider's master catalog. Metadata (pricing,
 * context, languages) is shown per row and copied server-side from the master.
 */
export function AddModelDialog({ open, onOpenChange }: AddModelDialogProps) {
  const queryClient = useQueryClient()
  const [providerId, setProviderId] = useState('')
  const [kind, setKind] = useState<ModelKind>('chat')
  const [masterModelId, setMasterModelId] = useState<number | null>(null)
  const [makePrimary, setMakePrimary] = useState(false)

  // Reset selection on the closed→open transition.
  const [wasOpen, setWasOpen] = useState(false)
  if (open && !wasOpen) {
    setWasOpen(true)
    setProviderId('')
    setKind('chat')
    setMasterModelId(null)
    setMakePrimary(false)
  } else if (!open && wasOpen) {
    setWasOpen(false)
  }

  const providers = useQuery({
    queryKey: llmKeys.providers(),
    queryFn: listProviders,
    enabled: open,
  })
  // Only master-linked providers can pick from a catalog.
  const configurable = (providers.data ?? []).filter(
    (p) => p.masterProviderId != null,
  )

  const masterModels = useQuery({
    queryKey: llmKeys.masterModels(Number(providerId), kind),
    queryFn: () => listMasterModels(Number(providerId), kind),
    enabled: open && providerId !== '',
  })

  const mutation = useMutation({
    mutationFn: () =>
      createModel({
        providerId: Number(providerId),
        masterModelId: masterModelId!,
        isDefault: makePrimary,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: llmKeys.models() })
      notify.success('Model added')
      onOpenChange(false)
    },
    onError: (err) => notify.error(err),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-lg"
        onInteractOutside={(e) => {
          // The Select listbox is portaled to <body>, outside the Dialog DOM, so
          // a click on it reads as an outside-click and would close the Dialog.
          const target = (e.detail.originalEvent.target ?? e.target) as Element | null
          if (target?.closest('[data-slot="select-content"]')) e.preventDefault()
        }}
      >
        <DialogHeader>
          <DialogTitle>Add model</DialogTitle>
          <DialogDescription>
            Pick a configured provider, then choose a chat or voice model from
            its catalog.
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto">
          <label className="block text-sm">
            <span className="mb-2 block font-medium">Provider</span>
            <Select
              value={providerId}
              onValueChange={(v) => {
                setProviderId(v)
                setMasterModelId(null)
              }}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={providers.isPending ? 'Loading…' : 'Select a provider'}
                />
              </SelectTrigger>
              <SelectContent>
                {configurable.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {providers.data && configurable.length === 0 && (
              <span className="mt-1.5 block text-xs text-muted-foreground">
                No catalog-linked providers yet — add one in the Providers tab first.
              </span>
            )}
          </label>

          <Tabs
            value={kind}
            onValueChange={(v) => {
              setKind(v as ModelKind)
              setMasterModelId(null)
            }}
          >
            <TabsList className="w-full">
              <TabsTrigger value="chat" className="flex-1">
                <MessageSquare />
                Chat
              </TabsTrigger>
              <TabsTrigger value="voice" className="flex-1">
                <Mic />
                Voice
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {providerId === '' ? (
            <p className="rounded-lg border border-border bg-muted/40 px-3 py-4 text-center text-sm text-muted-foreground">
              Select a provider to see its {kind} models.
            </p>
          ) : masterModels.isPending ? (
            <div className="h-24 animate-pulse rounded-lg border border-border bg-muted" />
          ) : (masterModels.data ?? []).length === 0 ? (
            <p className="rounded-lg border border-border bg-muted/40 px-3 py-4 text-center text-sm text-muted-foreground">
              This provider has no {kind} models in the catalog.
            </p>
          ) : (
            <div className="grid gap-2">
              {(masterModels.data ?? []).map((m) => (
                <MasterModelRow
                  key={m.id}
                  model={m}
                  selected={masterModelId === m.id}
                  onSelect={() => setMasterModelId(m.id)}
                />
              ))}
            </div>
          )}

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={makePrimary}
              onChange={(e) => setMakePrimary(e.target.checked)}
              className="size-4 rounded border-input accent-primary"
            />
            Make this the primary {kind} model
          </label>
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || masterModelId === null}
          >
            {mutation.isPending ? 'Adding…' : 'Add model'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function MasterModelRow({
  model,
  selected,
  onSelect,
}: {
  model: MasterModel
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'rounded-lg border px-3 py-2.5 text-left text-sm transition-colors',
        selected
          ? 'border-primary bg-primary/5 ring-1 ring-primary'
          : 'border-border bg-surface hover:bg-muted/50',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{model.name}</span>
        <span className="font-data text-xs text-muted-foreground">{model.key}</span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
        {model.kind === 'chat' ? (
          <>
            {model.inputPricePerMillion != null && (
              <span className="font-data tabular-nums">
                ${model.inputPricePerMillion} / ${model.outputPricePerMillion ?? '—'} per 1M
              </span>
            )}
            {model.contextWindowTokens != null && (
              <span>{Math.round(model.contextWindowTokens / 1000)}k ctx</span>
            )}
          </>
        ) : (
          <>
            {model.voicePipeline && (
              <span className="rounded border border-border bg-muted px-1 py-px">
                {model.voicePipeline}
              </span>
            )}
            {model.languages.length > 0 && <span>{model.languages.join(', ')}</span>}
          </>
        )}
      </div>
    </button>
  )
}
