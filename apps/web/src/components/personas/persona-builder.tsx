import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Plus, Trash2, Rocket, UserSquare2, MessagesSquare, Target } from 'lucide-react'
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
import { Orb } from '@/components/chat/orb'
import {
  personaOrbColors,
  isHexColor,
  DEFAULT_PERSONA_COLOR,
} from '@/lib/persona-color'
import { listModels, llmKeys } from '@/services/llm'
import { startSession } from '@/services/roleplay'
import {
  createPersona,
  updatePersona,
  publishPersona,
  unpublishPersona,
  personaKeys,
  CHANNELS,
  EMOTIONS,
  type Persona,
  type PersonaInput,
  type PersonaTemplate,
  type ScoreCriterionInput,
} from '@/services/personas'

const EMOTION_LABELS: Record<(typeof EMOTIONS)[number], string> = {
  calm: 'Calm',
  confused: 'Confused',
  frustrated: 'Frustrated',
  angry: 'Angry',
  anxious: 'Anxious',
}

const CHANNEL_LABELS: Record<(typeof CHANNELS)[number], string> = {
  chat: 'Text chat',
  audio: 'Voice call',
}

function emptyTemplate(): PersonaTemplate {
  return {
    customerName: '',
    customerProfile: '',
    company: '',
    productContext: '',
    issue: '',
    channel: 'chat',
    emotion: 'frustrated',
    intensity: 3,
    desiredOutcome: '',
    hiddenDetails: '',
    behaviorNotes: '',
    resolutionCriteria: '',
    additionalInstructions: '',
  }
}

function toTemplate(persona?: Persona): PersonaTemplate {
  if (!persona?.templateData) return emptyTemplate()
  return { ...emptyTemplate(), ...persona.templateData }
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
  const [color, setColor] = useState(persona?.color ?? DEFAULT_PERSONA_COLOR)
  const [template, setTemplate] = useState<PersonaTemplate>(() => toTemplate(persona))
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

  function setField<K extends keyof PersonaTemplate>(key: K, value: PersonaTemplate[K]) {
    setTemplate((prev) => ({ ...prev, [key]: value }))
  }

  function buildInput(): PersonaInput {
    return {
      name,
      description,
      color,
      template,
      conversationModelId: conversationModelId ? Number(conversationModelId) : null,
      scoringModelId: scoringModelId ? Number(scoringModelId) : null,
      scoreCriteria: criteria,
    }
  }

  const save = useMutation({
    mutationFn: ({ input, publish }: { input: PersonaInput; publish?: boolean }) =>
      isEdit ? updatePersona(persona.id, input) : createPersona(input, publish),
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: personaKeys.mine() })
      queryClient.invalidateQueries({ queryKey: personaKeys.detail(saved.id) })
      notify.success(isEdit ? 'Persona updated' : 'Persona created')
      navigate({ to: '/personas' })
    },
    onError: () => notify.error('Could not save persona'),
  })

  // Edit mode only: flip published visibility without re-saving content.
  const togglePublish = useMutation({
    mutationFn: () =>
      persona!.isPublished ? unpublishPersona(persona!.id) : publishPersona(persona!.id),
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: personaKeys.mine() })
      queryClient.invalidateQueries({ queryKey: personaKeys.detail(saved.id) })
      notify.success(saved.isPublished ? 'Persona published' : 'Persona unpublished')
    },
    onError: () => notify.error('Could not change publish state'),
  })

  // Launch = save, then open a roleplay session against the saved persona.
  const launch = useMutation({
    mutationFn: async (input: PersonaInput) => {
      const saved = isEdit ? await updatePersona(persona.id, input) : await createPersona(input)
      return startSession(saved.id, { simulation: true })
    },
    onSuccess: (session) => {
      queryClient.invalidateQueries({ queryKey: personaKeys.mine() })
      navigate({ to: '/session/$uid', params: { uid: session.uid } })
    },
    onError: () => notify.error('Could not launch session'),
  })

  const busy = save.isPending || launch.isPending || togglePublish.isPending
  const canSave =
    name.trim().length > 0 &&
    template.customerProfile.trim().length > 0 &&
    template.company.trim().length > 0 &&
    template.issue.trim().length > 0 &&
    template.desiredOutcome.trim().length > 0 &&
    template.resolutionCriteria.trim().length > 0

  function setRow(key: string, patch: Partial<CriterionRow>) {
    setCriteria((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  }

  return (
    <form
      className="mx-auto flex max-w-6xl flex-col gap-6 lg:flex-row"
      onSubmit={(e) => {
        e.preventDefault()
        if (canSave) save.mutate({ input: buildInput() })
      }}
    >
      {/* ── Main column ───────────────────────────────────────────── */}
      <div className="flex-1 space-y-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">
            {isEdit ? 'Edit persona' : 'Persona builder'}
          </h1>
          <p className="text-sm text-muted-foreground">
            Describe the customer your support trainees will roleplay against. The
            system prompt is generated from these fields.
          </p>
        </header>

        <Section title="Persona" icon={<UserSquare2 className="size-4" />}>
          <Field label="Persona name" hint="Internal label shown in lists.">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="e.g., Double-charged Dana"
            />
          </Field>
          <Field label="Short description" hint="One line summarising the scenario.">
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Billing dispute, frustrated premium customer…"
            />
          </Field>
          <Field label="Accent color" hint="Drives the persona's chat orb.">
            <div className="flex items-center gap-3">
              <Orb
                colors={personaOrbColors(color)}
                agentState="listening"
                className="size-12 shrink-0"
              />
              <input
                type="color"
                value={isHexColor(color) ? color : DEFAULT_PERSONA_COLOR}
                onChange={(e) => setColor(e.target.value)}
                aria-label="Pick accent color"
                className="size-9 shrink-0 cursor-pointer rounded-md border border-input bg-transparent"
              />
              <Input
                value={color}
                onChange={(e) => setColor(e.target.value)}
                placeholder={DEFAULT_PERSONA_COLOR}
                className="max-w-[140px] font-data"
              />
            </div>
          </Field>
        </Section>

        <Section title="The customer" icon={<UserSquare2 className="size-4" />}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Customer name" hint="Optional, used in character.">
              <Input
                value={template.customerName ?? ''}
                onChange={(e) => setField('customerName', e.target.value)}
                placeholder="e.g., Dana"
              />
            </Field>
            <Field label="Company they contact">
              <Input
                value={template.company}
                onChange={(e) => setField('company', e.target.value)}
                required
                placeholder="e.g., Nimbus Telecom"
              />
            </Field>
          </div>
          <Field label="Customer profile" hint="Who they are / relationship to the company.">
            <Input
              value={template.customerProfile}
              onChange={(e) => setField('customerProfile', e.target.value)}
              required
              placeholder="Premium subscriber for 3 years"
            />
          </Field>
          <Field label="Product context" hint="Optional plan / order / device details.">
            <Input
              value={template.productContext ?? ''}
              onChange={(e) => setField('productContext', e.target.value)}
              placeholder="Unlimited plan, billed monthly"
            />
          </Field>
        </Section>

        <Section title="The scenario" icon={<MessagesSquare className="size-4" />}>
          <Field label="Issue" hint="The problem that triggered the contact.">
            <Textarea
              value={template.issue}
              onChange={(e) => setField('issue', e.target.value)}
              required
              rows={2}
              placeholder="Charged twice for this month's bill."
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Channel">
              <div className="flex gap-2">
                {CHANNELS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setField('channel', c)}
                    aria-pressed={template.channel === c}
                    className={`flex-1 rounded-md border px-3 py-2 text-sm transition-colors ${
                      template.channel === c
                        ? 'border-primary bg-primary/10 font-medium'
                        : 'border-border bg-surface hover:bg-muted'
                    }`}
                  >
                    {CHANNEL_LABELS[c]}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Emotion">
              <Select
                value={template.emotion}
                onValueChange={(v) => setField('emotion', v as PersonaTemplate['emotion'])}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EMOTIONS.map((e) => (
                    <SelectItem key={e} value={e}>
                      {EMOTION_LABELS[e]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field label={`Intensity — ${template.intensity}/5`} hint="How strong the emotion is.">
            <input
              type="range"
              min={1}
              max={5}
              step={1}
              value={template.intensity}
              onChange={(e) => setField('intensity', Number(e.target.value))}
              className="w-full accent-primary"
              aria-label="Intensity"
            />
          </Field>
        </Section>

        <Section title="Goal & resolution" icon={<Target className="size-4" />}>
          <Field label="Desired outcome" hint="What resolution the customer wants.">
            <Input
              value={template.desiredOutcome}
              onChange={(e) => setField('desiredOutcome', e.target.value)}
              required
              placeholder="A refund of the duplicate charge"
            />
          </Field>
          <Field
            label="Resolution criteria"
            hint="When the customer is satisfied and ends the chat (drives [CONVERSATION_ENDED])."
          >
            <Input
              value={template.resolutionCriteria}
              onChange={(e) => setField('resolutionCriteria', e.target.value)}
              required
              placeholder="The agent confirms the duplicate charge will be refunded"
            />
          </Field>
        </Section>

        <Section title="Difficulty (optional)">
          <Field
            label="Hidden details"
            hint="Facts the customer reveals only when the agent asks the right questions."
          >
            <Textarea
              value={template.hiddenDetails ?? ''}
              onChange={(e) => setField('hiddenDetails', e.target.value)}
              rows={2}
              placeholder="You switched plans mid-cycle, which may be related."
            />
          </Field>
          <Field label="Behaviour notes" hint="Curveballs: threatens to cancel, talks over the agent…">
            <Textarea
              value={template.behaviorNotes ?? ''}
              onChange={(e) => setField('behaviorNotes', e.target.value)}
              rows={2}
              placeholder="You mention switching to a competitor if this isn't fixed."
            />
          </Field>
          <Field label="Additional instructions" hint="Extra nuance, folded into the prompt.">
            <Textarea
              value={template.additionalInstructions ?? ''}
              onChange={(e) => setField('additionalInstructions', e.target.value)}
              rows={2}
              placeholder="You are short on time and say so early."
            />
          </Field>
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
                  placeholder="Criterion (e.g., De-escalation)"
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

          {isEdit && persona?.systemPrompt && (
            <Section title="Rendered prompt" hint="Read-only preview of the generated system prompt.">
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 font-data text-xs text-muted-foreground">
                {persona.systemPrompt}
              </pre>
            </Section>
          )}

          <div className="space-y-2">
            {isEdit ? (
              <>
                <Button type="submit" size="lg" className="w-full" disabled={!canSave || busy}>
                  {save.isPending ? 'Saving…' : 'Save changes'}
                </Button>
                <Button
                  type="button"
                  variant={persona?.isPublished ? 'secondary' : 'primary'}
                  size="lg"
                  className="w-full"
                  disabled={busy}
                  onClick={() => togglePublish.mutate()}
                >
                  {togglePublish.isPending
                    ? 'Working…'
                    : persona?.isPublished
                      ? 'Unpublish'
                      : 'Publish'}
                </Button>
              </>
            ) : (
              <>
                <Button
                  type="submit"
                  size="lg"
                  className="w-full"
                  disabled={!canSave || busy}
                >
                  {save.isPending && save.variables?.publish !== true
                    ? 'Saving…'
                    : 'Save as draft'}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="lg"
                  className="w-full"
                  disabled={!canSave || busy}
                  onClick={() => save.mutate({ input: buildInput(), publish: true })}
                >
                  {save.isPending && save.variables?.publish === true
                    ? 'Publishing…'
                    : 'Save & publish'}
                </Button>
              </>
            )}
            <Button
              type="button"
              variant="ghost"
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
    <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm shadow-black/[0.02]">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/40 px-5 py-3">
        <div className="flex items-center gap-2.5">
          {icon && (
            <span className="grid size-7 shrink-0 place-items-center rounded-md bg-accent text-accent-foreground">
              {icon}
            </span>
          )}
          <div>
            <h2 className="text-sm font-semibold leading-tight">{title}</h2>
            {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
          </div>
        </div>
        {action}
      </div>
      <div className="space-y-4 p-5">{children}</div>
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
    <label className="block space-y-2 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
    </label>
  )
}
