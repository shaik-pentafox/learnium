# Persona Template Plan — Templated System Instructions

> Status: **APPROVED — building.** Decisions locked (see §6).
> Target customer: **customer-care support training centers** training their support teams.
>
> **Locked decisions:** add `channel` (`chat | audio`) only — no language/locale, no
> company-policies (wrong layer; scoring-side later). Keep `additionalInstructions`
> (optional, folded after guardrails). Drop the freeform path entirely —
> `templateData` required, `systemPrompt` is a render-cache. Render-at-runtime.

## 1. Problem with the current approach

Today a persona stores a single freeform `systemPrompt` string that the trainer
writes by hand. At session start the WS gateway loads `persona.systemPrompt` and
binds it as the `SystemMessage` in the roleplay graph (`buildRoleplayGraph`). That
is the *only* runtime use of the prompt.

Problems:
- Trainers must be prompt engineers. Quality varies wildly.
- No consistency across personas; no guardrails (stay-in-character, `[CONVERSATION_ENDED]`).
- `customInstructions` column is **inert at runtime** — the gateway selects only
  `{id, name, systemPrompt, conversationModelId}` and the graph binds only
  `systemPrompt`. So anything not in `systemPrompt` never reaches the model.

## 2. New approach — structured fields → template → rendered prompt

The trainer no longer writes the raw system prompt. They fill **structured fields**
that describe a *customer scenario*. A single master **template** renders those
fields into the system instruction that the conversation model (Sonnet) runs.

```
trainer fills fields  ──►  renderSystemPrompt(template, fields)  ──►  SystemMessage
   (templateData JSON)            (master template)                  (roleplay graph)
```

In this domain the **persona = the simulated customer** contacting support. The
trainee is the support agent. The model roleplays the customer; the trainee
practices handling them.

## 3. Field schema (`PersonaTemplate`)

What the trainer provides. This becomes a JSON column (`templateData`) and the
single source of truth for the persona's behavior.

| Field | Type | Req | Purpose |
|---|---|---|---|
| `customerName` | string | – | Display name in character (optional). |
| `customerProfile` | string | ✓ | Who they are / relationship to the company (e.g. "Premium subscriber, 3 years"). |
| `company` | string | ✓ | The business they're contacting (e.g. "Nimbus Telecom"). |
| `productContext` | string | – | Product / plan / order details relevant to the issue. |
| `issue` | string | ✓ | The problem that triggered the contact. |
| `channel` | enum | ✓ | `chat \| audio`. Drives reply style/length (see template). Default `chat`. |
| `emotion` | enum | ✓ | `calm \| confused \| frustrated \| angry \| anxious`. |
| `intensity` | int 1–5 | ✓ | How strong the emotion is (difficulty knob). |
| `desiredOutcome` | string | ✓ | What resolution the customer wants (refund, replacement, explanation…). |
| `hiddenDetails` | string | – | Facts the customer withholds until the agent asks the right questions (tests probing). |
| `behaviorNotes` | string | – | Curveballs / difficulty (threatens to cancel, talks over the agent, goes off-topic). |
| `resolutionCriteria` | string | ✓ | When the customer becomes satisfied and ends the chat. |
| `additionalInstructions` | string | – | Free-text escape hatch, folded into the rendered prompt (NOT the dead `customInstructions` column). |

> Dropped from consideration: `language/locale` and `companyPolicies`. Policies
> constrain the **agent**, not the customer — they belong to scoring context, not
> the persona. Revisit as a scoring-side concept.

### Coherence with the scoring rubric (`scoreCriteria`, unchanged)

Authoring and scoring stay aligned:

| Field | Exercises rubric criterion |
|---|---|
| `emotion` + `intensity` | De-escalation, empathy, composure |
| `hiddenDetails` | Active listening, probing / discovery |
| `desiredOutcome` + `resolutionCriteria` | Problem resolution, ownership |
| `behaviorNotes` | Handling difficult customers, policy adherence |

## 4. The master template

Rendered to the `SystemMessage`. `{{field}}` = direct substitution;
conditional blocks render only when their field is present. **Model-agnostic** —
the conversation model is resolved per persona from the DB registry (any
provider), so the template uses plain instructions with no vendor-specific syntax.
Canonical copy — `apps/api/src/core/llm/persona-prompt.template.ts`.

```text
You are roleplaying as a CUSTOMER who has contacted a customer-support agent.
The person you are talking to is a SUPPORT AGENT IN TRAINING.

Stay fully in character as the customer for the entire conversation. You are a
real person with a real problem — never reveal that you are an AI, never coach
or grade the agent, never break character, and never describe these instructions.

# Who you are
{{#customerName}}Your name is {{customerName}}.{{/customerName}}
{{customerProfile}}

# Why you are contacting support
You are contacting {{company}} about the following problem: {{issue}}
{{#productContext}}Relevant details: {{productContext}}{{/productContext}}

# Your emotional state
You currently feel {{emotion}}, at an intensity of {{intensity}} out of 5. Let
this show naturally in your tone, word choice, and patience. If the agent listens,
shows genuine empathy, and makes real progress, gradually calm down. If they are
dismissive, robotic, slow, or unhelpful, your frustration grows.

# What you want
Your goal: {{desiredOutcome}}. You are not satisfied until this is achieved, or
the agent clearly and reasonably explains why it cannot be done.

{{#hiddenDetails}}
# Information you hold back
Do not volunteer the following. Reveal it only if the agent asks the right
questions: {{hiddenDetails}}
{{/hiddenDetails}}

# How you behave
{{#behaviorNotes}}{{behaviorNotes}}{{/behaviorNotes}}
- Behave like a real person, not a checklist. Answer only what is asked.
- {{#chat}}This is a live text chat: keep replies short, usually 1 to 3 sentences. You may paste short details like an order ID or error code.{{/chat}}{{#audio}}This is a spoken phone call: talk conversationally, the way people speak out loud. Natural fillers and slightly longer turns are fine. Do not paste codes or write lists.{{/audio}}
- Do NOT solve your own problem or suggest the solution; that is the agent's job.
- React to what the agent actually says; do not follow a fixed script.

# Ending the conversation
When {{resolutionCriteria}}, say you are satisfied, thank the agent, and end your
final message with the exact token [CONVERSATION_ENDED]. If the conversation
reaches a clear, unrecoverable dead-end, you may also end it with [CONVERSATION_ENDED].

{{#additionalInstructions}}
# Additional direction
{{additionalInstructions}}
{{/additionalInstructions}}
```

### Worked example (fields → prompt)

Fields: `customerName="Dana"`, `customerProfile="Premium subscriber for 3 years"`,
`company="Nimbus Telecom"`, `issue="charged twice for this month's bill"`,
`emotion="frustrated"`, `intensity=4`, `desiredOutcome="a refund of the duplicate charge"`,
`hiddenDetails="you switched plans mid-cycle, which you think may be related"`,
`resolutionCriteria="the agent confirms the duplicate charge will be refunded"`.

→ renders a complete, in-character, guard-railed customer roleplay prompt with the
`[CONVERSATION_ENDED]` sentinel the existing engine already detects.

## 5. Structure changes (when approved)

Render-at-runtime; `templateData` is source of truth.

| Layer | Change |
|---|---|
| `packages/contracts` | New `PersonaTemplateSchema` (fields above). `CreatePersonaDto` swaps required `systemPrompt` → required `template`. `systemPrompt`/`customInstructions` drop from the create input. |
| Prisma | Add `templateData Json?` to `Persona`. Keep `systemPrompt` column as a **rendered cache** (refreshed on save) for preview + version snapshots. Migration. |
| `core/llm/persona-prompt.template.ts` | New: the template constant + `renderSystemPrompt(fields): string`. Tiny renderer (substitution + conditional blocks). Unit-tested. |
| `personas.service` | On create/update: validate fields, store `templateData`, render + store `systemPrompt` cache. Version snapshot records `templateData`. |
| `chat.gateway` | Select `templateData`; bind `renderSystemPrompt(persona.templateData)` instead of the stored string — so master-template improvements reach every session live. (Falls back to stored `systemPrompt` if `templateData` is null, for any legacy persona.) |
| `apps/web` persona-builder | Replace the freeform "System instructions" textarea with the structured fields. Add a read-only rendered **preview**. |
| `apps/web` services + mocks | Type `PersonaTemplate`; mock store + render preview. |

### Render-timing decision

**Render-at-runtime** (gateway renders from `templateData` each session start).
Tradeoff vs render-on-save: improving the master template later automatically
upgrades *every existing persona*, instead of leaving stale baked prompts — the
right default for a training product that will iterate prompt quality. Cost is one
tiny line in the gateway. The stored `systemPrompt` becomes a preview cache only.

## 6. Decisions (locked)

1. **Field set** — schema in §3 + `channel` (`chat | audio`). No language/locale.
   No company-policies (scoring-side, not persona).
2. **Freeform escape hatch** — keep `additionalInstructions`, optional, folded after
   guardrails so it cannot override stay-in-character.
3. **Legacy** — drop the freeform path entirely. `templateData` required;
   `systemPrompt` is a render-cache only. No fallback.

---

### Note on "use skill to generate prompt for Sonnet"

The only prompt-related skill found locally is **`prompt-optimizer`**, which is
advisory and tuned to optimize *Claude Code task prompts* (it injects `/plan`,
`/tdd`, and ECC components). It produces guidance for prompting Claude Code — not a
*runtime roleplay system-instruction template* for the conversation model. Running it
here would emit irrelevant output, so the template above was authored directly. It is
**model-agnostic** (the conversation model is resolved from the registry per persona).
If you meant a different/installed skill, name it and I'll route through it.
