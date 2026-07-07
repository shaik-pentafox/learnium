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
  listMasterProviders,
  llmKeys,
  type LlmProvider,
} from '@/services/llm'

interface ProviderFormSheetProps {
  open: boolean
  /** `null` opens the sheet in create mode; a provider opens it in edit mode. */
  provider: LlmProvider | null
  onOpenChange: (open: boolean) => void
}

// The provider Select uses this sentinel to open the custom (no-master) path.
const CUSTOM = 'custom'

const ADAPTER_OPTIONS = [
  { value: 'openai', label: 'OpenAI-compatible (vLLM, Ollama, LiteLLM, …)' },
  { value: 'gemini', label: 'Google Gemini' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'custom', label: 'Custom (OpenAI-compatible)' },
] as const

interface FormState {
  /** A master id (as string), or the CUSTOM sentinel for a custom provider. */
  masterProviderId: string
  adapterType: string
  name: string
  baseUrl: string
  apiKey: string
  isEnabled: boolean
  monthlyBudgetUsd: string
}

function initialState(provider: LlmProvider | null): FormState {
  return {
    masterProviderId: provider?.masterProviderId != null ? String(provider.masterProviderId) : '',
    adapterType: '',
    name: provider?.name ?? '',
    baseUrl: provider?.baseUrl ?? '',
    apiKey: '', // write-only — never prefilled, even on edit
    isEnabled: provider?.isEnabled ?? true,
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

  const masters = useQuery({
    queryKey: llmKeys.masterProviders(),
    queryFn: listMasterProviders,
    enabled: open && !isEdit,
  })

  // Re-seed fields on the closed→open transition (create vs. a specific
  // provider). Render-phase reset avoids an effect + cascading render.
  const [wasOpen, setWasOpen] = useState(false)
  if (open && !wasOpen) {
    setWasOpen(true)
    setForm(initialState(provider))
  } else if (!open && wasOpen) {
    setWasOpen(false)
  }

  const isCustom = !isEdit && form.masterProviderId === CUSTOM

  const mutation = useMutation({
    mutationFn: () => {
      const budget = form.monthlyBudgetUsd ? Number(form.monthlyBudgetUsd) : null
      if (isEdit) {
        return updateProvider(provider.id, {
          name: form.name,
          baseUrl: form.baseUrl,
          apiKey: form.apiKey,
          isEnabled: form.isEnabled,
          monthlyBudgetUsd: budget,
        })
      }
      return createProvider({
        ...(isCustom
          ? { adapterType: form.adapterType as 'openai' | 'gemini' | 'anthropic' | 'custom' }
          : { masterProviderId: Number(form.masterProviderId) }),
        apiKey: form.apiKey,
        name: form.name,
        baseUrl: form.baseUrl,
        isEnabled: form.isEnabled,
        monthlyBudgetUsd: budget,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: llmKeys.providers() })
      queryClient.invalidateQueries({ queryKey: llmKeys.models() })
      queryClient.invalidateQueries({ queryKey: llmKeys.masterProviders() })
      notify.success(isEdit ? 'Provider updated' : 'Provider added')
      onOpenChange(false)
    },
    onError: (err) => notify.error(err),
  })

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const selectedMaster = masters.data?.find(
    (m) => String(m.id) === form.masterProviderId,
  )

  const createBlocked =
    !isEdit &&
    (!form.masterProviderId || (isCustom && (!form.adapterType || !form.name.trim())))

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (createBlocked) return
    mutation.mutate()
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
              ? 'Rename, rotate the API key, or adjust the budget.'
              : 'Pick a provider from the catalog and add your API key. The key is encrypted and never shown again.'}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={handleSubmit}
          className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto"
        >
          {!isEdit && (
            <Field label="Provider">
              <Select
                value={form.masterProviderId}
                onValueChange={(v) => set('masterProviderId', v)}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={masters.isPending ? 'Loading…' : 'Select a provider'}
                  />
                </SelectTrigger>
                <SelectContent>
                  {(masters.data ?? []).map((m) => (
                    <SelectItem key={m.id} value={String(m.id)}>
                      <span>{m.name}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {m.supports.join(' + ')}
                        {m.configuredProviderIds.length > 0 && ' · configured'}
                      </span>
                    </SelectItem>
                  ))}
                  <SelectItem value={CUSTOM}>
                    <span>Custom provider…</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      not in the catalog
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </Field>
          )}

          {isCustom && (
            <Field label="Adapter" hint="How the runtime talks to this provider's API.">
              <Select
                value={form.adapterType}
                onValueChange={(v) => set('adapterType', v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select an adapter" />
                </SelectTrigger>
                <SelectContent>
                  {ADAPTER_OPTIONS.map((a) => (
                    <SelectItem key={a.value} value={a.value}>
                      {a.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}

          <Field
            label="Display name"
            hint={
              isEdit || isCustom
                ? undefined
                : 'Optional — defaults to the catalog name.'
            }
          >
            <Input
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder={selectedMaster?.name ?? 'OpenAI'}
              required={isEdit || isCustom}
            />
          </Field>

          <Field
            label="API key"
            hint={
              isEdit
                ? `Leave blank to keep the current key${provider.credentialHint ? ` (${provider.credentialHint})` : ''}.`
                : 'Stored encrypted; shown only once.'
            }
          >
            <PasswordInput
              value={form.apiKey}
              onChange={(e) => set('apiKey', e.target.value)}
              autoComplete="off"
              placeholder={isEdit ? (provider.credentialHint ?? '••••••••') : 'sk-…'}
              required={!isEdit}
            />
          </Field>

          <Field
            label="Base URL"
            hint="Optional — override the default API endpoint."
          >
            <Input
              value={form.baseUrl}
              onChange={(e) => set('baseUrl', e.target.value)}
              type="url"
              placeholder={selectedMaster?.defaultBaseUrl ?? 'https://…'}
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
            <Button type="submit" disabled={mutation.isPending || createBlocked}>
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
    <label className="block text-sm">
      <span className="mb-2 block font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-muted-foreground">{hint}</span>}
    </label>
  )
}
