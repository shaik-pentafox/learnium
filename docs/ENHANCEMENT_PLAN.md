# ALFA Traineon — Enhancement Plan (v1)

Companion to [PRODUCT_PLAN.md](./PRODUCT_PLAN.md) and [BACKEND_PLAN.md](./BACKEND_PLAN.md). This document amends both with seven enhancements decided after the v2 plan was written. Where this document conflicts with the other two, **this document wins**; the follow-up edits to fold these changes back into PRODUCT_PLAN/BACKEND_PLAN are listed in §10.

| # | Enhancement | Type |
|---|---|---|
| E1 | Remove org groupings (groups, domains, cohorts) | Scope cut |
| E2 | Trainee (user) dashboard | Feature |
| E3 | Persona Testing Playground (simulation mode) | Feature |
| E4 | Semantic caching | Cost/latency optimization |
| E5 | Automated context pruning | Cost optimization |
| E6 | BYOK multi-key LLM credential management | Architecture change |
| E7 | Event-driven analytics pipeline (staged OLAP) | Architecture change |

A note on sources: E3–E7 were explored in an external AI-assisted design discussion. That input is treated as **reference, not spec** — §9 lists where this plan deliberately deviates from it and why.

---

## E1 — Remove Org Groupings (Groups, Domains, Cohorts)

Groups, business domains/sub-domains, and training cohorts exist in the legacy app because the original client organization needed them. They are **not part of the product**. Carrying them forward adds join tables, scoping rules, and RBAC complexity for a concept no future customer is guaranteed to share. Multi-tenancy (already on the Phase 6 backlog) is the right future home for organizational structure — designed once, properly, per tenant.

### What gets deleted from the planned schema

- Models: `Group`, `UserGroup`, `Domain`, `SubDomain`, `Cohort`, `UserCohort`.
- FK columns: `Session.groupId/cohortId`, `Persona.domainId`, `PersonaGroup` join table, `Announcement.groupId`, `ImportReport.groupId`, `UserPerformanceScore.cohortId/groupId`, `AnalyticsSessionRollup.groupId/cohortId`.
- Endpoints: all of `/api/v1/groups`, `/api/v1/domains`, `/api/v1/cohorts`.
- Permissions: `groups:*`, `cohorts:*`; every "own-group" qualifier in the RBAC map.

### What replaces the scoping

| Was scoped by group/cohort | Becomes |
|---|---|
| Persona visibility | Per-persona explicit assignment: new `PersonaAssignment` (personaId, userId) join table + an `isPublic` flag on `Persona` (public = visible to all trainees). Trainers assign personas to trainees directly or publish to everyone. |
| Leaderboard views | Two scopes only: **Global** (all trainees) and **My Trainees** (trainer's supervisees — the existing supervisor self-reference on `User` is kept and becomes the only organizational relationship). `UserPerformanceScore` keeps a single global rank + percentile. |
| Trainer analytics scope | Supervisor mapping: a trainer sees analytics for users where `supervisorId = trainer.id` (transitively if needed later). |
| Cohort ranking badges (Top 10% / Podium / Champion) | Computed against the global trainee population. Badge definitions unchanged otherwise. |
| Bulk import group column | Dropped; import optionally sets `supervisorId` by employee id. |

This is a net simplification: RBAC object-level checks reduce to "own data" and "own supervisees", and the leaderboard/rollup unique keys lose two nullable dimensions.

---

## E2 — Trainee (User) Dashboard

PRODUCT_PLAN §3.5 describes the trainee dashboard surface but BACKEND_PLAN never gave it endpoints. It is now a first-class deliverable with a dedicated module (`modules/dashboard`), built in Phase 4 alongside analytics.

### Endpoints (`/api/v1/dashboard`)

| Method | Path | Auth | Returns |
|---|---|---|---|
| GET | `/dashboard/me` | JWT (own) | one aggregate payload: current-month performance score + trend points, global rank (`{rank, of}`), streak (current/longest + 90-day activity heat-map array), badge summary (total, 5 most recent), last 5 sessions with scores, suggested next persona (weakest criterion → persona that exercises it) |
| GET | `/dashboard/me/progress` | JWT (own) | score trend per criterion over time (`?from=&to=&interval=week\|month`) — drives the progress chart |
| GET | `/dashboard/trainer` | JWT TRAINER | supervisee aggregates: avg score, completion rate, active-this-week count, at-risk list (completion < 50% or 2-week declining score), top/bottom performers |

Rules:

- `/dashboard/me` reads **only rollup/gamification tables** (`UserPerformanceScore`, `UserStreak`, `UserBadge`, `AnalyticsUserRollup`) plus a `LIMIT 5` session query — no live aggregation scans. One round trip for the whole dashboard.
- Payload shape lives in `packages/contracts` like everything else; the frontend dashboard page binds to it directly.
- Simulation sessions (E3) are invisible here by construction (they never reach rollups).

---

## E3 — Persona Testing Playground (Simulation Mode)

Before publishing a persona version, a Trainer can chat with it (text first; voice later), watch live token burn, and run a simulated scoring pass — **without any of it counting toward analytics, gamification, leaderboards, or cost dashboards**.

### Isolation design

1. **Schema:** `isSimulation Boolean @default(false)` on `Session` and `LlmLog`. Partial index `ON sessions (createdAt) WHERE is_simulation = true` for cheap purging; rollup queries get `WHERE is_simulation = false` (cheap on the default-false majority).
2. **Entry point:** `POST /v1/sessions` accepts `{simulation: true, personaVersionId}` (TRAINER/SUPER_ADMIN only — guard rejects trainees). A simulation session may target **any persona version, including unpublished drafts** — that is the point. The flag is set server-side at session creation and propagated to every `LlmLog` row written for that session; nothing downstream re-derives it from headers.
3. **Same execution path:** the playground uses the normal chat WS gateway and the normal `score-session` job — no parallel code path to drift. The only branches are:
   - `score-session` writes scores back to the session row but **skips** emitting analytics events (E7) and skips `compute-performance-scores` / `award-badges` / `update-streaks`.
   - The telemetry interceptor ignores simulation traffic.
4. **Live token burn:** the chat gateway already extracts usage per turn for `llm_logs`; for simulation sessions it additionally pushes a `{type: "usage", promptTokens, completionTokens, costUsd, cumulativeCostUsd}` frame to the client after each turn. (Message type added to the WS protocol in `packages/contracts/realtime.ts`.)
5. **Analytics firewall (belt and braces):** every rollup job and the E7 event emitter filter `isSimulation = false`. Two independent layers — emit-side skip and read-side filter — so one regression doesn't poison the leaderboards.
6. **Retention:** simulation sessions are throwaway. `purge-simulation-sessions` job (cron daily) hard-deletes simulation sessions + messages + llm_logs older than `SIMULATION_RETENTION_DAYS` (default 7).
7. **Cost is still real money:** simulation `llm_logs` are excluded from product analytics but **included** in a separate "playground spend" figure on the Super Admin LLM ops dashboard (`GET /llm/usage?includeSimulation=true`, admin-only). Hiding real provider spend entirely would make the cost dashboard lie.

### Frontend

Playground lives inside the persona editor: pick a version → chat panel + running token/cost meter + "Run scoring" button that shows the would-be score per criterion. Banner makes the simulation state unmistakable.

---

## E4 — Semantic Caching

Goal: identical-in-meaning prompts during standard training scenarios get served from cache — zero provider cost, near-zero latency.

### Where it is safe (and where it is not)

A roleplay conversation is multi-turn, persona-specific, and stateful. Naively caching chat completions on the semantic similarity of the latest user message would return answers generated for a **different persona, different version, or different conversation state** — subtly wrong in exactly the way that destroys training quality. So caching is **opt-in per call type**, not global:

| Call type | Cached? | Why |
|---|---|---|
| Persona prompt-enhancement (`/personas/:id/enhance`) | ✅ | stateless, repetitive, ideal |
| Embeddings (E4 itself, future search) | ✅ exact-match | deterministic |
| First assistant turn of a session (the persona's opener) | ✅ keyed per persona+version | same input every session start |
| Mid-conversation chat turns | ❌ by default | context-dependent; only enable per-persona after observing real duplicate-rate data |
| Scoring / feedback | ❌ | every transcript is unique; a cache hit would be a grading error |
| Voice | ❌ | provider-native realtime protocols bypass the gateway |

### Mechanics

- **LiteLLM-native:** `cache: true`, `cache_params.type: redis-semantic`, `similarity_threshold: 0.85` (tunable via admin settings, not hardcoded), embedding model = a cheap registry-configured embedding entry. The NestJS app stays oblivious except for cache-control flags.
- **Cache scoping:** LiteLLM cache-context keys include `personaId:personaVersion` so a hit can never cross personas or versions. `LlmClientService` sets per-request cache flags (`cache: {no-cache: true}`) for the excluded call types.
- **Infra:** semantic cache needs Redis with vector search (RediSearch / Redis Query Engine — Redis 8 includes it; for the no-Docker local dev environment, Redis 8 for Windows via Memurai or WSL; in cluster, `redis-stack`). Falls back gracefully: if the vector module is absent, LiteLLM cache is disabled by config and everything still works.
- **Invalidation:** publishing a new persona version changes the cache key, so stale openers die naturally. Admin "flush LLM cache" button for emergencies.
- **Observability:** cache hits still produce an `llm_logs` row with `cacheHit: true`, `estimatedCostUsd: 0`, real `durationMs`. New field on `LlmLog`. The LLM ops dashboard gets a cache-hit-rate panel — that number is the proof the feature pays for itself, and the data that justifies expanding caching to more call types.

---

## E5 — Automated Context Pruning

Long sessions resend the whole history every turn; token cost grows quadratically with conversation length. Fix: summarize the older portion with a cheap model and send `summary + recent tail` instead.

### Design — summaries are an overlay, never a rewrite

The reference design overwrites old `ChatMessage` rows with a summary block. **Rejected.** The raw transcript is needed by end-of-session scoring, audit, analytics, and "view my session" — destroying it to save tokens corrupts all four. Instead:

1. **New table `SessionSummary`:** `(id, sessionId, upToMessageId, content Text, modelId, tokenCount, createdAt)`. Append-only; latest row wins.
2. **Trigger:** before each LLM turn, the chat service estimates context size (running token tally on the session registry entry — no per-turn tokenizer pass). Over `PRUNING_TRIGGER_TOKENS` (default 8000) → enqueue `prune-session-context` (BullMQ, deduplicated per session via job id `prune:{sessionId}`).
3. **Worker:** takes messages from the last summary cursor up to the (roughly) oldest 50% of current context, sends to the **`summarizerModel` logical role** — a third registry-resolved role next to `conversationModel`/`scoringModel`, defaulting to the cheapest enabled fast model — with a fixed prompt: *"Summarize this roleplay interaction concisely. Retain all facts established, trainee decisions, commitments made by either party, and the persona's current emotional state."* Writes a new `SessionSummary` row that **incorporates the previous summary** (rolling compaction), advances the cursor.
4. **Context assembly:** the chat service builds prompts as `system prompt + latest summary (as a system message) + messages after upToMessageId`. If the pruning job hasn't finished yet, the next turn simply sends the unpruned history — pruning is async and best-effort, never blocks a live turn.
5. **Scoring unaffected:** `score-session` always reads the full raw transcript. Summaries are a prompt-assembly artifact only.
6. **Crash safety:** summary lives in Postgres, cursor in both Postgres and the Redis session registry — a resumed session on another pod assembles identical context.
7. **Voice:** same mechanism applies to voice sessions where the provider lets us control conversation context (Gemini Live session resumption with context). Where it doesn't, providers manage their own context window — out of scope.
8. **Cost accounting:** summarization calls log to `llm_logs` with `mode: "prune"` — pruning spends tokens to save tokens, and the dashboard must show both sides.

Tunables (admin settings, not env): trigger threshold, tail size to keep verbatim, summarizer role mapping.

---

## E6 — BYOK Multi-Key LLM Credential Management

**Requirement change.** The v2 plan stored a `credentialRef` (secret-manager name) per provider and seeded a static model list. New reality: the **platform admin brings the keys** — several Gemini keys, OpenAI keys, an OpenRouter key — manages them entirely from the admin UI at runtime, sets each key's RPM/TPM, and the platform load-balances 1000+ users across the pool. **No model or key data ships in seeds or env; everything is admin-entered.** Keys live in our database, encrypted.

### 6.1 Encryption at rest

- One secret stays in env: `MASTER_ENCRYPTION_KEY` (32 bytes, base64). Everything else moves to the DB.
- `CryptoService` (`core/crypto`): AES-256-GCM via Node `crypto`. Encrypt on write; store `{encryptedKey, iv, authTag, keyVersion}`. `keyVersion` enables master-key rotation (background job re-encrypts rows under the new master key).
- API keys are **write-only** through the API: create/replace yes, read back never. `GET` responses return `keyMasked: "sk-...x7Qp"` (first 3 + last 4) and metadata only. Decryption happens in exactly one place: the LiteLLM sync service.
- Audit log records key create/rotate/disable events (actor, provider, masked key) — never plaintext.

### 6.2 Schema delta

```prisma
model LlmProvider {            // unchanged role: one row per provider TYPE config
  id        Int          @id @default(autoincrement())
  name      String       @unique
  type      ProviderType                  // OPENAI | GEMINI | AZURE_OPENAI | OPENROUTER | CUSTOM
  baseUrl   String?                       // for CUSTOM / azure endpoints
  isEnabled Boolean      @default(true)
  credentials LlmCredential[]
  models    LlmModel[]
  // monthlyBudgetUsd, audit columns as before — credentialRef REMOVED
}

// NEW — many keys per provider, each with its own limits
model LlmCredential {
  id            Int         @id @default(autoincrement())
  providerId    Int
  provider      LlmProvider @relation(fields: [providerId], references: [id])
  label         String                      // "OpenAI key #2 (billing acct B)"
  encryptedKey  String
  iv            String
  authTag       String
  keyVersion    Int         @default(1)     // master-key rotation support
  rpm           Int?                        // admin-entered requests/min limit
  tpm           Int?                        // admin-entered tokens/min limit
  isActive      Boolean     @default(true)
  healthStatus  String      @default("unknown")  // ok | rate_limited | auth_failed — from gateway signals
  lastErrorAt   DateTime?
  createdBy     Int?
  createdAt     DateTime    @default(now())
  modifiedBy    Int?
  updatedAt     DateTime    @updatedAt
  @@map("llm_credentials")
}

model LlmModel {
  // as before (name, displayName, capabilities, contextWindow, prices, flags) PLUS:
  alias  String   // model-group alias exposed to the app, e.g. "primary-chat"
  // a model row = (alias → provider model slug); same alias across rows = one balanced pool
}
```

Persona logical roles (`conversationModel`, `scoringModel`, `summarizerModel`) now resolve to an **alias**, and the gateway picks the concrete deployment/key.

### 6.3 LiteLLM integration — config push, our DB is the source of truth

LiteLLM offers `store_model_in_db: true` plus a Management API (`POST /model/new`, `POST /model/delete`). We use the Management API as a **sync target, not a second database**:

- NestJS Postgres is the single source of truth (encrypted). The existing `sync-llm-registry` BullMQ job becomes a full **reconciler**: on any provider/credential/model change (and on a 5-minute cron as drift repair), it decrypts in memory, diffs desired state against `GET /model/info`, and issues create/delete calls. Gateway restart or redeploy → reconciler restores everything within one cycle; no manual re-entry.
- One LiteLLM **deployment** is registered per `(model, credential)` pair, all under the model's `alias`, carrying the admin-entered `rpm`/`tpm`:

```json
{
  "model_name": "primary-chat",
  "litellm_params": {
    "model": "openai/gpt-4o",
    "api_key": "<decrypted in memory only>",
    "rpm": 500,
    "tpm": 100000
  },
  "model_info": { "id": "alfa-cred-12-model-4" }
}
```

- **Routing strategy:** `usage-based-routing-v2` (rate-limit aware, Redis-backed) so a 1000-RPM key receives proportionally more traffic than a 100-RPM key; LiteLLM cooldowns + automatic retry on a sibling deployment absorb 429s and dead keys invisibly to the app.
- **Cross-provider fallbacks** stay as per-alias ordered lists in gateway config (e.g. `primary-chat → fallback-chat`), per the v2 plan.
- **Health feedback loop:** the reconciler polls `GET /model/info` + gateway error metrics and writes `healthStatus`/`lastErrorAt` back to `LlmCredential`, so the admin UI shows per-key health (ok / rate-limited / auth-failed) without exposing the key.

### 6.4 Admin API delta (`/api/v1/llm`)

| Method | Path | Notes |
|---|---|---|
| GET | `/llm/providers/:id/credentials` | masked list with health, rpm/tpm, label |
| POST | `/llm/providers/:id/credentials` | `{label, apiKey, rpm?, tpm?}` → encrypted insert → reconcile |
| PATCH | `/llm/credentials/:id` | label/rpm/tpm/isActive; `{apiKey}` present = key replacement (re-encrypt) |
| DELETE | `/llm/credentials/:id` | deactivate (rows never hard-deleted; audit) → reconcile removes gateway deployments |
| POST | `/llm/credentials/:id/verify` | one decrypted test call (`/models` list or 1-token completion) → updates healthStatus |
| POST | `/llm/sync` | force reconciliation now |

`POST /llm/models` gains `alias`; the verify endpoint is what makes admin key-entry self-service (instant "this key works" feedback).

All under `llmops:write` (SUPER_ADMIN). Rate-limited; key material redacted from logs by pino redaction paths.

### 6.5 What this deletes

- `credentialRef` + the External-Secrets dependency for LLM keys (External Secrets still handles infra secrets: DB password, JWT secrets, master key).
- Static `llm_providers`/`llm_models` seed rows. First-run admin onboarding flow ("add your first provider key") replaces them.
- Any static `model_list` in `litellm_config.yaml` — the file keeps only settings (cache params, routing strategy, master key).

---

## E7 — Event-Driven Analytics Pipeline (Staged OLAP)

The reference input is right about the disease — OLTP and OLAP on one database eventually fight — and premature about the cure (ClickHouse on day one). A second database engine is a permanent ops tax: backups, upgrades, monitoring, a second query dialect, data-consistency reconciliation. At launch volume (hundreds–low-thousands of trainees), PostgreSQL handles both sides comfortably **if reads go through rollups**, which the v2 plan already does.

So: **build the event spine now (cheap, structural), defer the OLAP engine until metrics demand it.**

### Stage 1 — ship at launch

1. **Event emitter (`core/events`):** typed domain events published to **Redis Streams** (durable, consumer groups, replayable — chosen over pub/sub which drops messages when no consumer is listening): `session.started`, `session.completed`, `message.sent`, `score.calculated`, `tokens.consumed`, `badge.earned`, `user.active`. Envelope: `{eventId (uuid), type, occurredAt, userId, payload, version}`. Emitters skip simulation traffic (E3).
2. **Ingestion worker:** BullMQ-driven consumer-group reader drains the stream into an append-only `analytics_events` table (monthly-partitioned, separate `analytics` Postgres schema), `eventId` unique for idempotency.
3. **Rollups become event consumers:** `compute-performance-scores`, `award-badges`, `update-streaks`, and the daily rollup jobs trigger off `session.completed` events instead of being called inline by the session service. The session-end request path now does nothing but persist + emit — gamification, scoring rollups, and dashboards are fully decoupled from request latency.
4. **Dashboards keep reading Postgres rollup tables.** No new query engine, no new infra.

This stage costs little and buys: replayable history (rebuild any rollup from the event log), decoupled write path, and an OLAP-ready feed already shaped as events.

### Stage 2 — when triggered, not before

**Triggers (any one):** dashboard rollup queries p95 > 2 s, `analytics_events` ingest interfering with OLTP latency, or > ~50 M events.

**Then:** point the ingestion worker at **TimescaleDB first** (Postgres extension — same dialect, same backups, hypertables + continuous aggregates replace hand-rolled rollup jobs; verify extension support for the deployed Postgres major version, e.g. 18, before committing — fall back to native partitions + rollups if lagging). **ClickHouse only if** Timescale also saturates — at that scale the second-engine ops tax is justified. Because Stage 1 normalized everything into a replayable event stream, this swap is an ingestion-worker change, not an application change.

---

## 8. Consolidated Deltas

### New / changed background jobs

| Queue | Job | Trigger | Enhancement |
|---|---|---|---|
| `events` | `ingest-analytics-events` | Redis Stream consumer | E7 |
| `pruning` | `prune-session-context` | token threshold, deduped per session | E5 |
| `cleanup` | `purge-simulation-sessions` | cron daily | E3 |
| `registry` | `sync-llm-registry` | becomes full reconciler: change-triggered + 5-min cron | E6 |
| `crypto` | `rotate-master-key` | manual admin action | E6 |
| `gamification`/`rollup` jobs | now consume `session.completed` events; all filter `isSimulation = false` | E3, E7 |
| — | `weekly-ranking-badges` / `compute-performance-scores` | global + supervisee scope instead of cohort/group | E1 |

### New env vars

```env
MASTER_ENCRYPTION_KEY=            # base64 32 bytes — the ONE LLM-related secret left in env (E6)
SIMULATION_RETENTION_DAYS=7      # E3
PRUNING_TRIGGER_TOKENS=8000      # E5 default; runtime-overridable in admin settings
REDIS_URL=                        # unchanged, but Redis must include vector search for E4 (redis-stack / Redis 8)
```

Removed: per-provider key references; LiteLLM static model list.

### Schema delta summary

| Change | Models |
|---|---|
| Removed (E1) | `Group`, `UserGroup`, `Domain`, `SubDomain`, `Cohort`, `UserCohort`, `PersonaGroup` + all referencing FK columns |
| Added (E1) | `PersonaAssignment`; `isPublic` on `Persona` |
| Added (E3) | `isSimulation` on `Session`, `LlmLog` |
| Added (E4) | `cacheHit` on `LlmLog` |
| Added (E5) | `SessionSummary`; `mode: "prune"` value on `LlmLog` |
| Added (E6) | `LlmCredential`; `alias` on `LlmModel`; `credentialRef` removed from `LlmProvider` |
| Added (E7) | `analytics_events` (partitioned, `analytics` schema) |

### Roadmap integration (amends BACKEND_PLAN §6)

| Phase | Additions |
|---|---|
| Phase 0 | `core/crypto` + master-key handling; Redis Streams plumbing in `core/events`; redis-stack in compose |
| Phase 1 | E1 applied to the schema **before** first migration — groupings never get built |
| Phase 2 | `SessionSummary` table + context-assembly logic (pruning worker can land in P3) |
| Phase 3 | E6 in full (replaces the v2 registry credential design); E4 cache config + `cacheHit` logging; E5 worker; E3 simulation flag + playground WS usage frames |
| Phase 4 | E2 dashboard module; E7 Stage 1 (event spine + ingestion + jobs converted to consumers); playground-spend panel |
| Phase 5 | unchanged; load tests add cache-hit-rate and key-pool-exhaustion scenarios |
| Phase 6 | E7 Stage 2 evaluation against triggers; multi-tenancy groundwork inherits E1's clean slate |

---

## 9. Deviations from the Reference Input (and why)

| Reference suggestion | This plan | Why |
|---|---|---|
| Pruning worker **overwrites** old chat rows with the summary | Append-only `SessionSummary` overlay; raw transcript immutable | scoring, audit, session-replay, and analytics all need the raw transcript; destroying source data to save prompt tokens is a category error |
| Global semantic cache on all chat completions | Opt-in per call type, keyed by persona+version | a semantic hit from another persona/conversation state is a wrong answer delivered confidently — worst possible failure mode for a training product |
| Simulation flag via client header read downstream | Flag set server-side at session creation, propagated; double filter (emit-side + read-side) | client headers are spoofable and headers don't survive job boundaries; defense in depth on the analytics firewall |
| Simulation cost "evaporates" | Excluded from product analytics, visible as separate playground spend | provider invoices don't evaporate; admin cost dashboard must reconcile with reality |
| ClickHouse + event sourcing from day one | Event spine now, Postgres rollups stay; Timescale → ClickHouse behind explicit scale triggers | second database engine = permanent ops tax; unjustified at launch volume; event spine preserves the upgrade path at near-zero cost |
| Redis Pub/Sub for events | Redis Streams + consumer groups | pub/sub drops events when consumers are down; analytics needs durability and replay |
| LiteLLM `store_model_in_db: true` as the config store | LiteLLM Management API as sync **target**; our encrypted Postgres is the single source of truth, reconciler repairs drift | two sources of truth for credentials guarantees drift; our DB must own keys anyway for encryption, audit, masking, and rotation |
| Keys readable to whoever queries the table | AES-256-GCM with key-version rotation, write-only API, masked reads, single decryption point, log redaction | standard credential-vault hygiene |

---

## 10. Follow-up Doc Edits

> **Status: applied.** E1–E7 have been folded back into PRODUCT_PLAN and BACKEND_PLAN (schema, endpoints, jobs, RBAC, env, phases) and FRONTEND_PLAN (dashboard, playground, BYOK key admin, global/my-trainees leaderboard). The Content Library ("Curate") concept was also removed from all three docs. This list is retained as the change map.

Fold-back tasks (now applied):

1. PRODUCT_PLAN §2/§3: remove group/cohort scoping from roles table, leaderboard views (→ Global + My Trainees), and dashboard descriptions; add playground to Trainer role.
2. PRODUCT_PLAN §5.4: replace `credentialRef` design with E6 summary.
3. BACKEND_PLAN §7: apply schema deltas (§8 above); §8 endpoint tables: drop groups/domains/cohorts, add dashboard + credentials endpoints; §11 jobs table; §12 RBAC map (remove group rows, add `dashboard`, `llm-credentials` rows).
4. FRONTEND_PLAN: add trainee dashboard page, persona playground panel, LLM key-management admin screens (with masked-key + health UI).
