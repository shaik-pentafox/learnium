# Multi-Domain Roleplay Architecture

> Status: **PROPOSED — design review.**
> Goal: extend the persona/roleplay engine beyond `customer-support` to additional
> verticals (**sales**, **hr**) without forking the codebase per vertical.
> Supersedes the "customer-support only" scope in `PERSONA_TEMPLATE_PLAN.md`.

---

## 1. Where we are today

A persona is defined by structured `templateData` fields that a single template
renders into the roleplay system prompt at session start:

```
trainer fills fields ─► renderSystemPrompt(templateData) ─► SystemMessage ─► roleplay graph
```

The `domain` seam already exists but is **inert**:

- `persona-prompt.template.ts` declares `ROLEPLAY_DOMAINS = ['customer-support']`
  and `PersonaTemplateSchema.domain` (defaulted), but `renderSystemPrompt()`
  **ignores `t.domain`** and always composes `CUSTOMER_SUPPORT_BLOCKS`.
- The schema is a **flat customer-support shape** — `company`, `issue`,
  `customerProfile` are required. These are meaningless for HR/Sales.
- Runtime role framing is hardcoded to "customer / support agent" in three places:
  `introBlock`, `guardrailBlock`/`reminderBlock` (template), and `voiceRoleLock`
  (`chat.gateway.ts`).
- The web builder (`persona-builder.tsx`) is worded entirely for support
  ("The customer", "Company they contact", "Winning condition").

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

Today `CUSTOMER_SUPPORT_BLOCKS` is a fixed array. Generalize to:

- **Shared blocks** (domain-agnostic, parametrized by `modelRole`/`traineeRole`):
  `guardrailBlock`, `identityBlock`, `emotionBlock`, `openingBlock`,
  `behaviourBlock`, `endingBlock`, `extraBlock`, `reminderBlock`.
- **Per-domain blocks** (in the registry): `introBlock` (who you are / who the
  trainee is), `situationBlock`, `goalBlock` framing.

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

`chat.gateway.ts::voiceRoleLock` hardcodes the support framing. It must take the
domain (or the two role strings) and template the lock:

```ts
private voiceRoleLock(domain: RoleplayDomain, personaName?: string): string { ... }
```

The gateway already parses `templateData` in `resolveSystemPrompt`; it gains
access to `t.domain` there and threads it into the lock and the channel-style
injection.

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
- Types in `web/services/personas.ts` mirror the discriminated union (there is no
  contracts persona schema today — types live here; consider promoting to
  `packages/contracts` so web + api share one source).

The `LIMITS` map + `LimitedInput`/`LimitedTextarea` (just added) extend to the new
fields; add their maxes to the base/per-domain schemas.

---

## 6. File-by-file change list

| Area | File | Change |
|---|---|---|
| Schema/blocks | `core/llm/persona-prompt.template.ts` | Split base + discriminated union; registry-driven render; parametrize shared blocks by role. |
| Registry | `core/llm/domains/*.ts` (new) | One module per domain: schema fragment, blocks, roles, default criteria, UI field meta. |
| Gateway | `modules/realtime/chat.gateway.ts` | Domain-aware `voiceRoleLock` + channel-style; thread `t.domain`. |
| DTO | `modules/personas/dto/persona.dto.ts` | Inherits union; add per-domain input limits; seed default criteria on create. |
| Scoring | `core/llm/scoring.service.ts` | No engine change; optionally include domain in the evaluator preamble. |
| Seed | `prisma/seed.ts` | Add example sales + hr personas. |
| Web builder | `components/personas/persona-builder.tsx` | Domain picker + domain-driven situation step + default criteria. |
| Web types | `services/personas.ts` (+ maybe `packages/contracts`) | Discriminated `PersonaTemplate`; neutral shared field names. |
| Docs | `PERSONA_PROMPT_ARCHITECTURE.md`, `PERSONA_TEMPLATE_PLAN.md` | Update to multi-domain; link this doc. |
| Tests | `persona-prompt.template.spec.ts`, builder test | Per-domain render + schema validation. |

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
