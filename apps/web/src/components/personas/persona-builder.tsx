import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Plus, Trash2, Rocket, UserSquare2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { notify } from '@/lib/toast'
import { useAuthStore } from '@/stores/auth'
import { listModels, llmKeys } from '@/services/llm'
import { startSession } from '@/services/roleplay'
import {
  createPersona,
  updatePersona,
  personaKeys,
  type Persona,
  type PersonaInput,
  type ScoreCriterionInput,
} from '@/services/personas'

/** Tone presets fold into `customInstructions` — they are NOT the deferred
 *  TTS `voiceStyleId`. Selecting one appends a tone hint to the prompt. */
const TONES = [
  { key: 'professional', label: 'Professional', desc: 'Formal, objective, and precise.' },
  { key: 'friendly', label: 'Friendly', desc: 'Empathetic, casual, and encouraging.' },
  { key: 'assertive', label: 'Assertive', desc: 'Direct, challenging, and concise.' },
] as const

const TONE_HINT: Record<string, string> = {
  professional: 'Maintain a professional tone: formal, objective, and precise.',
  friendly: 'Maintain a friendly tone: empathetic, casual, and encouraging.',
  assertive: 'Maintain an assertive tone: direct, challenging, and concise.',
}

interface CriterionRow extends ScoreCriterionInput {
  key: string
}

function emptyRow(order: number): CriterionRow {
  return { key: `c${order}-${Math.round(order * 1e6)}`, name: '', maxScore: 10, weight: 1, order }
}

function toRows(persona?: Persona): CriterionRow[] {
  if (!persona?.scoreCriteria?.length) return [emptyRow(0)]
  return persona.scoreCriteria.map((c, i) => ({
    key: `c${c.id}`,
    name: c.name,
    description: c.description ?? undefined,
    maxScore: c.maxScore,
    weight: c.weight,
    order: i,
  }))
}

export function PersonaBuilder({ persona }: { persona?: Persona }) {
  const isEdit = persona != null
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const isAdmin = useAuthStore((s) => s.user?.role === 'SUPER_ADMIN')

  const [name, setName] = useState(persona?.name ?? '')
  const [description, setDescription] = useState(persona?.description ?? '')
  const [systemPrompt, setSystemPrompt] = useState(persona?.systemPrompt ?? '')
  const [tone, setTone] = useState<string>('professional')
  const [conversationModelId, setConversationModelId] = useState<string>(
    persona?.conversationModelId != null ? String(persona.conversationModelId) : '',
  )
  const [scoringModelId, setScoringModelId] = useState<string>(
    persona?.scoringModelId != null ? String(persona.scoringModelId) : '',
  )
  const [criteria, setCriteria] = useState<CriterionRow[]>(() => toRows(persona))

  // Model pickers are Super-Admin only (GET /llm/models is llmops:read).
  const models = useQuery({
    queryKey: llmKeys.models(),
    queryFn: listModels,
    enabled: isAdmin,
  })

  function buildInput(): PersonaInput {
    return {
      name,
      description,
      systemPrompt,
      customInstructions: TONE_HINT[tone],
      conversationModelId: conversationModelId ? Number(conversationModelId) : null,
      scoringModelId: scoringModelId ? Number(scoringModelId) : null,
      scoreCriteria: criteria,
    }
  }

  const save = useMutation({
    mutationFn: (input: PersonaInput) =>
      isEdit ? updatePersona(persona.id, input) : createPersona(input),
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: personaKeys.mine() })
      queryClient.invalidateQueries({ queryKey: personaKeys.detail(saved.id) })
      notify.success(isEdit ? 'Persona updated' : 'Persona created')
      navigate({ to: '/personas' })
    },
    onError: () => notify.error('Could not save persona'),
  })

  // Launch = save, then open a roleplay session against the saved persona.
  const launch = useMutation({
    mutationFn: async (input: PersonaInput) => {
      const saved = isEdit ? await updatePersona(persona.id, input) : await createPersona(input)
      const session = await startSession(saved.id)
      return session
    },
    onSuccess: (session) => {
      queryClient.invalidateQueries({ queryKey: personaKeys.mine() })
      navigate({ to: '/practice/$uid', params: { uid: session.uid } })
    },
    onError: () => notify.error('Could not launch session'),
  })

  const busy = save.isPending || launch.isPending
  const canSave = name.trim().length > 0 && systemPrompt.trim().length > 0

  function setRow(key: string, patch: Partial<CriterionRow>) {
    setCriteria((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  }

  return (
    <form
      className="mx-auto flex max-w-6xl flex-col gap-6 lg:flex-row"
      onSubmit={(e) => {
        e.preventDefault()
        if (canSave) save.mutate(buildInput())
      }}
    >
      {/* ── Main column ───────────────────────────────────────────── */}
      <div className="flex-1 space-y-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">
            {isEdit ? 'Edit persona' : 'Persona builder'}
          </h1>
          <p className="text-sm text-muted-foreground">
            Define the character your trainees roleplay against.
          </p>
        </header>

        <Section title="Identity definition" icon={<UserSquare2 className="size-4" />}>
          <Field label="Persona name">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="e.g., Senior Security Architect"
            />
          </Field>
          <Field label="Short description" hint="A one-line summary of their role.">
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief summary of their role…"
            />
          </Field>
        </Section>

        <Section title="Voice style" hint="Tone hint added to the prompt.">
          <div className="grid gap-3 sm:grid-cols-3">
            {TONES.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTone(t.key)}
                aria-pressed={tone === t.key}
                className={`rounded-lg border p-3 text-left transition-colors ${
                  tone === t.key
                    ? 'border-primary bg-primary/10'
                    : 'border-border bg-surface hover:bg-muted'
                }`}
              >
                <div className="text-sm font-medium">{t.label}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">{t.desc}</div>
              </button>
            ))}
          </div>
        </Section>

        <Section title="System instructions">
          <Textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            required
            rows={10}
            className="font-data"
            placeholder={'You are a Senior Security Architect…\n\nRules:\n1. …\n\nEnd with [CONVERSATION_ENDED] when the scenario resolves.'}
          />
        </Section>

        <Section
          title="Evaluation criteria"
          action={
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setCriteria((prev) => [...prev, emptyRow(prev.length)])}
            >
              <Plus />
              Add criterion
            </Button>
          }
        >
          <div className="space-y-2">
            {criteria.map((row) => (
              <div key={row.key} className="flex items-start gap-2">
                <Input
                  value={row.name}
                  onChange={(e) => setRow(row.key, { name: e.target.value })}
                  placeholder="Criterion (e.g., Objection handling)"
                  className="flex-1"
                />
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={row.maxScore}
                  onChange={(e) => setRow(row.key, { maxScore: Number(e.target.value) || 1 })}
                  className="w-20"
                  aria-label="Max score"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Remove criterion"
                  onClick={() => setCriteria((prev) => prev.filter((r) => r.key !== row.key))}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </div>
        </Section>
      </div>

      {/* ── Configuration panel ───────────────────────────────────── */}
      <aside className="w-full shrink-0 space-y-6 lg:w-80">
        <div className="sticky top-2 space-y-6">
          {isAdmin && (
            <Section title="Model registry">
              <Field label="Conversation engine" hint="Defaults to the registry default if unset.">
                <ModelSelect
                  value={conversationModelId}
                  onChange={setConversationModelId}
                  options={models.data}
                  loading={models.isPending}
                />
              </Field>
              <Field label="Evaluation / scoring">
                <ModelSelect
                  value={scoringModelId}
                  onChange={setScoringModelId}
                  options={models.data}
                  loading={models.isPending}
                />
              </Field>
            </Section>
          )}

          <Section title="Parameters" hint="Not yet applied — coming soon.">
            <div className="space-y-3 opacity-50">
              <Field label="Temperature">
                <Input type="range" min={0} max={2} step={0.1} defaultValue={0.7} disabled />
              </Field>
              <Field label="Max tokens">
                <Input type="number" defaultValue={2048} disabled />
              </Field>
            </div>
          </Section>

          <div className="space-y-2">
            <Button type="submit" size="lg" className="w-full" disabled={!canSave || busy}>
              {save.isPending ? 'Saving…' : isEdit ? 'Save changes' : 'Create persona'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="lg"
              className="w-full"
              disabled={!canSave || busy}
              onClick={() => launch.mutate(buildInput())}
            >
              <Rocket />
              {launch.isPending ? 'Launching…' : 'Save & test'}
            </Button>
          </div>
        </div>
      </aside>
    </form>
  )
}

function ModelSelect({
  value,
  onChange,
  options,
  loading,
}: {
  value: string
  onChange: (v: string) => void
  options: { id: number; name: string }[] | undefined
  loading: boolean
}) {
  return (
    <Select value={value || 'default'} onValueChange={(v) => onChange(v === 'default' ? '' : v)}>
      <SelectTrigger>
        <SelectValue placeholder={loading ? 'Loading…' : 'Registry default'} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="default">Registry default</SelectItem>
        {options?.map((m) => (
          <SelectItem key={m.id} value={String(m.id)}>
            {m.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

interface SectionProps {
  title: string
  hint?: string
  icon?: React.ReactNode
  action?: React.ReactNode
  children: React.ReactNode
}

function Section({ title, hint, icon, action, children }: SectionProps) {
  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {icon}
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {title}
          </h2>
        </div>
        {action}
      </div>
      {hint && <p className="mb-3 -mt-2 text-xs text-muted-foreground">{hint}</p>}
      <div className="space-y-4">{children}</div>
    </section>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="block space-y-1.5 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
    </label>
  )
}
