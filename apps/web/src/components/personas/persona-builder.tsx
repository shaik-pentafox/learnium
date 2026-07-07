import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import {
  Plus,
  Trash2,
  Rocket,
  UserSquare2,
  MessagesSquare,
  Target,
  SlidersHorizontal,
  ListChecks,
  Mic,
  ClipboardCheck,
  ChevronLeft,
  ChevronRight,
  Check,
  Play,
  Square,
  Loader2,
} from 'lucide-react'
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
  PERSONA_SWATCHES,
} from '@/lib/persona-color'
import { listModels, llmKeys } from '@/services/llm'
import {
  listVoices,
  listVoiceLanguages,
  fetchVoicePreview,
  voiceKeys,
  type VoiceStyleOption,
} from '@/services/voice'
import { startSession } from '@/services/roleplay'
import {
  createPersona,
  updatePersona,
  publishPersona,
  unpublishPersona,
  personaKeys,
  CHANNELS,
  EMOTIONS,
  GENDERS,
  type Channel,
  type Persona,
  type PersonaInput,
  type PersonaTemplate,
  type ScoreCriterionInput,
} from '@/services/personas'
import { NumberField } from '../ui/number-field'
import { SliderComfortable } from '@/components/ui/slider'
import { ColorPickerPopover } from '@/components/ui/color-picker'

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

const GENDER_LABELS: Record<(typeof GENDERS)[number], string> = {
  male: 'Male',
  female: 'Female',
}

// Human labels for the BCP-47 codes the voice provider returns. Unlisted codes
// fall back to the raw code so the picker still works if the catalog grows.
const LANGUAGE_LABELS: Record<string, string> = {
  'en-IN': 'English',
  'hi-IN': 'Hindi',
  'bn-IN': 'Bengali',
  'gu-IN': 'Gujarati',
  'kn-IN': 'Kannada',
  'ml-IN': 'Malayalam',
  'mr-IN': 'Marathi',
  'od-IN': 'Odia',
  'pa-IN': 'Punjabi',
  'ta-IN': 'Tamil',
  'te-IN': 'Telugu',
}

const STEPS = [
  { label: 'Basics', icon: <UserSquare2 className="size-4" /> },
  { label: 'Customer', icon: <UserSquare2 className="size-4" /> },
  { label: 'Scenario', icon: <MessagesSquare className="size-4" /> },
  { label: 'Goal', icon: <Target className="size-4" /> },
  { label: 'Difficulty', icon: <SlidersHorizontal className="size-4" /> },
  { label: 'Scoring', icon: <ListChecks className="size-4" /> },
  { label: 'Models & Voice', icon: <Mic className="size-4" /> },
] as const

const LAST_STEP = STEPS.length - 1

function emptyTemplate(): PersonaTemplate {
  return {
    customerName: '',
    customerContact: '',
    accountRef: '',
    customerProfile: '',
    company: '',
    productContext: '',
    issue: '',
    channels: ['chat'],
    emotion: 'frustrated',
    intensity: 3,
    escalationTriggers: '',
    deescalationTriggers: '',
    desiredOutcome: '',
    resolutionCriteria: '',
    closingStatement: '',
    hiddenDetails: '',
    behaviorNotes: '',
    additionalInstructions: '',
    openingMessage: '',
  }
}

function toTemplate(persona?: Persona): PersonaTemplate {
  if (!persona?.templateData) return emptyTemplate()
  const data = persona.templateData as Partial<PersonaTemplate> & { channel?: Channel }
  // Fold a legacy single `channel` into `channels` (pre-multi-select personas).
  const channels =
    Array.isArray(data.channels) && data.channels.length
      ? data.channels
      : data.channel
        ? [data.channel]
        : ['chat']
  return { ...emptyTemplate(), ...data, channels: channels as Channel[] }
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

// Character caps — mirror the backend Zod maxes (persona.dto.ts +
// persona-prompt.template.ts) so the UI restricts what the API would reject.
const LIMITS = {
  name: 200,
  description: 300,
  customerName: 120,
  customerContact: 120,
  accountRef: 120,
  company: 200,
  customerProfile: 2000,
  productContext: 2000,
  issue: 2000,
  escalationTriggers: 1000,
  deescalationTriggers: 1000,
  desiredOutcome: 2000,
  resolutionCriteria: 2000,
  closingStatement: 500,
  hiddenDetails: 2000,
  behaviorNotes: 2000,
  additionalInstructions: 2000,
  openingMessage: 2000,
  criterionName: 100,
} as const

function CharCounter({ value, max }: { value: string; max: number }) {
  const len = value.length
  return (
    <span
      className={`pointer-events-none mt-1 block text-right text-[11px] tabular-nums ${
        len >= max
          ? 'text-destructive'
          : len >= max * 0.9
            ? 'text-amber-600 dark:text-amber-400'
            : 'text-muted-foreground'
      }`}
    >
      {len}/{max}
    </span>
  )
}

type LimitedInputProps = Omit<
  React.ComponentProps<typeof Input>,
  'value' | 'onChange' | 'maxLength'
> & { value: string; onChange: (value: string) => void; max: number }

// Text input that hard-caps length (native maxLength) + shows a live counter.
function LimitedInput({ value, onChange, max, ...rest }: LimitedInputProps) {
  return (
    <>
      <Input
        value={value}
        maxLength={max}
        onChange={(e) => onChange(e.target.value)}
        {...rest}
      />
      <CharCounter value={value} max={max} />
    </>
  )
}

type LimitedTextareaProps = Omit<
  React.ComponentProps<typeof Textarea>,
  'value' | 'onChange' | 'maxLength'
> & { value: string; onChange: (value: string) => void; max: number }

function LimitedTextarea({ value, onChange, max, ...rest }: LimitedTextareaProps) {
  return (
    <>
      <Textarea
        value={value}
        maxLength={max}
        onChange={(e) => onChange(e.target.value)}
        {...rest}
      />
      <CharCounter value={value} max={max} />
    </>
  )
}

export function PersonaBuilder({ persona }: { persona?: Persona }) {
  const isEdit = persona != null
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const isAdmin = useAuthStore((s) => s.user?.role === 'SUPER_ADMIN')

  const [step, setStep] = useState(0)
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
  const [voiceModelId, setVoiceModelId] = useState<string>(
    persona?.voiceModelId != null ? String(persona.voiceModelId) : '',
  )
  const [voiceId, setVoiceId] = useState<string>(persona?.voiceId ?? '')
  const [languages, setLanguages] = useState<string[]>(persona?.languages ?? [])

  // Model pickers are Super-Admin only (GET /llm/models is llmops:read).
  const models = useQuery({
    queryKey: llmKeys.models(),
    queryFn: () => listModels(),
    enabled: isAdmin,
  })
  const chatModels = models.data?.filter((m) => m.kind === 'chat')
  const voiceModels = models.data?.filter((m) => m.kind === 'voice')

  // Languages + voices of the resolved voice model (the pin, or the primary) —
  // the trainee may only pick from these at session start.
  const pinnedVoiceModelId = voiceModelId ? Number(voiceModelId) : undefined
  const voiceLanguages = useQuery({
    queryKey: voiceKeys.languages(pinnedVoiceModelId),
    queryFn: () => listVoiceLanguages(pinnedVoiceModelId),
  })
  const voiceOptions = useQuery({
    queryKey: voiceKeys.voices(pinnedVoiceModelId),
    queryFn: () => listVoices(pinnedVoiceModelId),
  })

  // Voices matching the persona's gender. Unset gender → all; a voice with no
  // gender designation (null) shows for anyone (fail-open, never hides all).
  const genderedVoices = voiceOptions.data?.filter(
    (v) => !template.gender || !v.gender || v.gender === template.gender,
  )

  // When gender (or the model's catalog) changes, drop a now-hidden voice pick.
  useEffect(() => {
    if (!voiceId || !genderedVoices) return
    if (!genderedVoices.some((v) => v.voiceId === voiceId)) setVoiceId('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template.gender, voiceOptions.data])

  function toggleLanguage(code: string) {
    setLanguages((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code],
    )
  }

  function setField<K extends keyof PersonaTemplate>(key: K, value: PersonaTemplate[K]) {
    setTemplate((prev) => ({ ...prev, [key]: value }))
  }

  // Multi-select channel toggle — always leaves at least one modality on.
  function toggleChannel(c: Channel) {
    const next = template.channels.includes(c)
      ? template.channels.filter((x) => x !== c)
      : [...template.channels, c]
    if (!next.length) return
    setTemplate((prev) => ({ ...prev, channels: next }))
    // Turning voice OFF clears its config, so "has languages" stays a reliable
    // signal that voice is actually enabled (the list gates its voice test on
    // this — no stale languages from a persona that's no longer voice).
    if (!next.includes('audio')) {
      setLanguages([])
      setVoiceId('')
    }
  }

  function buildInput(): PersonaInput {
    return {
      name,
      description,
      color,
      template,
      conversationModelId: conversationModelId ? Number(conversationModelId) : null,
      scoringModelId: scoringModelId ? Number(scoringModelId) : null,
      voiceModelId: voiceModelId ? Number(voiceModelId) : null,
      voiceId: voiceId || null,
      languages,
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
    mutationFn: async ({ input, mode }: { input: PersonaInput; mode: Channel }) => {
      const saved = isEdit ? await updatePersona(persona.id, input) : await createPersona(input)
      const session = await startSession(saved.id, { simulation: true })
      // Voice test runs in voice mode (?voice=<lang>); chat test in text mode.
      const voiceLang = mode === 'audio' ? (input.languages?.[0] ?? null) : null
      return { uid: session.uid, voiceLang }
    },
    onSuccess: ({ uid, voiceLang }) => {
      queryClient.invalidateQueries({ queryKey: personaKeys.mine() })
      navigate({
        to: '/session/$uid',
        params: { uid },
        search: voiceLang ? { voice: voiceLang } : {},
      })
    },
    onError: () => notify.error('Could not launch session'),
  })

  // Channels are the persona's modalities (multi-select): 'chat' = text roleplay,
  // 'audio' = voice call, or both. Voice is enabled only when 'audio' is on, and
  // a voice persona needs ≥1 spoken language.
  const isVoice = template.channels.includes('audio')
  const isChat = template.channels.includes('chat')
  const busy = save.isPending || launch.isPending || togglePublish.isPending
  const missing = [
    name.trim() ? null : 'name',
    template.company.trim() ? null : 'company',
    template.customerProfile.trim() ? null : 'customer profile',
    template.issue.trim() ? null : 'issue',
    template.desiredOutcome.trim() ? null : 'desired outcome',
    template.resolutionCriteria.trim() ? null : 'winning condition',
    isVoice && languages.length === 0 ? 'voice language' : null,
  ].filter((m): m is string => m != null)
  const canSave = missing.length === 0

  function setRow(key: string, patch: Partial<CriterionRow>) {
    setCriteria((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  }

  return (
    <form
      className="flex w-full flex-col gap-6 lg:h-full lg:min-h-0 lg:flex-row"
      onSubmit={(e) => e.preventDefault()}
    >
      {/* ── Stepper column ────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col lg:min-h-0">
        <header className="mb-5">
          <h1 className="text-2xl font-semibold tracking-tight">
            {isEdit ? 'Edit persona' : 'Persona builder'}
          </h1>
          {/* <p className="text-sm text-muted-foreground">
            Describe the customer your support trainees will roleplay against. The
            system prompt is generated from these fields.
          </p> */}
        </header>

        <StepNav current={step} onJump={setStep} />

        <div className="mt-6 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-1 scrollbar-hide">
        {step === 0 && (
          <Section title="Persona" icon={<UserSquare2 className="size-4" />}>
            <Field label="Persona name" hint="Internal label shown in lists.">
              <LimitedInput
                value={name}
                onChange={setName}
                max={LIMITS.name}
                placeholder="e.g., Double-charged Dana"
              />
            </Field>
            <Field label="Short description" hint="One line summarising the scenario.">
              <LimitedInput
                value={description}
                onChange={setDescription}
                max={LIMITS.description}
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
                <ColorPickerPopover
                  defaultValue={isHexColor(color) ? color : DEFAULT_PERSONA_COLOR}
                  onValueChange={(v) => setColor(v)}
                  swatches={PERSONA_SWATCHES}
                  triggerShowValue
                />
              </div>
            </Field>
          </Section>
        )}

        {step === 1 && (
          <Section title="The customer" icon={<UserSquare2 className="size-4" />}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Customer name" hint="Optional, used in character.">
                <LimitedInput
                  value={template.customerName ?? ''}
                  onChange={(v) => setField('customerName', v)}
                  max={LIMITS.customerName}
                  placeholder="e.g., Dana"
                />
              </Field>
              <Field label="Gender" hint="Keeps pronouns consistent in character.">
                <Select
                  value={template.gender}
                  onValueChange={(v) => setField('gender', v as PersonaTemplate['gender'])}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select gender" />
                  </SelectTrigger>
                  <SelectContent>
                    {GENDERS.map((g) => (
                      <SelectItem key={g} value={g}>
                        {GENDER_LABELS[g]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <Field label="Company they contact">
              <LimitedInput
                value={template.company}
                onChange={(v) => setField('company', v)}
                max={LIMITS.company}
                placeholder="e.g., Nimbus Telecom"
              />
            </Field>
            <Field label="Customer profile" hint="Who they are / relationship to the company.">
              <LimitedInput
                value={template.customerProfile}
                onChange={(v) => setField('customerProfile', v)}
                max={LIMITS.customerProfile}
                placeholder="Premium subscriber for 3 years"
              />
            </Field>
            <Field label="Product context" hint="Optional plan / order / device details.">
              <LimitedInput
                value={template.productContext ?? ''}
                onChange={(v) => setField('productContext', v)}
                max={LIMITS.productContext}
                placeholder="Unlimited plan, billed monthly"
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Age" hint="Optional. For ID checks.">
                <NumberField
                  min={1}
                  max={120}
                  value={template.customerAge != null ? String(template.customerAge) : ''}
                  onChange={(v) => {
                    const n = Number(v)
                    setField('customerAge', v && Number.isFinite(n) ? n : undefined)
                  }}
                  aria-label="Customer age"
                />
              </Field>
              <Field label="Contact" hint="Phone / email to confirm.">
                <LimitedInput
                  value={template.customerContact ?? ''}
                  onChange={(v) => setField('customerContact', v)}
                  max={LIMITS.customerContact}
                  placeholder="e.g., 555-0142"
                />
              </Field>
              <Field label="Account ref" hint="Order / ticket ID to confirm.">
                <LimitedInput
                  value={template.accountRef ?? ''}
                  onChange={(v) => setField('accountRef', v)}
                  max={LIMITS.accountRef}
                  placeholder="e.g., #A-1042"
                />
              </Field>
            </div>
          </Section>
        )}

        {step === 2 && (
          <Section title="The scenario" icon={<MessagesSquare className="size-4" />}>
            <Field label="Issue" hint="The single problem that triggered the contact.">
              <LimitedTextarea
                value={template.issue}
                onChange={(v) => setField('issue', v)}
                max={LIMITS.issue}
                rows={2}
                placeholder="Charged twice for this month's bill."
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Channels" hint="Text chat, voice call, or both. Drives how the persona is trained and tested.">
                <div className="flex gap-2">
                  {CHANNELS.map((c) => {
                    const on = template.channels.includes(c)
                    return (
                      <button
                        key={c}
                        type="button"
                        role="checkbox"
                        aria-checked={on}
                        onClick={() => toggleChannel(c)}
                        className={`flex-1 rounded-md border px-3 py-2 text-sm transition-colors ${
                          on
                            ? 'border-primary bg-primary/10 font-medium'
                            : 'border-border bg-surface hover:bg-muted'
                        }`}
                      >
                        {CHANNEL_LABELS[c]}
                      </button>
                    )
                  })}
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
            <Field label="Intensity" hint="How strong the emotion is.">
              <SliderComfortable
                value={template.intensity}
                onChange={(n) => setField('intensity', n)}
                min={1}
                max={5}
                step={1}
                variant="pips"
                formatValue={(v) => `${v}/5`}
                aria-label="Intensity"
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Escalation triggers" hint="What makes them angrier.">
                <LimitedTextarea
                  value={template.escalationTriggers ?? ''}
                  onChange={(v) => setField('escalationTriggers', v)}
                  max={LIMITS.escalationTriggers}
                  rows={2}
                  placeholder="Being put on hold, scripted replies…"
                />
              </Field>
              <Field label="De-escalation triggers" hint="What calms them down.">
                <LimitedTextarea
                  value={template.deescalationTriggers ?? ''}
                  onChange={(v) => setField('deescalationTriggers', v)}
                  max={LIMITS.deescalationTriggers}
                  rows={2}
                  placeholder="A clear apology, a concrete fix…"
                />
              </Field>
            </div>
          </Section>
        )}

        {step === 3 && (
          <Section title="Goal & resolution" icon={<Target className="size-4" />}>
            <Field label="Desired outcome" hint="What resolution the customer wants.">
              <LimitedInput
                value={template.desiredOutcome}
                onChange={(v) => setField('desiredOutcome', v)}
                max={LIMITS.desiredOutcome}
                placeholder="A refund of the duplicate charge"
              />
            </Field>
            <Field
              label="Winning condition"
              hint="When the customer is satisfied and ends the chat (drives [CONVERSATION_ENDED])."
            >
              <LimitedInput
                value={template.resolutionCriteria}
                onChange={(v) => setField('resolutionCriteria', v)}
                max={LIMITS.resolutionCriteria}
                placeholder="The agent confirms the duplicate charge will be refunded"
              />
            </Field>
            <Field
              label="Closing statement"
              hint="Optional. How the customer signs off once satisfied."
            >
              <LimitedInput
                value={template.closingStatement ?? ''}
                onChange={(v) => setField('closingStatement', v)}
                max={LIMITS.closingStatement}
                placeholder="Thanks for sorting that out, appreciate it."
              />
            </Field>
          </Section>
        )}

        {step === 4 && (
          <Section title="Difficulty (optional)" icon={<SlidersHorizontal className="size-4" />}>
            <Field
              label="Hidden details"
              hint="Facts the customer reveals only when the agent asks the right questions."
            >
              <LimitedTextarea
                value={template.hiddenDetails ?? ''}
                onChange={(v) => setField('hiddenDetails', v)}
                max={LIMITS.hiddenDetails}
                rows={2}
                placeholder="You switched plans mid-cycle, which may be related."
              />
            </Field>
            <Field label="Behaviour notes" hint="Curveballs: threatens to cancel, talks over the agent…">
              <LimitedTextarea
                value={template.behaviorNotes ?? ''}
                onChange={(v) => setField('behaviorNotes', v)}
                max={LIMITS.behaviorNotes}
                rows={2}
                placeholder="You mention switching to a competitor if this isn't fixed."
              />
            </Field>
            <Field label="Additional instructions" hint="Extra nuance, folded into the prompt.">
              <LimitedTextarea
                value={template.additionalInstructions ?? ''}
                onChange={(v) => setField('additionalInstructions', v)}
                max={LIMITS.additionalInstructions}
                rows={2}
                placeholder="You are short on time and say so early."
              />
            </Field>
            <Field
              label="Opening message"
              hint="Leave blank to let the model improvise the customer's first line each session."
            >
              <LimitedTextarea
                value={template.openingMessage ?? ''}
                onChange={(v) => setField('openingMessage', v)}
                max={LIMITS.openingMessage}
                rows={2}
                placeholder="Hi, I was charged twice this month and I want it refunded."
              />
            </Field>
          </Section>
        )}

        {step === 5 && (
          <Section
            title="Evaluation criteria"
            icon={<ListChecks className="size-4" />}
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
                    maxLength={LIMITS.criterionName}
                    placeholder="Criterion (e.g., De-escalation)"
                    className="flex-1"
                  />
                  <NumberField
                    min={1}
                    max={100}
                    value={String(row.maxScore)}
                    onChange={(v) => setRow(row.key, { maxScore: Number(v) || 1 })}
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
        )}

        {step === 6 && (
          <div className="space-y-6">
            {isAdmin && (
              <Section title="Model registry" icon={<Mic className="size-4" />}>
                <Field label="Conversation engine" hint="Defaults to the primary chat model if unset.">
                  <ModelSelect
                    value={conversationModelId}
                    onChange={setConversationModelId}
                    options={chatModels}
                    loading={models.isPending}
                  />
                </Field>
                <Field label="Evaluation / scoring">
                  <ModelSelect
                    value={scoringModelId}
                    onChange={setScoringModelId}
                    options={chatModels}
                    loading={models.isPending}
                  />
                </Field>
              </Section>
            )}
            {isVoice ? (
              <Section title="Voice" icon={<Mic className="size-4" />} hint="This is a voice-call persona. Configure how it speaks and what languages a trainee may use.">
                {isAdmin && (
                  <Field label="Voice model" hint="Defaults to the primary voice model if unset.">
                    <ModelSelect
                      value={voiceModelId}
                      onChange={(v) => {
                        setVoiceModelId(v)
                        // Language/voice availability changes with the model — reset picks.
                        setLanguages([])
                        setVoiceId('')
                      }}
                      options={voiceModels}
                      loading={models.isPending}
                      defaultLabel="Primary voice model"
                    />
                  </Field>
                )}
                <Field label="Languages" hint="Trainee picks one of these when starting the voice session. At least one is required.">
                  <LanguageChips
                    selected={languages}
                    onToggle={toggleLanguage}
                    options={voiceLanguages.data}
                    loading={voiceLanguages.isPending}
                  />
                  {languages.length === 0 && (
                    <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                      Pick at least one language — a voice persona can't be saved or tested without one.
                    </p>
                  )}
                </Field>
                <Field
                  label="Voice"
                  hint={
                    template.gender
                      ? `Voices matching a ${GENDER_LABELS[template.gender].toLowerCase()} customer. Press play to hear a sample.`
                      : "The persona's spoken voice. Set a gender in Basics to narrow this list. Press play to hear a sample."
                  }
                >
                  <VoicePicker
                    voices={genderedVoices}
                    loading={voiceOptions.isPending}
                    selected={voiceId}
                    onSelect={setVoiceId}
                    previewLanguage={languages[0] ?? 'en-IN'}
                    voiceModelId={pinnedVoiceModelId}
                  />
                </Field>
              </Section>
            ) : (
              <Section title="Voice" icon={<Mic className="size-4" />}>
                <p className="text-sm text-muted-foreground">
                  This is a <span className="font-medium text-foreground">text-chat</span> persona — voice isn't used.
                  To configure a spoken voice, set <span className="font-medium text-foreground">Channel</span> to
                  “Voice call” in the Scenario step.
                </p>
              </Section>
            )}
          </div>
        )}

        </div>

        {/* ── Step nav (Back / Next) — always at the column bottom ──── */}
        <div className="mt-4 flex shrink-0 items-center justify-between gap-3 border-t border-border bg-background pt-4">
          <Button
            type="button"
            variant="ghost"
            disabled={step === 0 || busy}
            onClick={() => setStep((s) => Math.max(0, s - 1))}
          >
            <ChevronLeft />
            Back
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={step === LAST_STEP || busy}
            onClick={() => setStep((s) => Math.min(LAST_STEP, s + 1))}
          >
            Next
            <ChevronRight />
          </Button>
        </div>
      </div>

      {/* ── Review / actions column ───────────────────────────────── */}
      <aside className="w-full shrink-0 lg:flex lg:w-80 lg:min-h-0 lg:flex-col">
        <div className="space-y-6 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-1 scrollbar-hide">
          <Section title="Overview" icon={<ClipboardCheck className="size-4" />}>
            {!canSave && (
              <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                Still needed: {missing.join(', ')}.
              </p>
            )}
            <dl className="grid gap-x-4 gap-y-2 text-sm">
              <Summary label="Name" value={name} />
              <Summary label="Company" value={template.company} />
              <Summary label="Customer" value={template.customerName || '—'} />
              <Summary
                label="Emotion"
                value={`${EMOTION_LABELS[template.emotion]} · ${template.intensity}/5`}
              />
              <Summary label="Issue" value={template.issue} />
              <Summary label="Winning condition" value={template.resolutionCriteria} />
              <Summary
                label="Channels"
                value={template.channels.map((c) => CHANNEL_LABELS[c]).join(' · ')}
              />
              {isVoice && (
                <Summary
                  label="Voice languages"
                  value={languages.length ? languages.join(', ') : '—'}
                />
              )}
              <Summary
                label="Criteria"
                value={`${criteria.filter((c) => c.name.trim()).length} defined`}
              />
            </dl>
          </Section>

          {isEdit && isAdmin && persona?.systemPrompt && (
            <Section title="Rendered prompt" hint="Read-only preview of the generated system prompt.">
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 font-data text-xs text-muted-foreground">
                {persona.systemPrompt}
              </pre>
            </Section>
          )}
        </div>

        {/* Actions — pinned at the bottom of the aside */}
        <div className="mt-4 space-y-2 border-t border-border bg-background pt-4 lg:shrink-0">
          {isEdit ? (
            <>
              <Button
                type="button"
                size="lg"
                className="w-full"
                disabled={!canSave || busy}
                onClick={() => save.mutate({ input: buildInput() })}
              >
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
                type="button"
                size="lg"
                className="w-full"
                disabled={!canSave || busy}
                onClick={() => save.mutate({ input: buildInput() })}
              >
                {save.isPending && save.variables?.publish !== true ? 'Saving…' : 'Save as draft'}
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
          {isChat && (
            <Button
              type="button"
              variant="ghost"
              size="lg"
              className="w-full"
              disabled={!canSave || busy}
              onClick={() => launch.mutate({ input: buildInput(), mode: 'chat' })}
            >
              <Rocket />
              {launch.isPending && launch.variables?.mode === 'chat'
                ? 'Launching…'
                : 'Save & chat test'}
            </Button>
          )}
          {isVoice && (
            <Button
              type="button"
              variant="ghost"
              size="lg"
              className="w-full"
              disabled={!canSave || busy}
              onClick={() => launch.mutate({ input: buildInput(), mode: 'audio' })}
            >
              <Mic />
              {launch.isPending && launch.variables?.mode === 'audio'
                ? 'Launching…'
                : 'Save & voice test'}
            </Button>
          )}
        </div>
      </aside>
    </form>
  )
}

function StepNav({ current, onJump }: { current: number; onJump: (i: number) => void }) {
  return (
    <nav className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
      {STEPS.map((s, i) => {
        const active = i === current
        const done = i < current
        // "Reached" = current or any earlier step → active-styled so progress
        // reads at a glance (step 3 shows 1 + 2 as completed, not just 3).
        const reached = i <= current
        return (
          <button
            key={s.label}
            type="button"
            onClick={() => onJump(i)}
            aria-current={active ? 'step' : undefined}
            className={`flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
              active
                ? 'border-primary bg-primary/10 font-medium text-foreground'
                : reached
                  ? 'border-primary/40 bg-primary/5 text-foreground hover:bg-primary/10'
                  : 'border-border bg-surface text-muted-foreground hover:bg-muted'
            }`}
          >
            <span
              className={`grid size-5 shrink-0 place-items-center rounded-full text-[11px] ${
                reached
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground'
              }`}
            >
              {done ? <Check className="size-3" /> : i + 1}
            </span>
            <span className="hidden sm:inline">{s.label}</span>
          </button>
        )
      })}
    </nav>
  )
}

function ModelSelect({
  value,
  onChange,
  options,
  loading,
  defaultLabel = 'Registry default',
}: {
  value: string
  onChange: (v: string) => void
  options: { id: number; name: string }[] | undefined
  loading: boolean
  defaultLabel?: string
}) {
  return (
    <Select value={value || 'default'} onValueChange={(v) => onChange(v === 'default' ? '' : v)}>
      <SelectTrigger>
        <SelectValue placeholder={loading ? 'Loading…' : defaultLabel} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="default">{defaultLabel}</SelectItem>
        {options?.map((m) => (
          <SelectItem key={m.id} value={String(m.id)}>
            {m.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/**
 * Voice selector with inline audio previews. One shared <audio> element; the
 * sample is fetched (and server-cached) on first play per voice+language.
 * "Model default" = unset — the session uses the voice model's first voice.
 */
function VoicePicker({
  voices,
  loading,
  selected,
  onSelect,
  previewLanguage,
  voiceModelId,
}: {
  voices: VoiceStyleOption[] | undefined
  loading: boolean
  selected: string
  onSelect: (voiceId: string) => void
  previewLanguage: string
  voiceModelId: number | undefined
}) {
  const [playingId, setPlayingId] = useState<string | null>(null)
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const urlRef = useRef<string | null>(null)

  // Stop playback + free the blob URL on unmount.
  useEffect(() => {
    return () => {
      audioRef.current?.pause()
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    }
  }, [])

  function stopPlayback() {
    audioRef.current?.pause()
    audioRef.current = null
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current)
      urlRef.current = null
    }
    setPlayingId(null)
  }

  async function togglePreview(voiceId: string) {
    if (playingId === voiceId) {
      stopPlayback()
      return
    }
    stopPlayback()
    setLoadingId(voiceId)
    try {
      const url = await fetchVoicePreview(voiceId, previewLanguage, voiceModelId)
      urlRef.current = url
      const audio = new Audio(url)
      audioRef.current = audio
      audio.onended = () => stopPlayback()
      await audio.play()
      setPlayingId(voiceId)
    } catch {
      notify.error('Preview unavailable for this voice')
    } finally {
      setLoadingId(null)
    }
  }

  if (loading) return <p className="text-xs text-muted-foreground">Loading…</p>
  if (!voices?.length)
    return <p className="text-xs text-muted-foreground">No voices available.</p>

  return (
    <div className="grid gap-1.5">
      <button
        type="button"
        onClick={() => onSelect('')}
        aria-pressed={selected === ''}
        className={
          selected === ''
            ? 'flex items-center rounded-lg border border-primary bg-primary/5 px-3 py-2 text-left text-sm font-medium'
            : 'flex items-center rounded-lg border border-border px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:border-primary/40'
        }
      >
        Model default
      </button>
      {voices.map((v) => {
        const active = selected === v.voiceId
        return (
          <div
            key={v.voiceId}
            className={
              active
                ? 'flex items-center gap-2 rounded-lg border border-primary bg-primary/5 px-3 py-1.5'
                : 'flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 transition-colors hover:border-primary/40'
            }
          >
            <button
              type="button"
              onClick={() => onSelect(v.voiceId)}
              aria-pressed={active}
              className={
                active
                  ? 'flex-1 text-left text-sm font-medium capitalize'
                  : 'flex-1 text-left text-sm capitalize text-muted-foreground'
              }
            >
              {v.name}
            </button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7 shrink-0"
              aria-label={playingId === v.voiceId ? `Stop ${v.name} sample` : `Play ${v.name} sample`}
              onClick={() => void togglePreview(v.voiceId)}
              disabled={loadingId !== null && loadingId !== v.voiceId}
            >
              {loadingId === v.voiceId ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : playingId === v.voiceId ? (
                <Square className="size-3.5" />
              ) : (
                <Play className="size-3.5" />
              )}
            </Button>
          </div>
        )
      })}
    </div>
  )
}

function LanguageChips({
  selected,
  onToggle,
  options,
  loading,
}: {
  selected: string[]
  onToggle: (code: string) => void
  options: string[] | undefined
  loading: boolean
}) {
  if (loading) return <p className="text-xs text-muted-foreground">Loading…</p>
  if (!options?.length) return <p className="text-xs text-muted-foreground">No languages available.</p>
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((code) => {
        const active = selected.includes(code)
        return (
          <button
            key={code}
            type="button"
            onClick={() => onToggle(code)}
            aria-pressed={active}
            className={
              active
                ? 'rounded-full border border-primary bg-primary/10 px-3 py-1 text-xs font-medium text-primary'
                : 'rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground'
            }
          >
            {LANGUAGE_LABELS[code] ?? code}
          </button>
        )
      })}
    </div>
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
    <label className="block text-sm">
      <span className="mb-2 block font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-muted-foreground">{hint}</span>}
    </label>
  )
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate font-medium">{value || '—'}</dd>
    </div>
  )
}
