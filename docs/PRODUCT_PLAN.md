# ALFA Learnium — Product & Architecture Plan (v2)

**Goal:** turn the existing backend into a production-grade, cloud-agnostic, open-source-first AI roleplay training platform, with a clean, professional web frontend.

**LLM strategy in one line:** model providers are configuration, not code. The platform must run against **OpenAI, Google Gemini, Azure OpenAI, and OpenRouter** (and any future OpenAI-compatible provider, including self-hosted open-source models) by changing config only.

**Implementation:** the backend is rebuilt in **NestJS (TypeScript)** — see [BACKEND_PLAN.md](./BACKEND_PLAN.md) for the detailed stack, structure, and delivery phases. The LiteLLM gateway makes this safe: all LLM traffic is OpenAI-format config, so no Python-only tooling is required. The existing FastAPI app remains the reference implementation and keeps serving until cutover.

---

## 1. What Exists Today (Functional Inventory)

| Domain | What it does |
|---|---|
| **Auth & Identity** | Encrypted login payload, JWT (HS256), pluggable credential check (local seeded users for dev, external corporate auth API for production) |
| **User Management** | Users CRUD, roles (Super Admin / Admin / Trainer / Moderator / User), organizational groupings (job categories, business domains, training cohorts), supervisor mapping, bulk XLSX/CSV import, profile photo + AI-generated avatar |
| **Roleplay Personas** | AI persona definitions with versioning, custom instructions, scoring configuration, feedback prompts, voice styles; LLM-assisted prompt enhancement |
| **Realtime Chat** | Text roleplay over WebSocket (LangGraph-based session engine; legacy direct-Gemini path still present) |
| **Realtime Voice** | Live voice roleplay over WebSocket — Gemini Live and Azure VoiceLive backends, PCM16 audio streaming |
| **Session Scoring** | End-of-session LLM-generated feedback and per-criterion scores against the persona's scoring config |
| **Content Library ("Curate")** | Training videos/documents in object storage, group-scoped visibility, soft-delete/restore/archive, like/dislike reactions, configurable UI action buttons |
| **Analytics** | Session, completion, and score dashboards by cohort, user, persona, and version; Excel exports |
| **LLM Observability** | Token usage and cost per model/session, trends, exports — backed by an `llm_logs` table plus a model-pricing table (already a solid foundation) |
| **Telemetry & Audit** | Per-request user-activity tracking, daily stats, Postgres audit triggers on core tables |

Data model: ~25 PostgreSQL tables covering the above. Conversation history, sessions, scores, LLM logs, telemetry, and audit logs are the high-growth tables.

Current LLM topology: a homegrown provider-assignment class spreads users across Gemini / Azure OpenAI / Vertex by registration order to balance quota, with LangChain fallback chains. Voice and the legacy chat path bind directly to vendor SDKs.

---

## 2. Roles & Access Model

Three roles. No more.

| Role | Who | What they can do |
|---|---|---|
| **Super Admin** | Platform operator | Full control: manage users, groups, cohorts, personas, content, LLM registry, analytics, LLM ops, gamification config, system settings |
| **Trainer** | Facilitators, L&D staff | Configure personas (instructions, scoring criteria, voice, model roles), manage content library, view analytics for their groups, view leaderboards |
| **User (Trainee)** | End learners | Practice roleplay sessions (text + voice), view own session history and scores, view own badges and leaderboard rank within their cohort, browse content |

Role is set at account creation. One role per user. Super Admin assigns roles.

---

## 3. Gamification & Leaderboard System

Core product differentiator. Turns individual sessions into a visible progression arc — motivates volume and consistency, not just completion.

### 3.1 What we measure

Every completed session produces raw signals. These feed three parallel tracks:

| Signal | Source |
|---|---|
| **Session score** | LLM-scored criteria, 0–10 per criterion, averaged to 0–100 |
| **Completion rate** | completed / started sessions (rolling 30 days) |
| **Consistency** | sessions completed per week vs a configurable target |
| **Streak** | consecutive calendar days with at least one completed session |
| **Volume** | total sessions and total practice time |
| **Improvement** | score delta vs same period last month (handles new-user bootstrap) |
| **Speed / latency** | avg user response latency across sessions (lower = more confident) |

### 3.2 Performance Score (composite, 0–100)

Computed per user per period (weekly, monthly, all-time) by the `compute-performance-scores` worker job after each session end and on daily rollup.

```
Performance Score =
  (avg_session_score        × 0.40)   // quality
+ (completion_rate          × 0.20)   // follow-through
+ (consistency_score        × 0.15)   // regularity vs target
+ (improvement_delta_norm   × 0.15)   // growth trajectory
+ (streak_bonus             × 0.10)   // habit streak (capped at 100)
```

`consistency_score` = min(sessions_this_week / target_sessions_per_week, 1) × 100.  
`streak_bonus` = min(current_streak / 30, 1) × 100.  
`improvement_delta_norm` = clamped delta / 20 points (20-point improvement = full score).

### 3.3 Leaderboard views

| View | Scope | Default sort |
|---|---|---|
| **Cohort** | users in same cohort | Performance Score (monthly) |
| **Group** | users in same group | Performance Score (monthly) |
| **Global** | all users in org (Super Admin / Trainer only) | Performance Score (monthly) |

Time periods: **this week / this month / all time**.  
Columns visible: rank, name, avatar, performance score, sessions count, avg score, current streak, badges count.  
User sees their own row highlighted and pinned at bottom if not in top N.

### 3.4 Badges

Earned once (some re-earnable monthly). Displayed on profile and leaderboard row. Configured in `badge_definitions` table — Super Admin can create/edit.

**Milestone badges (earned for cumulative volume):**

| Badge | Trigger | Tier |
|---|---|---|
| First Step | Complete first session | Bronze |
| Getting Started | 10 sessions | Bronze |
| Dedicated | 25 sessions | Silver |
| Expert | 50 sessions | Gold |
| Elite | 100 sessions | Platinum |
| Hour Glass | 1 h total practice | Bronze |
| Marathon | 10 h total practice | Gold |

**Performance badges (score-based):**

| Badge | Trigger | Tier |
|---|---|---|
| Sharp | Rolling 7-day avg score ≥ 70 | Bronze |
| Advanced | Rolling 7-day avg score ≥ 85 | Silver |
| Master | Rolling 7-day avg score ≥ 95 | Gold |
| Perfect Session | All criteria 10/10 in one session | Gold |

**Consistency / streak badges:**

| Badge | Trigger | Tier |
|---|---|---|
| On a Roll | 3-day streak | Bronze |
| Committed | 7-day streak | Silver |
| Unstoppable | 30-day streak | Gold |
| Iron Will | 60-day streak | Platinum |

**Improvement badges (monthly, re-earnable):**

| Badge | Trigger | Tier |
|---|---|---|
| Rising Star | Score improved ≥ 20% vs last month | Silver |
| Most Improved | Top improver in cohort this month | Gold |

**Ranking badges (weekly/monthly, re-earnable):**

| Badge | Trigger | Tier |
|---|---|---|
| Top 10% | In top 10th percentile of cohort | Silver |
| Podium | Top 3 in cohort this month | Gold |
| Champion | Rank 1 in cohort this month | Platinum |

Badge tiers render with distinct colors: Bronze → Silver → Gold → Platinum. Earning a badge triggers an in-app toast + animation. Badge history shows when and for what session/period each was earned.

### 3.5 Dashboard surfaces by role

**Trainee dashboard:**
- Own performance score card (current month) with trend spark-line
- Own rank in cohort (e.g. "12 / 47") with position indicator
- Badge shelf — recent and rare badges, total badge count
- Streak counter with calendar heat-map (GitHub-style)
- Session history: last 5 with scores, "continue practicing" CTA
- Suggested next persona based on weakest criterion score

**Trainer dashboard:**
- Cohort leaderboard (top 10 + own trainees highlighted)
- Group-level aggregates: avg score, completion rate, active users this week
- Score breakdown by persona and criterion
- At-risk users: low completion rate or declining scores flagged
- Content engagement stats (video/doc views, reactions)

**Super Admin dashboard:**
- Org-wide leaderboard + global KPIs
- LLM cost + token usage charts
- User growth, active users (WAU/MAU), session volume
- Badge economy stats (which badges are rare vs common)
- System health (API latency, WS sessions live, job queue depth)

---

## 4. Gap Analysis — What Is Missing / Broken

### 4.1 Security (CRITICAL — fix before anything else)

| # | Issue | Fix |
|---|---|---|
| S1 | SQL injection via f-string interpolation in 4 query sites (group create/update, record-by-id, search) | Parameterized queries everywhere; CI rule banning f-strings in SQL |
| S2 | 15+ unauthenticated endpoints (entire analytics + LLM dashboards, user list/detail, user search, session history) | Default-deny: global auth dependency, explicit public opt-out |
| S3 | CORS wildcard origins combined with credentials | Env-driven origin allowlist |
| S4 | AES-ECB used for the login payload | TLS-only; if payload encryption is contractually required → AES-GCM with random nonce |
| S5 | No RBAC enforcement — any authenticated user can create users, groups, personas | Permission layer on the existing role model |
| S6 | Broken object-level access control — per-user dashboards and group mappings readable for any user id | Ownership/role checks per resource |
| S7 | No rate limiting (login brute-force, upload abuse) | Redis-backed limiter; strict bucket on login |
| S8 | Seeded default accounts with plaintext passwords in source | Hash seeds, rotate credentials, move out of source |
| S9 | No refresh tokens / revocation; logout is a no-op | Short-lived access token (15 min) + rotating refresh tokens with reuse detection |
| S10 | No file-upload validation (size/extension/content-type) | Allowlist + size caps + content sniffing |

### 4.2 Scalability (blocks horizontal scale today)

| # | Issue | Impact |
|---|---|---|
| C1 | All LLM/voice session state lives in process memory (session dicts, connection manager, in-memory LangGraph checkpointer) | Cannot run more than one replica; a crash loses every active session |
| C2 | User→provider assignment is in-memory registration order | Resets on restart; differs per replica |
| C3 | Telemetry middleware performs a synchronous DB write on every HTTP request | Thread-pool and DB churn under load |
| C4 | Connection-pool sizing exceeds the Postgres connection limit when multiple instances run | Pool exhaustion |
| C5 | Dashboard endpoints run massive multi-CTE scans with no caching or pagination | Timeouts as data grows |
| C6 | Bulk-import concurrency exceeds DB pool size | Deadlock risk |
| C7 | No WebSocket reconnect/session-resume contract | Flaky networks drop sessions irrecoverably |

### 4.3 Engineering hygiene

- **No migrations** (tables auto-created at startup, seeds run at boot) — no schema versioning or rollback.
- **No tests**, no CI, no lint config.
- **No containers**, no IaC, no deploy pipeline.
- **Errors returned as HTTP 200** with an error body — breaks standard HTTP clients and monitoring.
- **~180 bare `except Exception`** blocks; unstructured logging; no request IDs, tracing, or metrics.
- **Dependency chaos**: unpinned core libraries, no lock file, duplicate packages, deprecated crypto/password libs.
- **POST used for updates** throughout; duplicated endpoints; wrong status codes (204 as an error).

### 4.4 Missing product capabilities (backlog)

- API versioning (`/api/v1/...`) — prerequisite for any frontend work.
- Admin-manageable LLM provider/model configuration (see §5.4 — currently hardcoded).
- **Gamification & leaderboard system** (see §3) — not built.
- Notification system (session completed, feedback ready, badge earned, content published).
- Search across content/personas (Postgres full-text now; pgvector semantic search later).
- Multi-tenancy readiness (tenant scoping strategy) — current design is single-organization.
- Data retention & right-to-deletion (chat history is PII-adjacent and grows unbounded).
- Offline persona evaluation (prompt regression testing) so model/provider swaps are safe.
- Webhook/event surface for LMS integrations (SCORM/xAPI is the standard training-industry ask).

---

## 5. Target Architecture

### 5.1 Principles

1. **Open-source-first.** No closed-source licensed dependencies. Every infrastructure component is self-hostable and also available as a managed service on any major cloud.
2. **Cloud-agnostic.** Containers + Kubernetes as the deployment unit; cloud services consumed only through abstractions (storage, cache, queue). Which cloud runs it is a deployment choice, never an architecture one.
3. **Provider-agnostic LLM layer.** OpenAI, Gemini, Azure OpenAI, OpenRouter, and any OpenAI-compatible endpoint (vLLM, Ollama, Together, Groq…) are interchangeable config entries.
4. **Modular monolith first, services when forced.** One FastAPI app with strict module boundaries; the realtime gateway is the first (and likely only) component that splits out, because long-lived WebSocket connections scale differently than REST.
5. **Stateless app tier.** All session state externalized to Redis/Postgres so replicas are interchangeable.

### 5.2 System diagram

```
                        ┌─────────────────────────────────────────────┐
                        │            Frontend (TBD later)             │
                        └──────────────┬──────────────────────────────┘
                                       │ HTTPS / WSS
                        ┌──────────────▼──────────────┐
                        │   Ingress / API Gateway     │  TLS, WAF, rate limits,
                        │                             │  sticky sessions for WS
                        └───────┬─────────────┬───────┘
                                │             │
              ┌─────────────────▼──┐   ┌──────▼──────────────────┐
              │   alfa-api (REST)  │   │ alfa-realtime (WS/voice) │
              │   FastAPI, N pods  │   │ FastAPI, N pods          │
              │   users/personas/  │   │ chat WS, voice WS,       │
              │   content/analytics│   │ end-session scoring      │
              └───┬────────┬───────┘   └───┬──────────┬───────────┘
                  │        │               │          │
        ┌─────────▼─┐   ┌──▼───────────────▼──┐   ┌───▼────────────────┐
        │ PostgreSQL │   │  Redis              │   │  LLM Gateway       │
        │ +PgBouncer │   │  session state,     │   │  (LiteLLM proxy)   │
        │ +pgvector  │   │  pub/sub, rate      │   │  OpenAI / Gemini / │
        │ +Alembic   │   │  limits, cache      │   │  Azure OpenAI /    │
        └─────┬──────┘   └─────────────────────┘   │  OpenRouter / vLLM │
              │                                    └────────────────────┘
        ┌─────▼──────────┐   ┌──────────────────┐  ┌────────────────────┐
        │ Object storage │   │  Worker (arq)    │  │  Observability     │
        │ S3-compatible  │   │  bulk imports,   │  │  OTel → Prometheus │
        │ interface      │   │  exports, stats  │  │  Grafana, Loki,    │
        │                │   │  rollups, purge  │  │  Tempo, Sentry OSS │
        └────────────────┘   └──────────────────┘  └────────────────────┘
```

### 5.3 Component choices (all open-source, run anywhere)

| Concern | Choice | Notes |
|---|---|---|
| Compute | Containers on Kubernetes (Helm) | any managed K8s or k3s on a VM |
| Database | PostgreSQL 16 + PgBouncer + Alembic | pgvector extension reserved for semantic search |
| Cache / sessions / pub-sub | Redis 7 (or Valkey) | session registry, rate limits, queues |
| Object storage | S3-compatible interface | works against any cloud blob store or self-hosted MinIO |
| Background jobs | arq | async-native, Redis-backed, no extra broker |
| LLM gateway | LiteLLM proxy (OSS) | see §3.4 |
| Realtime voice (future OSS path) | LiveKit (WebRTC SFU) + open STT/TTS | reserved; managed voice APIs remain primary for now |
| Metrics / traces / logs | OpenTelemetry → Prometheus + Grafana + Loki + Tempo | fully OSS stack |
| Error tracking | Sentry (self-hosted) or GlitchTip | |
| CI/CD | pipeline in the existing repo host | build → test → scan → push → Helm deploy |
| IaC | Terraform/OpenTofu | one set of modules; cloud picked per environment |
| Secrets | External Secrets Operator → any secret manager (or Vault/OpenBao) | |

### 5.4 Configurable LLM provider layer (core requirement)

**Today:** provider choice is hardcoded — a registration-order spreader across Gemini/Azure/Vertex, plus direct SDK calls in voice and legacy chat. Adding a provider means code changes in several files.

**Target:** two cooperating pieces —

1. **LiteLLM gateway (OSS, in-cluster).** The app speaks one OpenAI-format API to the gateway. The gateway holds provider credentials and routes by model name with built-in load balancing, fallbacks, retries, per-key budgets, and spend logging. Supported out of the box: **OpenAI, Google Gemini, Azure OpenAI, OpenRouter**, Anthropic, Vertex, and any OpenAI-compatible endpoint (vLLM, Ollama, Together, Groq…). This deletes the homegrown quota spreader.

2. **Provider/model registry in the database (admin-configurable).** Extends the existing model-pricing table:

   | Table | Purpose |
   |---|---|
   | `llm_providers` | provider type (openai / gemini / azure_openai / openrouter / custom), base URL, credential reference (secret name — never the key itself), enabled flag, priority |
   | `llm_models` | model name, provider FK, capabilities (chat / streaming / voice / vision), context window, input/output price per million tokens, default flag |
   | persona config | each roleplay persona references models by logical role ("conversation model", "scoring model") resolved through the registry — never a hardcoded model string |

   Admin API (`/api/v1/llm/providers`, `/api/v1/llm/models`) to add/disable providers and models at runtime; registry changes sync to the gateway config. Swapping the whole platform from Gemini to OpenRouter = insert rows, flip defaults, zero deploys.

**Routing & resilience rules:**
- Every persona resolves to a primary model + ordered fallback list (e.g. `gemini-2.5-flash → gpt-4o-mini → openrouter/llama-3.3-70b`).
- Health/error-rate signals from the gateway demote failing providers automatically.
- Cost guardrails: per-provider monthly budget in the registry; gateway enforces, dashboard reads actuals from `llm_logs` reconciled with gateway spend logs.
- Prompt-regression suite (§6) runs against any candidate model before it can be promoted to default — model upgrades become safe, routine config changes.

**Voice:** realtime voice is the one place providers expose non-OpenAI-compatible protocols. Keep Gemini Live and Azure VoiceLive as the two managed backends behind a single `VoiceProvider` interface (connect / send-audio / receive-audio / interrupt / end), selected per persona or per request from the same registry. OpenAI Realtime can join as a third implementation; an OSS pipeline (LiveKit + open STT/TTS) is the long-term exit door.

### 5.5 Application structure

Modular monolith with strict module boundaries — `core` (config, auth, db, storage, cache, llm) plus domain modules (identity, personas, sessions, realtime, content, analytics, llmops) and background workers. Transport layers do HTTP/WS only; services hold business logic; repositories own data access. Detailed structure in [BACKEND_PLAN.md §2](./BACKEND_PLAN.md).

### 5.6 Realtime scaling design

Today a WebSocket session is an object in one process. Target:

1. **Session registry in Redis**: session id → state, provider, model, history cursor, last-seen. TTL cleanup.
2. **Conversation state in Postgres** (chat history + registry cursor) — survives restarts, replica-independent.
3. **Sticky routing** for live connections (ingress session affinity); on disconnect any pod resumes from Redis + Postgres state.
4. **Reconnect contract**: client sends session id + last message id; server replays the delta from chat history and resumes.
5. **Graceful drain**: SIGTERM → stop accepting, tell clients to reconnect, flush state, exit.
6. **Backpressure**: bounded queues with overflow policy (drop-oldest audio frames, error on text flood); per-user concurrent-session caps in Redis.

### 5.7 Data layer

- **Versioned migrations** from day one; seeds become a seed command, not app-startup side effects.
- **PgBouncer** (transaction pooling); per-pod app pools shrink accordingly.
- **Analytics rollups**: worker jobs materialize session/score/usage aggregates into summary tables; dashboards read rollups, not live multi-CTE scans.
- **Retention**: partition chat history, LLM logs, audit logs, telemetry by month; purge/archive job to object storage.
- **pgvector** for semantic search over personas/content when needed — no separate vector DB until proven necessary.
- **Soft-delete centralization**: data layer injects the filter; impossible to forget.

### 5.8 API contract

- **Version everything**: `/api/v1/...`; existing unversioned routes remain as deprecated aliases during transition.
- **Real HTTP status codes** with a consistent envelope `{status, message, data, meta}`; global exception handler maps domain errors → 4xx/5xx. (Legacy aliases keep current behavior until the existing consumer migrates.)
- **REST-correct verbs**: PATCH for partial update, DELETE for delete.
- **OpenAPI as the contract**: typed schemas on every endpoint; generated client SDKs so any future frontend gets typed clients for free.
- **Auth**: short-lived access JWT + rotating refresh token; WebSocket auth via a short-lived one-time ticket endpoint instead of a long-lived JWT in the query string.
- **Pagination contract**: `page`/`limit` (1–100) + `meta: {total, page, limit, total_pages}` uniformly.

---

## 6. Security Hardening Plan (ordered)

1. Parameterize the injectable queries; add CI semgrep rule banning f-string SQL. **(day 1)**
2. Global auth default-deny + explicit public allowlist; protect analytics, LLM dashboards, user endpoints, session history. **(week 1)**
3. CORS allowlist from env. **(day 1)**
4. RBAC layer: permission constants per module action, enforced in a dependency; role checks by name, not magic integers. **(week 2)**
5. Redis rate limiting: global default + strict login bucket. **(week 1)**
6. Refresh-token rotation + revocation on logout; access-token TTL → 15 min. **(week 2)**
7. Drop AES-ECB: TLS-only login (or AES-GCM if an external contract forces payload encryption); hash and rotate all seeded credentials out of source. **(week 2)**
8. Upload validation: extension + MIME allowlist, size caps, optional ClamAV scan job. **(week 3)**
9. Secrets to a secret manager via External Secrets; rotate everything currently in `.env`. **(infra phase)**
10. Security headers already decent — add `Permissions-Policy`; pen-test pass before launch.

---

## 7. Observability Plan

- **Structured JSON logging** with request-id + user-id correlation; typed domain errors and a global handler that logs once with context.
- **OpenTelemetry** auto-instrumentation (HTTP, DB, Redis, outbound calls); spans around every LLM call with model/tokens/cost attributes.
- **Prometheus metrics**: request latency histograms, WS session gauges, LLM token counters, queue depths, pool saturation; Grafana dashboards in repo.
- **Telemetry middleware fix**: per-request sync DB write → in-memory accumulator flushed by a worker every 30 s (batch upsert). Same data, ~1000× fewer writes.
- **SLOs**: API p95 < 300 ms, WS first-token < 2 s, voice round-trip < 800 ms, 99.5% availability; alert rules in repo.
- **LLM observability**: `llm_logs` stays the source of truth; gateway spend logs reconcile against it; optional Langfuse (OSS) for prompt tracing/eval later.

---

## 8. Testing & Quality

| Layer | Scope |
|---|---|
| Unit | services, auth, scoring parsers, provider adapters |
| Integration (testcontainers: real Postgres + Redis) | every endpoint: happy path, authz failures, validation, pagination edges |
| WS / E2E | chat session lifecycle, reconnect contract, end-session scoring |
| LLM contract (recorded fixtures) | gateway client, token accounting, conversation-end handling |
| Prompt regression (offline eval harness) | persona behavior and scoring stability across model/provider swaps — gate for promoting a new model to default |
| Load (k6) | WS concurrency, login, dashboards |

Coverage gate 80% in CI. TDD for all new code. Strict linting + type checking + pre-commit hooks; locked, deduplicated dependencies. Tooling specifics in [BACKEND_PLAN.md §5](./BACKEND_PLAN.md).

---

## 9. Infrastructure & Delivery

- **Dockerfile** (multi-stage, non-root) + docker-compose for local dev (postgres, redis, minio, litellm, app, worker).
- **Helm chart**: api, realtime, worker, gateway deployments; HPA on api/worker, realtime scales on connection count; PodDisruptionBudgets; preStop drain for WS pods.
- **Terraform/OpenTofu**: one set of reusable modules (cluster, postgres, redis, storage, DNS, secrets); the target cloud is selected per environment — the stack runs identically on any managed Kubernetes or on self-hosted infrastructure.
- **CI**: lint → typecheck → unit → integration → image build + vulnerability scan → push → Helm deploy to dev; manual gate to staging/prod. Migrations run as a release job, never at boot.
- **Environments**: dev (docker-compose or k3s) → staging → prod, with seeded demo data per env.
- **Backups/DR**: Postgres PITR, object-storage versioning; Redis state is reconstructable.

---

## 10. Phased Roadmap

Detailed build phases (scaffold → identity/auth → personas/sessions → LLM registry & realtime → content/analytics/llmops → hardening & cutover → enhancements) live in [BACKEND_PLAN.md §6](./BACKEND_PLAN.md).

**Interim hardening of the legacy app** while the rebuild proceeds (it keeps serving production): SQL-injection fixes, CORS allowlist, auth on open endpoints, login rate limit — the day-1 items from §4. Nothing else gets invested in the legacy codebase.

### Cutover strategy
Parallel run: the NestJS backend ships `/api/v1` against a migrated copy of the data; the consumer switches after parity verification; a soak period follows; the legacy app is then retired.

---

## 11. Key Decisions & Trade-offs

| Decision | Choice | Why |
|---|---|---|
| Rewrite vs evolve | **Rebuild in NestJS** ([BACKEND_PLAN.md](./BACKEND_PLAN.md)) | LiteLLM gateway removes the Python-only LLM dependency; typed contracts + clean schema justify the rewrite; legacy app serves until cutover |
| Monolith vs microservices | **Modular monolith + separate realtime deployment** | only the WS tier scales differently; everything else shares data and team |
| LLM access | **LiteLLM gateway + DB provider/model registry** | OpenAI, Gemini, Azure OpenAI, OpenRouter (and OSS models) as runtime config; budgets/fallbacks/cost built in; deletes homegrown quota spreader |
| Model selection | **Logical roles resolved via registry, never hardcoded model strings** | swap providers/models without deploys; prompt-regression gate makes swaps safe |
| Conversation state | **Redis session registry + Postgres chat history** | horizontal scale + crash recovery; both OSS |
| Voice | **`VoiceProvider` interface over Gemini Live + Azure VoiceLive; OpenAI Realtime and OSS (LiveKit) addable** | managed realtime-voice APIs are best today; interface keeps the exit door open |
| Infrastructure | **Containers + K8s, cloud-agnostic, OSS components only** | no closed-source dependencies; deployable on any cloud or self-hosted |
| Data access | **Typed ORM with versioned migrations; parameterized raw SQL for heavy analytics** | type safety + schema versioning; details in BACKEND_PLAN |
| Jobs | Redis-backed job queue (worker deployment) | no extra broker, minimal ops surface |
| Frontend | **React SPA** ([FRONTEND_PLAN.md](./FRONTEND_PLAN.md)) | Vite + TanStack Router/Query + Zustand + shadcn/Tailwind; consumes the shared contracts package |
| Legacy quirks (errors-as-200, POST updates, payload encryption) | Not ported; `/api/v1` is REST-correct | legacy app keeps serving the old consumer until cutover |
| Vector search | pgvector, not a dedicated store | one less system; revisit at scale |
| Observability | OTel + Prometheus/Grafana/Loki/Tempo + Sentry OSS | fully open-source, runs anywhere |
