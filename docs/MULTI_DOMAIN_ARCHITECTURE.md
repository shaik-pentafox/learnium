# Multi-Domain Roleplay Architecture

> Status: **PROPOSED — design review. Validated against source 2026-07-08**
> (every file/symbol/line below verified against the tree on
> `feature/persona-prompt-and-voice-cleanup`).
> Goal: extend the persona/roleplay engine beyond `customer-support` to additional
> verticals (**sales**, **hr**) without forking the codebase per vertical.
> Supersedes the "customer-support only" scope in `PERSONA_TEMPLATE_PLAN.md`.

> **Key validation finding:** support role framing is NOT confined to three
> spots — it is baked into **~10 prompt blocks + the WS gateway + the scoring
> feedback string + two web surfaces (session UI, mock handlers)**. The refactor's
> real surface area is larger than a naive read suggests; the full hardcode
> inventory is §10. The trainee **session UI** (`session/$uid.tsx`) is the one
> consumer with *no* access to `templateData` — it needs domain roles delivered
> through the session payload/contracts (§5, §10).

---

## 1. Where we are today

A persona is defined by structured `templateData` fields that a single template
renders into the roleplay system prompt at session start:

```
trainer fills fields ─► renderSystemPrompt(templateData) ─► SystemMessage ─► roleplay graph
```

The `domain` seam already exists but is **inert**:

- `persona-prompt.template.ts:31` declares `ROLEPLAY_DOMAINS = ['customer-support'] as const`
  and `PersonaTemplateSchema.domain = z.enum(ROLEPLAY_DOMAINS).default('customer-support')`
  (`:35`), but `renderSystemPrompt()` (`:294`) **ignores `t.domain`** — it always
  maps over `CUSTOMER_SUPPORT_BLOCKS` (`:273`).
- The schema is a **flat customer-support shape** — `customerProfile` (`:46`),
  `company` (`:49`), `issue` (`:52`) are required (`.min(1)`), alongside shared
  requireds `emotion`/`intensity`/`desiredOutcome`/`resolutionCriteria`. The CS
  situation fields are meaningless for HR/Sales.
- Runtime role framing is hardcoded to "customer / support agent" across **~10
  prompt blocks** (not three) — `introBlock`, `guardrailBlock`, `identityBlock`,
  `situationBlock`, `emotionBlock`, `goalBlock`, `openingBlock`, `behaviourBlock`,
  `endingBlock`, `reminderBlock` — **plus** `voiceRoleLock` (`chat.gateway.ts:243`)
  **plus** `languageInstruction` ("even if the agent writes…", `chat.gateway.ts:258`)
  **plus** the scoring unscorable-session feedback ("Engage with the customer…",
  `scoring.service.ts:38`). Full inventory in §10.
- The web builder (`persona-builder.tsx`) is worded entirely for support
  ("The customer" `:473`, "Company they contact" `:501`, "Winning condition"
  `:657`/`:903`), and support framing also lives in the trainee **session UI**
  (`session/$uid.tsx:167` "You are the support agent…") and the **mock renderer**
  (`mocks/handlers.ts:127`).

**Consequence:** every persona is a support customer. Adding a vertical is not a
data change — it requires making `domain` actually drive schema, blocks, role
framing, and UI.

---

## 2. Design principles

1. **One engine, many domains.** No per-vertical services, gateways, or graphs.
   A single `domain` discriminator selects schema + blocks + framing from a registry.
2. **Shared core, per-domain situation.** Most of a persona is domain-agnostic
   (identity, emotion, difficulty, opening, goal, channels, guardrails, ending).
   Only the *situation* fields and the *who-plays-whom* framing differ.
3. **Data-driven, not code-driven, for content.** A new domain = a new registry
   entry (schema fragment + block list + role framing + default criteria + UI
   field-set). No changes to the render pipeline, gateway, or scoring engine.
4. **Backward compatible.** Existing `templateData` (no `domain` key) parses as
   `customer-support` via the schema default — no data migration.

---

## 3. The domain registry (core abstraction)

A single registry, keyed by domain, is the source of truth. Everything else reads
from it.

```ts
// core/llm/domains/registry.ts
export interface RoleplayDomain<S extends BaseTemplate = BaseTemplate> {
  key: 'customer-support' | 'sales' | 'hr'
  label: string                         // UI display
  // Who the model plays and who the trainee practices as — drives all framing.
  modelRole: string                     // e.g. "customer", "prospect", "employee"
  traineeRole: string                   // e.g. "support agent", "salesperson", "HR manager"
  // Domain-specific situation fields, layered on the shared base schema.
  situationSchema: z.ZodType
  // Ordered prompt blocks for this domain (situation + goal + ending framing).
  blocks: PromptBlock<S>[]
  // Suggested scoring criteria seeded into a new persona of this domain.
  defaultCriteria: { name: string; description: string; maxScore: number }[]
}

export const DOMAINS: Record<DomainKey, RoleplayDomain> = { ... }
```

### 3.1 Schema: shared base + discriminated union

Split `PersonaTemplateSchema` into a **shared base** and a **per-domain
discriminated union** on `domain`:

```ts
const BaseTemplate = z.object({
  domain: z.enum(ROLEPLAY_DOMAINS),
  // shared identity
  personaName, gender, personaAge, contactRef, ...
  // shared dynamics
  emotion, intensity, escalationTriggers, deescalationTriggers,
  hiddenDetails, behaviorNotes, additionalInstructions, openingMessage,
  channels, closingStatement,
  // shared goal — every domain has one
  desiredOutcome, resolutionCriteria,
})

export const PersonaTemplateSchema = z.discriminatedUnion('domain', [
  BaseTemplate.extend({ domain: z.literal('customer-support'), company, issue, productContext, customerProfile }),
  BaseTemplate.extend({ domain: z.literal('sales'),            product, buyingStage, budgetContext, currentObjections, buyerProfile }),
  BaseTemplate.extend({ domain: z.literal('hr'),               employeeRole, tenure, situation, policyContext, sensitivity }),
]).transform(foldLegacyChannel)   // keep existing channel→channels fold
```

Note: some current field *names* are customer-support-specific (`customerName`,
`customerProfile`, `customerContact`, `customerAge`, `accountRef`). Rename the
shared ones to neutral names (`personaName`, `personaAge`, `contactRef`) in the
base; keep `customerProfile` in the support fragment only. This rename touches
templateData reads — see migration (§7).

### 3.2 Blocks: per-domain composition

Today `CUSTOMER_SUPPORT_BLOCKS` (`persona-prompt.template.ts:273`) is a fixed
array of **12** blocks, in this exact order:

```
introBlock, guardrailBlock, identityBlock, situationBlock, emotionBlock,
goalBlock, hiddenBlock, openingBlock, behaviourBlock, endingBlock,
extraBlock, reminderBlock
```

Generalize to:

- **Shared blocks** (domain-agnostic, parametrized by `modelRole`/`traineeRole`):
  `guardrailBlock`, `identityBlock`, `emotionBlock`, `hiddenBlock`, `openingBlock`,
  `behaviourBlock`, `endingBlock`, `extraBlock`, `reminderBlock`.
  ⚠ `identityBlock`, `emotionBlock`, `openingBlock`, `behaviourBlock`,
  `endingBlock` currently carry CS wording ("the way a real customer would",
  "that is the agent's job", "thank the agent") — they must be reworded to read
  `domain.modelRole`/`domain.traineeRole`, not just moved.
- **Per-domain blocks** (in the registry): `introBlock` (who you are / who the
  trainee is), `situationBlock` (`# Why you are contacting support` today, `:183`),
  `goalBlock` framing.

`renderSystemPrompt` becomes:

```ts
export function renderSystemPrompt(input: PersonaTemplateInput): string {
  const t = PersonaTemplateSchema.parse(input)
  const domain = DOMAINS[t.domain]
  return [...SHARED_PRELUDE, ...domain.blocks, ...SHARED_CODA]
    .map((b) => b(t, domain)).filter(Boolean).join('\n\n')
}
```

Every hardcoded "customer"/"support agent" string in the shared blocks reads
`domain.modelRole` / `domain.traineeRole` instead.

### 3.3 Runtime role framing (gateway)

`chat.gateway.ts::voiceRoleLock` (`:243`) hardcodes the support framing
(`:247` `"You are ONLY the customer${name}. The human you are speaking with is
the support agent."`). It must take the domain (or the two role strings) and
template the lock:

```ts
private voiceRoleLock(domain: RoleplayDomain, personaName?: string): string { ... }
```

**Nuance the doc must not gloss:**
- `voiceRoleLock` is fed `wsClient.personaName` — the **Persona row's `name`**
  (e.g. "Double-charged Dana"), *not* `templateData.customerName`. Keep that
  source; only the role nouns come from the domain.
- `resolveSystemPrompt` (`:232`) `safeParse`s `templateData` but **returns a
  string and discards the parsed template** (falling back to the cached
  `persona.systemPrompt` on parse failure, `:236`). Threading `t.domain` out to
  the voice-lock/channel-style injection (`:593`) therefore needs a **signature
  change** — either return `{ prompt, domain }` or resolve the domain separately
  — not merely "gains access to `t.domain`".
- `languageInstruction` (`:258`) also hardcodes "…even if the agent writes in a
  different language" — same injection chain, must be parametrized too.

---

## 4. The three verticals

### 4.1 customer-support (existing)
- **Model plays:** the customer. **Trainee:** support agent.
- **Situation fields:** `company`, `issue`, `productContext`, `customerProfile`.
- **Default criteria:** Empathy, Problem resolution, Communication clarity.

### 4.2 sales (closest to support — build first)
- **Model plays:** the prospect/buyer. **Trainee:** salesperson.
- **Situation fields:** `product` (what's being sold), `buyerProfile`,
  `buyingStage` (cold / evaluating / ready), `budgetContext`, `currentObjections`.
- **Goal reframe:** `desiredOutcome` = what the buyer needs to say yes;
  `resolutionCriteria` = when the buyer commits (or firmly declines → ends).
- **Default criteria:** Discovery/qualification, Objection handling, Value
  articulation, Closing.

### 4.3 hr
- **Model plays:** employee or candidate (scenario-dependent). **Trainee:** HR
  manager / recruiter.
- **Situation fields:** `employeeRole` & `tenure`, `situation` (grievance /
  review / interview / conflict), `policyContext`, `sensitivity` (how guarded).
- **Goal reframe:** `desiredOutcome` = what the employee wants;
  `resolutionCriteria` = when the conversation reaches a fair resolution.
- **Default criteria:** Compliance/fairness, Active listening, De-escalation,
  Documentation-worthy clarity.

> HR has the widest scenario spread (candidate vs employee vs grievance). Consider
> a `scenarioType` sub-enum inside the HR fragment rather than three HR domains.

---

## 5. UI (web builder)

- **New step 0 field: Domain picker** (customer-support / sales / hr). Locked
  after creation? — recommend editable but warn (situation fields differ).
- **Situation step** becomes domain-driven: render the field-set for the selected
  domain (labels, placeholders, hints from the registry). Identity, emotion,
  difficulty, scoring, voice steps stay shared.
- **Scoring step:** prefill `defaultCriteria` for the chosen domain (still editable).
- Types in `web/services/personas.ts` (`interface PersonaTemplate`, `:20`) mirror
  the backend schema (there is no contracts persona schema today — confirmed:
  `packages/contracts` only carries `personaName`/`personaColor`/`personaLanguages`
  on the WS envelope, `realtime.ts:30`. Persona types live web-only). Consider
  promoting to `packages/contracts` so web + api share one source.
- **`buildTemplatePayload` + `OPTIONAL_TEMPLATE_KEYS`** (`services/personas.ts:169`,
  `:184`) hard-read `customerProfile`/`company`/`issue`/`customerAge`/`customerName`/
  `customerContact`/`accountRef` by name. A base rename (§7) or a discriminated
  union touches this builder and its test (`tests/services/personas.test.ts:57`
  asserts `templateData?.company`).

The `LIMITS` map (`persona-builder.tsx:174`) + `LimitedInput`/`LimitedTextarea`
(`:219`/`:238`) extend to the new fields; add their maxes to the base/per-domain
schemas.

### 5.1 Trainee session UI (the surface the design almost missed)

The runtime **session screen** frames roles independently of the builder and has
**no access to `templateData`** — only `session.personaName`:

- `routes/_auth/session/$uid.tsx:167` — `"You are the support agent. ${personaName
  ?? 'The customer'} will open the conversation…"`; `:396` "Waiting for the
  customer to start…".
- `features/roleplay/use-roleplay-session.ts:37` — comment "Ask the customer
  (persona) to open" (cosmetic).

To depersonalize this, the **session payload / contracts envelope must carry the
domain (or the two role strings)** so the UI can render "You are the {traineeRole};
the {modelRole} will open." This is a **contracts change**, not a builder change —
the single most important item the original draft omitted.

### 5.2 Mock renderer

`apps/web/src/mocks/handlers.ts:127` `renderMockPrompt()` hardcodes "roleplaying as
a CUSTOMER contacting a support agent", and `SEED_TEMPLATE`/`VOICE_TEMPLATE`
(`:137`) are flat CS shapes. Update alongside the builder so mock-mode dev
mirrors real multi-domain output.

---

## 6. File-by-file change list

| Area | File | Change |
|---|---|---|
| Schema/blocks | `core/llm/persona-prompt.template.ts` | Split base + discriminated union; registry-driven render; reword the 12 blocks (incl. `hiddenBlock`) to read `domain.modelRole`/`traineeRole`; fix CS leak in `CHANNEL_STYLE.chat` (`:107` "order ID or error code"). |
| Registry | `core/llm/domains/*.ts` (new) | One module per domain: schema fragment, blocks, roles, default criteria, UI field meta. |
| Gateway | `modules/realtime/chat.gateway.ts` | Domain-aware `voiceRoleLock` (`:243`) + `languageInstruction` (`:258`); **change `resolveSystemPrompt` signature** to surface the parsed domain (`:232`); thread into the `:593` injection. |
| Render callers | `modules/personas/personas.service.ts` | `renderSystemPrompt(dto.template)` on **create (`:233`) + update (`:293`)** — re-renders the cached `systemPrompt`; the natural home for "seed default criteria on create" (not the DTO). |
| DTO | `modules/personas/dto/persona.dto.ts` | Inherits union; add per-domain input limits. |
| Scoring | `core/llm/scoring.service.ts` | No engine change, but parametrize the hardcoded "Engage with the **customer**…" unscorable-session feedback (`:38`); optionally add domain to the evaluator preamble. |
| Seed | `prisma/seed.ts` | Seeds are flat CS templates with **no `domain` key** (`:29`+, legacy names) — they parse via the default; add example sales + hr personas, and keep folding legacy names if §7 option 2 lands. |
| Web builder | `components/personas/persona-builder.tsx` | Domain picker + domain-driven situation step + default criteria. |
| Web session UI | `routes/_auth/session/$uid.tsx`, `features/roleplay/use-roleplay-session.ts` | Consume domain roles from the session payload (needs contracts change — §5.1). |
| Web mock | `mocks/handlers.ts` | `renderMockPrompt` + `SEED_TEMPLATE`/`VOICE_TEMPLATE` domain-aware (`:127`/`:137`). |
| Web types + payload | `services/personas.ts` (+ maybe `packages/contracts`) | Discriminated `PersonaTemplate` (`:20`); update `buildTemplatePayload`/`OPTIONAL_TEMPLATE_KEYS` (`:184`/`:169`); neutral shared field names. |
| Contracts | `packages/contracts/src/realtime.ts` | Add `domain`/role strings to the session/WS envelope so the session UI can depersonalize (§5.1). |
| Docs | `PERSONA_PROMPT_ARCHITECTURE.md`, `PERSONA_TEMPLATE_PLAN.md` | Update to multi-domain; link this doc. |
| Tests | `persona-prompt.template.spec.ts`, `tests/components/persona-builder.test.tsx`, `tests/services/personas.test.ts` | Per-domain render + schema validation; the personas.test asserts `templateData?.company` (`:57`) — update for the union. |

---

## 7. Migration & compatibility

- **No DB migration.** `domain` is a JSON key inside `templateData`; existing rows
  lack it and parse as `customer-support` via the schema default.
- **Field renames** (`customerName`→`personaName`, etc.) DO touch existing
  `templateData`. Two options:
  1. Keep the old CS field names inside the `customer-support` fragment (no rename)
     and only use neutral names in new domains. Zero migration, mild inconsistency.
  2. Rename in the base and add a `.transform` that folds legacy keys
     (`customerName ?? personaName`), like the existing `channel`→`channels` fold.
  **Recommend option 2** — one transform, consistent going forward. Reseed
  refreshes seeded personas; user rows fold on read.
- `systemPrompt` is a render-cache; it's re-rendered on save and by the gateway
  fallback, so no stored-prompt migration is needed.

---

## 8. Build plan (phased)

1. **Registry + render refactor** — introduce the registry, move CS into it,
   make `renderSystemPrompt` registry-driven. No behavior change (CS still works).
   Ship + prove via existing tests.
2. **Sales vertical** — add the sales registry entry end-to-end (schema, blocks,
   role-lock, default criteria, UI field-set, seed persona, tests). Proves the seam.
3. **HR vertical** — copy the pattern; decide `scenarioType` sub-enum.
4. **Docs + polish** — update architecture docs, add domain to LangSmith trace
   metadata for per-vertical analytics.

Each phase is independently mergeable; CS is never broken.

---

## 9. Open questions (need decisions)

1. **Field-name migration:** keep CS legacy names or rename base + fold (§7)?
   Recommend fold.
2. **Domain editable after create?** Changing domain invalidates situation fields.
   Recommend: editable with a confirm + situation-field reset.
3. **HR scenario spread:** one `hr` domain with a `scenarioType` sub-enum, or
   separate domains per scenario? Recommend sub-enum.
4. **Types home:** promote `PersonaTemplate` to `packages/contracts` (shared
   web+api source of truth) as part of this, or keep the current web-only mirror?
5. **Scoring defaults:** seed `defaultCriteria` on persona create, or only surface
   as UI suggestions? Recommend seed-on-create, editable.

---

## 10. Complete role-framing hardcode inventory (validated 2026-07-08)

Every place "customer" / "support agent" framing is baked in today. Each must
read `domain.modelRole` / `domain.traineeRole` (or be delivered domain via
payload) before a non-support persona reads correctly. This is the checklist the
build plan (§8) closes against — nothing here may remain a literal.

### Backend — prompt template (`core/llm/persona-prompt.template.ts`)
| Block / const | Line | Hardcoded string (abbrev.) |
|---|---|---|
| `introBlock` | 130 | "roleplaying as a CUSTOMER … SUPPORT AGENT IN TRAINING" |
| `guardrailBlock` | 141 | "support agent", "Stay the customer" |
| `identityBlock` | 175 | "the way a real customer would" |
| `situationBlock` | 183 | heading "# Why you are contacting support" |
| `emotionBlock` | 195 | agent-empathy dynamics |
| `goalBlock` | 206 | "the agent clearly … explains" |
| `hiddenBlock` | 210 | "# Information you hold back" (wording neutral-ish; verify) |
| `openingBlock` | 225 | "the way a real customer would" |
| `behaviourBlock` | 238 | "that is the agent's job" |
| `endingBlock` | 246 | "thank the agent" |
| `reminderBlock` | 261 | "you are the customer … support agent" |
| `CHANNEL_STYLE.chat` | 107 | "order ID or error code" (CS-flavored) |

### Backend — gateway (`modules/realtime/chat.gateway.ts`)
| Site | Line | Note |
|---|---|---|
| `voiceRoleLock` | 243/247 | "You are ONLY the customer … the support agent" |
| `languageInstruction` | 258 | "even if the agent writes …" |
| `resolveSystemPrompt` | 232 | parses `templateData` but discards it → **signature change** needed |
| injection site | 593 | `channelStyleBlock('audio') + languageInstruction + voiceRoleLock` |

### Backend — scoring (`core/llm/scoring.service.ts`)
| Site | Line | Note |
|---|---|---|
| unscorable-session feedback | 38 | "…Engage with the **customer** to earn a score." |

### Frontend
| Site | Line | Note |
|---|---|---|
| `persona-builder.tsx` | 428/473/501/657/903 | "The customer", "Company they contact", "Winning condition" |
| `session/$uid.tsx` | 167/396 | "You are the support agent…", "Waiting for the customer…" — **no `templateData` access → needs domain via session payload (§5.1)** |
| `use-roleplay-session.ts` | 37 | comment "Ask the customer (persona) to open" (cosmetic) |
| `mocks/handlers.ts` | 127/137 | `renderMockPrompt` + `SEED_TEMPLATE`/`VOICE_TEMPLATE` flat CS |
| `services/personas.ts` | 169/184 | `OPTIONAL_TEMPLATE_KEYS` + `buildTemplatePayload` read CS names |

### Non-consumers (safe — shared fields only)
- `routes/_auth/personas/index.tsx:177` reads `templateData?.channels` (shared).
- `voiceRoleLock` reads `Persona.name`, not `templateData.customerName` — leave that source.

> **Definition of done for framing:** grep the repo for `\bcustomer\b`,
> `support agent`, and `the agent` and confirm every hit is either (a) reading a
> domain role string, (b) inside the `customer-support` registry entry, or (c) an
> intentional user-facing CS label. Zero literal role nouns in shared code paths.
