import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
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
import { PasswordInput } from '@/components/ui/password-input'
import { NumberField } from '@/components/ui/number-field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { notify } from '@/lib/toast'
import {
  createProvider,
  updateProvider,
  llmKeys,
  type LlmProvider,
  type ProviderInput,
} from '@/services/llm'

const PROVIDER_TYPES = ['openai', 'gemini', 'azure', 'anthropic', 'custom'] as const

interface ProviderFormSheetProps {
  open: boolean
  /** `null` opens the sheet in create mode; a provider opens it in edit mode. */
  provider: LlmProvider | null
  onOpenChange: (open: boolean) => void
}

interface FormState {
  name: string
  type: string
  baseUrl: string
  apiKey: string
  isEnabled: boolean
  priority: string
  monthlyBudgetUsd: string
}

function initialState(provider: LlmProvider | null): FormState {
  return {
    name: provider?.name ?? '',
    type: provider?.type ?? 'openai',
    baseUrl: provider?.baseUrl ?? '',
    apiKey: '', // write-only — never prefilled, even on edit
    isEnabled: provider?.isEnabled ?? true,
    priority: String(provider?.priority ?? 0),
    monthlyBudgetUsd:
      provider?.monthlyBudgetUsd != null ? String(provider.monthlyBudgetUsd) : '',
  }
}

export function ProviderFormSheet({
  open,
  provider,
  onOpenChange,
}: ProviderFormSheetProps) {
  const isEdit = provider != null
  const queryClient = useQueryClient()
  const [form, setForm] = useState<FormState>(() => initialState(provider))

  // Re-seed fields on the closed→open transition (create vs. a specific
  // provider). Render-phase reset avoids an effect + cascading render.
  const [wasOpen, setWasOpen] = useState(false)
  if (open && !wasOpen) {
    setWasOpen(true)
    setForm(initialState(provider))
  } else if (!open && wasOpen) {
    setWasOpen(false)
  }

  const mutation = useMutation({
    mutationFn: (input: ProviderInput) =>
      isEdit ? updateProvider(provider.id, input) : createProvider(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: llmKeys.providers() })
      queryClient.invalidateQueries({ queryKey: llmKeys.models() })
      notify.success(isEdit ? 'Provider updated' : 'Provider added')
      onOpenChange(false)
    },
  })

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    mutation.mutate({
      name: form.name,
      type: form.type,
      baseUrl: form.baseUrl,
      apiKey: form.apiKey,
      isEnabled: form.isEnabled,
      priority: Number(form.priority) || 0,
      monthlyBudgetUsd: form.monthlyBudgetUsd ? Number(form.monthlyBudgetUsd) : null,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        onInteractOutside={(e) => {
          // The Select listbox is portaled to <body>, outside the Dialog DOM, so
          // a click on it reads as an outside-click and would close the Dialog.
          const target = (e.detail.originalEvent.target ?? e.target) as Element | null
          if (target?.closest('[data-slot="select-content"]')) e.preventDefault()
        }}
      >
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit provider' : 'Add provider'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Update routing and credentials for this provider.'
              : 'Register an LLM provider. The API key is encrypted and never shown again.'}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={handleSubmit}
          className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto"
        >
          <Field label="Name">
            <Input
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              required
              placeholder="OpenAI Production"
            />
          </Field>

          <Field label="Type">
            <Select value={form.type} onValueChange={(v) => set('type', v)}>
              <SelectTrigger>
                <SelectValue placeholder="Select a type" />
              </SelectTrigger>
              <SelectContent>
                {PROVIDER_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field
            label="Base URL"
            hint="Optional — override the default API endpoint."
          >
            <Input
              value={form.baseUrl}
              onChange={(e) => set('baseUrl', e.target.value)}
              type="url"
              placeholder="https://api.openai.com/v1"
            />
          </Field>

          <Field
            label="API key"
            hint={
              isEdit
                ? 'Leave blank to keep the current key.'
                : 'Stored encrypted; shown only once.'
            }
          >
            <PasswordInput
              value={form.apiKey}
              onChange={(e) => set('apiKey', e.target.value)}
              autoComplete="off"
              placeholder={isEdit ? '••••••••' : 'sk-…'}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Priority">
              <NumberField
                value={form.priority}
                onChange={(v) => set('priority', v)}
                min={0}
                aria-label="Priority"
              />
            </Field>
            <Field label="Monthly budget ($)" hint="Optional">
              <NumberField
                value={form.monthlyBudgetUsd}
                onChange={(v) => set('monthlyBudgetUsd', v)}
                min={0}
                step={50}
                placeholder="—"
                aria-label="Monthly budget in USD"
              />
            </Field>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.isEnabled}
              onChange={(e) => set('isEnabled', e.target.checked)}
              className="size-4 rounded border-input accent-primary"
            />
            Enabled
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
                  : 'Add provider'}
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
    <label className="block space-y-1.5 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
    </label>
  )
}
