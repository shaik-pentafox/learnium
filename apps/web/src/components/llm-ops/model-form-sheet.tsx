import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NumberField } from '@/components/ui/number-field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { notify } from '@/lib/toast'
import {
  createModel,
  updateModel,
  listProviders,
  llmKeys,
  type LlmModel,
  type ModelInput,
} from '@/services/llm'

// Capabilities Traineon resolves models by: roleplay `conversation` + `scoring`
// (the two logical persona roles), plus `voice` (audio agent) and generic
// `vision` / `tools` for future use.
const CAPABILITIES = ['conversation', 'scoring', 'voice', 'vision', 'tools'] as const

interface ModelFormSheetProps {
  open: boolean
  /** `null` opens create mode; a model opens edit mode. */
  model: LlmModel | null
  onOpenChange: (open: boolean) => void
}

interface FormState {
  name: string
  providerId: string
  capabilities: string[]
  contextWindowTokens: string
  inputPricePerMillion: string
  outputPricePerMillion: string
  isDefault: boolean
}

function initialState(model: LlmModel | null): FormState {
  return {
    name: model?.name ?? '',
    providerId: model?.providerId != null ? String(model.providerId) : '',
    capabilities: model?.capabilities ?? [],
    contextWindowTokens:
      model?.contextWindowTokens != null ? String(model.contextWindowTokens) : '',
    inputPricePerMillion:
      model?.inputPricePerMillion != null ? String(model.inputPricePerMillion) : '',
    outputPricePerMillion:
      model?.outputPricePerMillion != null ? String(model.outputPricePerMillion) : '',
    isDefault: model?.isDefault ?? false,
  }
}

export function ModelFormSheet({ open, model, onOpenChange }: ModelFormSheetProps) {
  const isEdit = model != null
  const queryClient = useQueryClient()
  const providers = useQuery({
    queryKey: llmKeys.providers(),
    queryFn: listProviders,
    enabled: open,
  })

  const [form, setForm] = useState<FormState>(() => initialState(model))
  const [wasOpen, setWasOpen] = useState(false)
  if (open && !wasOpen) {
    setWasOpen(true)
    setForm(initialState(model))
  } else if (!open && wasOpen) {
    setWasOpen(false)
  }

  const mutation = useMutation({
    mutationFn: (input: ModelInput) =>
      isEdit ? updateModel(model.id, input) : createModel(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: llmKeys.models() })
      notify.success(isEdit ? 'Model updated' : 'Model added')
      onOpenChange(false)
    },
  })

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function toggleCapability(cap: string) {
    setForm((prev) => ({
      ...prev,
      capabilities: prev.capabilities.includes(cap)
        ? prev.capabilities.filter((c) => c !== cap)
        : [...prev.capabilities, cap],
    }))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.providerId) {
      notify.message('Pick a provider first')
      return
    }
    mutation.mutate({
      name: form.name,
      providerId: Number(form.providerId),
      capabilities: form.capabilities,
      contextWindowTokens: form.contextWindowTokens
        ? Number(form.contextWindowTokens)
        : null,
      inputPricePerMillion: form.inputPricePerMillion
        ? Number(form.inputPricePerMillion)
        : null,
      outputPricePerMillion: form.outputPricePerMillion
        ? Number(form.outputPricePerMillion)
        : null,
      isDefault: form.isDefault,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        onInteractOutside={(e) => {
          const target = (e.detail.originalEvent.target ?? e.target) as Element | null
          if (target?.closest('[data-slot="select-content"]')) e.preventDefault()
        }}
      >
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit model' : 'Add model'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Update this model in the registry.'
              : 'Register a model in the master registry. Personas reference models by capability.'}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={handleSubmit}
          className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto"
        >
          <Field label="Model name">
            <Input
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              required
              placeholder="gpt-4o"
            />
          </Field>

          <Field label="Provider">
            <Select
              value={form.providerId}
              onValueChange={(v) => set('providerId', v)}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={
                    providers.isPending ? 'Loading providers…' : 'Select a provider'
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {providers.data?.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Capabilities">
            <div className="flex flex-wrap gap-2">
              {CAPABILITIES.map((cap) => {
                const active = form.capabilities.includes(cap)
                return (
                  <button
                    key={cap}
                    type="button"
                    onClick={() => toggleCapability(cap)}
                    className={cn(
                      'rounded-md border px-2 py-1 text-xs font-medium transition-colors',
                      active
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border bg-muted text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {cap}
                  </button>
                )
              })}
            </div>
          </Field>

          <Field label="Context window (tokens)" hint="Optional">
            <NumberField
              value={form.contextWindowTokens}
              onChange={(v) => set('contextWindowTokens', v)}
              min={0}
              step={1000}
              placeholder="128000"
              aria-label="Context window in tokens"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Input $/1M" hint="Optional">
              <NumberField
                value={form.inputPricePerMillion}
                onChange={(v) => set('inputPricePerMillion', v)}
                min={0}
                step={0.05}
                placeholder="—"
                aria-label="Input price per million tokens"
              />
            </Field>
            <Field label="Output $/1M" hint="Optional">
              <NumberField
                value={form.outputPricePerMillion}
                onChange={(v) => set('outputPricePerMillion', v)}
                min={0}
                step={0.05}
                placeholder="—"
                aria-label="Output price per million tokens"
              />
            </Field>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.isDefault}
              onChange={(e) => set('isDefault', e.target.checked)}
              className="size-4 rounded border-input accent-primary"
            />
            Set as the default model
          </label>

          <DialogFooter className="mt-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending
                ? 'Saving…'
                : isEdit
                  ? 'Save changes'
                  : 'Add model'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

interface FieldProps {
  label: string
  hint?: string
  children: React.ReactNode
}

function Field({ label, hint, children }: FieldProps) {
  return (
    <label className="block text-sm">
      <span className="mb-2 block font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-muted-foreground">{hint}</span>}
    </label>
  )
}
