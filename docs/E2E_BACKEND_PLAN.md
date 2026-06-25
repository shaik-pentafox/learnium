# ALFA Traineon — End-to-End Backend Implementation Plan

> Single authoritative, executable plan for the NestJS rebuild.
> Synthesizes `BACKEND_PLAN.md` + `PRODUCT_PLAN.md` into one document.
> Answer to "what do I build next, in what order, with what constraints."

---

## 1. Goal

Rebuild ALFA Traineon backend in **NestJS 11 + TypeScript**, client-agnostic, cloud-agnostic, horizontally scalable. Legacy FastAPI app remains reference implementation until `/api/v1` reaches feature parity and cutover completes.

**Design constraints:**
- No closed-source licensed runtime dependencies
- All LLM providers swappable via DB config — zero deploys to change provider
- Stateless app tier; all session state in Redis + Postgres; analytics in ClickHouse
- One codebase, three run targets: `api` | `realtime` | `worker`
- White-label ready: no hardcoded client names in system prompts or code

---

## 2. Current State — What We're Migrating From

| Area | Legacy FastAPI problem |
|---|---|
| Auth | AES-ECB login payload, JWT in WS query string, no refresh tokens, no revocation |
| LLM | In-memory `LLMProvider`, resets on restart, hardcoded model strings (`gemini-3.1-pro-preview`), hardcoded Gemini/Azure/Vertex in code |
| WS state | `MemorySaver` (LangGraph) in-process — can't scale horizontally |
| Reconnect | None — network drop = lost session permanently |
| Telemetry | Sync DB write on every HTTP request |
| Dashboards | Live multi-CTE scans, unauthenticated, no pagination |
| Schema | No migrations, JSON-array FK column (`mapped_customalfas`), `create_all` at boot |
| Security | 15+ unauthenticated endpoints, SQL injection via f-strings, no RBAC, no rate limiting |
| Errors | HTTP 200 for failures, `status:"error"` in body |
| Branding | "Sutherland ALFA" hardcoded in system prompts, fallback strings, enhance_prompt logic |
| Gamification | Does not exist |

---

## 3. Target Architecture

```
                    ┌──────────────────────────────────────────────┐
                    │         React SPA (apps/web)                  │
                    └─────────────────┬────────────────────────────┘
                                      │ HTTPS / WSS
                    ┌─────────────────▼────────────────────────────┐
                    │     Ingress / API Gateway                     │
                    │     TLS termination, WAF, rate limits,        │
                    │     sticky sessions for WS pods               │
                    └──────────┬───────────────┬───────────────────┘
                               │               │
           ┌───────────────────▼──┐   ┌────────▼────────────────────┐
           │  alfa-api (REST)     │   │  alfa-realtime (WS/voice)   │
           │  NestJS, N pods      │   │  NestJS, N pods             │
           │  identity/personas/  │   │  chat gateway, voice        │
           │  content/analytics/  │   │  gateway, session registry  │
           │  llmops/gamification │   │  reconnect/resume           │
           └───┬────────┬─────────┘   └────┬──────────────┬─────────┘
               │        │                  │              │
     ┌─────────▼──┐  ┌──▼────────────────▼──┐   ┌───────▼──────────────┐
     │ PostgreSQL │  │  Redis 7              │   │  LLM (LangChain)    │
     │ 16 +       │  │  session registry,    │   │  in-app, no gateway │
     │ PgBouncer  │  │  pub/sub, rate limits,│   │  OpenAI / Gemini /   │
     │ +pgvector  │  │  BullMQ queues,       │   │  Azure / OpenRouter / │
     │ +LangGraph │  │  WS ticket store      │   │  vLLM / Ollama       │
     │  checkpoint│  │                       │   │  (LangGraph engine)  │
     └─────┬──────┘  └───────────────────────┘   └──────────────────────┘
           │
     ┌─────▼──────────┐   ┌──────────────────┐   ┌────────────────────┐
     │ ClickHouse     │   │  alfa-worker     │   │  Observability     │
     │ analytics OLAP │   │  BullMQ procs,   │   │  OTel → Prometheus │
     │ llm_events/    │   │  10 job types,   │   │  Grafana, Loki,    │
     │ session/telemetry   │  7 queues        │   │  Tempo, Sentry OSS │
     └────────────────┘   └──────────────────┘   └────────────────────┘
           │
     ┌─────▼──────────┐
     │ Object Storage │
     │ S3-compatible  │
     │ (MinIO/GCS/    │
     │  Azure Blob)   │
     └────────────────┘
```

---

## 4. Tech Stack

### Backend (NestJS app)

| Concern | Choice | Notes |
|---|---|---|
| Runtime | Node.js 22 LTS | |
| Framework | NestJS 11 + Fastify | `@nestjs/platform-fastify` |
| Language | TypeScript 5.x strict | `noUncheckedIndexedAccess`, ESM |
| Package manager | npm workspaces | monorepo |
| ORM / migrations | Prisma | `prisma migrate dev/deploy`; operational DB only |
| Analytics DB | ClickHouse | `llm_events`, `session_events`, `telemetry_events`; `@clickhouse/client` |
| Validation | Zod via `nestjs-zod` | schemas in `packages/contracts`, shared with frontend |
| Auth | JWT access (15 min) + rotating refresh | `@nestjs/passport`, `passport-jwt`, argon2 |
| LLM access | **LangChain.js** chat-model integrations | `@langchain/openai`, `@langchain/google-genai`, `@langchain/community`; models instantiated from DB registry + decrypted BYOK creds; `.withFallbacks()` for ordered fallback chains. **No LiteLLM gateway.** |
| Roleplay orchestration | **LangGraph.js** (`@langchain/langgraph`) | `StateGraph` session engine (ports legacy `utils/new_chat.py`); **`PostgresSaver` checkpointer** (`@langchain/langgraph-checkpoint-postgres`) keyed by session uid → horizontal-scale-safe (replaces legacy in-memory `MemorySaver`) |
| Voice | `VoiceProvider` interface | Gemini Live + Azure VoiceLive + OpenAI Realtime (vendor SDKs — outside LangChain) |
| Local models (future) | OpenAI-compatible endpoints | vLLM / Ollama registered as providers (`baseUrl`, no key) → same `ChatOpenAI` client |
| WebSockets | Nest gateways on raw `ws` | no socket.io; binary PCM16 + JSON control frames |
| Cache / pub-sub | Redis 7 (`ioredis`) | session registry, rate limits, tickets, pub/sub |
| Background jobs | BullMQ + `@nestjs/bullmq` | 16 job types, 7 queues |
| Object storage | `StorageService` interface | S3 adapter + Azure Blob adapter |
| Rate limiting | `@nestjs/throttler` + Redis | strict bucket on `/auth/login` |
| Logging | pino (`nestjs-pino`) | request-id correlation, structured JSON, redaction |
| Observability | OpenTelemetry | auto-instrumentation → Prometheus + Grafana + Loki + Tempo |
| Error tracking | Sentry OSS / GlitchTip | |
| Excel I/O | exceljs (streaming) | bulk import + dashboard export |
| Testing | Jest + SWC, Supertest, Testcontainers | real Postgres + Redis in integration |
| Lint/format | ESLint (typescript-eslint strict) + Prettier | husky + lint-staged pre-commit |

### Infrastructure

| Concern | Choice |
|---|---|
| Containers | Docker multi-stage (distroless/alpine, non-root) |
| Orchestration | Kubernetes (Helm), docker-compose for local dev |
| DB connection pooling | PgBouncer (transaction mode, for Postgres) |
| Analytics DB | ClickHouse 24+ (OSS, self-hosted or ClickHouse Cloud) |
| IaC | Terraform/OpenTofu — cloud-agnostic modules |
| Secrets | External Secrets Operator → any secret manager / Vault |
| CI/CD | Repo pipeline: lint → typecheck → unit → integration → build+scan → Helm deploy |

---

## 5. Monorepo Structure

```
alfa-traineon/
├── apps/
│   ├── api/                         # NestJS backend (this plan)
│   └── web/                         # React SPA (FRONTEND_PLAN.md)
├── packages/
│   ├── contracts/                   # Zod schemas + inferred TS types
│   │                                # entities, DTOs, envelope, error codes,
│   │                                # pagination, WS message protocol types
│   └── tsconfig/                    # shared TS config bases
├── infra/
│   ├── docker/                      # Dockerfile, docker-compose.yml
│   │                                # (pg, redis, clickhouse, minio, api, worker)
│   ├── helm/                        # api / realtime / worker / gateway charts
│   └── terraform/                   # cloud-agnostic modules
├── tools/migration/                 # ETL scripts: legacy Postgres → new schema
├── package.json                     # npm workspaces root
└── turbo.json
```

### `apps/api/src/` structure

```
src/
├── main.ts                          # bootstrap by APP_ROLE env: api|realtime|worker
├── app.module.ts                    # conditional module loading by role
├── core/
│   ├── config/                      # @nestjs/config + Zod env schema (fail-fast on missing var)
│   ├── database/                    # PrismaService + client extensions:
│   │                                #   soft-delete filter injection, audit columns (CLS)
│   ├── auth/
│   │   ├── strategies/              # jwt.strategy, local.strategy
│   │   ├── guards/                  # JwtAuthGuard (global default-deny), RolesGuard
│   │   ├── decorators/              # @Public(), @CurrentUser(), @Permissions()
│   │   └── verifiers/               # CredentialVerifier interface:
│   │                                #   LocalVerifier (argon2 vs default_credentials table)
│   │                                #   ExternalVerifier (corporate auth API via external_apis table)
│   ├── redis/                       # ioredis provider, distributed locks, pub/sub
│   ├── clickhouse/                  # ClickHouseService wrapper (@clickhouse/client)
│   │                                #   insert(table, rows[]) + query<T>() helpers
│   │                                #   used by analytics, llm cost, telemetry modules
│   ├── storage/                     # StorageService interface + s3 / azure-blob adapters
│   ├── crypto/                      # AES-256-GCM CryptoService for BYOK key encryption (E6)
│   ├── llm/
│   │   ├── model-factory.service.ts # builds LangChain chat models from registry + decrypted creds
│   │   │                            #   (ChatOpenAI/AzureChatOpenAI/ChatGoogleGenerativeAI), .withFallbacks()
│   │   ├── roleplay-graph.ts        # LangGraph StateGraph roleplay engine (ports legacy utils/new_chat.py)
│   │   │                            #   compiled with PostgresSaver checkpointer (thread_id = session uid)
│   │   ├── registry/                # provider/model/credential registry (BYOK vault)
│   │   ├── cost/                    # LangChain usage-metadata callback → llm_events (ClickHouse)
│   │   └── voice/                   # VoiceProvider interface + gemini-live / azure-voicelive impls
│   ├── envelope/                    # response interceptor {status, message, data, meta}
│   ├── errors/                      # typed domain errors → global exception filter → 4xx/5xx
│   ├── pagination/                  # PageQuery pipe + paginated envelope helper
│   └── telemetry/                   # request-activity interceptor → in-memory accumulator
│                                    # (flushed by BullMQ job every 30s, never per-request DB writes)
├── modules/
│   ├── identity/                    # users, roles, bulk import, supervisor mapping
│   │                                #   (SuperAdmin→Trainer→Trainee hierarchy)
│   ├── personas/                    # persona CRUD, versioning, publish/unpublish, scoring config,
│   │                                #   voice styles; trainer-owned, draft roleplay-test before publish
│   ├── sessions/                    # session lifecycle, chat history, scoring, feedback
│   │                                #   (roleplay turns run through core/llm LangGraph engine)
│   ├── realtime/                    # loaded only when APP_ROLE=realtime
│   │   ├── ticket.controller.ts     # POST /v1/realtime/ticket (one-time 30s WS ticket)
│   │   ├── chat.gateway.ts          # text roleplay WS (LangGraph .stream() tokens, reconnect/resume)
│   │   ├── voice.gateway.ts         # voice WS (binary PCM16 + JSON control frames)
│   │   └── session-registry.ts      # Redis-backed live-session state + resume
│   ├── files/                       # simple file upload/download, pre-signed URL generation
│   ├── dashboard/                   # admin / trainer / trainee reporting (perf + token-usage-by-
│   │                                #   provider) — reads ClickHouse + Postgres rollups
│   ├── analytics/                   # dashboards reading rollup tables; export BullMQ jobs
│   ├── llmops/                      # provider/model + BYOK credential admin API, usage/cost dashboard
│   └── gamification/                # (FUTURE — deferred) badges, streaks, leaderboard, perf scores
├── workers/                         # BullMQ processors (loaded only when APP_ROLE=worker)
└── health/                          # GET /health (liveness), GET /ready (DB+Redis+gateway)
```

**Module rules:** controllers/gateways do transport only → services hold business logic → repositories own data access → modules expose services (never repositories) to other modules.

---

## 6. Database Schema (Prisma — Clean Redesign)

### Key changes vs legacy

| Legacy | New |
|---|---|
| `mapped_customalfas` JSON array on users | **Hierarchy model** (see below): `User.supervisorId` + `Persona.ownerId`/`isPublished` — no JSON array, no per-user persona FK |
| `custom_alfa` table | `personas` (client-agnostic name) |
| `custom_alfa_sessions` | `sessions` |
| `custom_alfa_chat_history` | `chat_messages` |
| `score_card_columns` (mixed init+result rows) | `score_criteria` (rubric def) + `score_results` (per-session scores) |
| `llm_models` (price only, no provider) | `llm_providers` + `llm_models` (full registry) |
| No partitioning | Monthly partitions on high-growth tables |
| Soft delete: ad-hoc per query | Prisma client extension injects `isDeleted=false` filter everywhere |
| Audit: PG trigger `log_audit()` | Prisma client extension reads CLS actor context → `audit_logs` |

### Hierarchy & persona visibility (core model)

Three-level hierarchy, supervisor self-reference only — **no groups/cohorts/domains, no public personas.**

```
SUPER_ADMIN ── creates ──▶ TRAINER ── creates ──▶ TRAINEE
     │                        │                       ▲
     │ creates trainees,      │ owns personas,        │ uses only the
     │ maps them to a trainer │ tests drafts,         │ PUBLISHED personas
     │ configs LLM providers  │ publishes them ───────┘ of their own trainer
```

- `User.supervisorId Int?` — trainee → trainer (the only org relationship). Super Admin sets it (or a trainer creating a trainee sets it to self).
- `Persona.ownerId Int` — the trainer who created the persona.
- `Persona.isPublished Boolean @default(false)` + `Persona.publishedVersion Int?` — a draft is editable + roleplay-testable **by its owner only**; publishing exposes the chosen version to that trainer's trainees.
- **Visibility rule (no assignment table, no `isPublic`):** a trainee may use persona P iff `P.ownerId == trainee.supervisorId && P.isPublished`. A trainer sees/edits their own personas (any state). Super Admin sees all.
- A trainer can own **many** personas and test each as a draft before publishing.

### High-growth tables (monthly partitions — Postgres)
`sessions`, `chat_messages`, `audit_logs`

### ClickHouse tables (analytics + observability — append-only, no Prisma)
| Table | Rows written by | Read by |
|---|---|---|
| `llm_events` | every LLM call (worker job batch-insert) | LLM ops dashboard, cost charts |
| `session_events` | session end (worker job) | analytics overview, score trends |
| `telemetry_events` | `flush-telemetry` job every 30s | user activity dashboard |

BullMQ workers batch-insert to ClickHouse via `@clickhouse/client`. Dashboard endpoints call `ClickHouseService.query<T>()` — never hit Postgres for analytics reads.

### Gamification tables — **FUTURE (deferred with the leaderboard)**

`badge_definitions`, `user_badges`, `user_streaks`, `user_performance_scores` (composite score + leaderboard ranking) are **not built in the core phases**. Dashboards (below) compute their reporting aggregates directly from ClickHouse `session_events` + Postgres — they do **not** depend on these tables. Gamification + leaderboard land in a later enhancement phase.

### Dashboard reads (core — no new tables)

The dashboard module (admin / trainer / trainee) reads **ClickHouse** `session_events` + `llm_events` (token-usage-by-provider) and Postgres session/score rows directly — materialized rollup tables can be added later if read latency demands.

### Seed data (`prisma db seed` — not app boot)
- `role_defs`: SUPER_ADMIN, TRAINER, USER
- `assistant_voices`, `voice_styles`
- `external_apis`: LOGIN, USER_LOOKUP rows (URLs from env)
- `default_credentials`: local-dev SUPER_ADMIN account (argon2-hashed, from env) — first login configures everything else
- **No `llm_*` seeds** — Super Admin adds providers/keys/models at runtime (BYOK). **No `badge_definitions`** — gamification deferred.

---

## 7. API Endpoints — All Routes (`/api/v1`)

Global `JwtAuthGuard` = default-deny. `PUBLIC` = explicit `@Public()` decorator.

### Auth (`/api/v1/auth`)

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/auth/login` | PUBLIC | Plain JSON; rate-limited 5/min/IP |
| POST | `/auth/refresh` | PUBLIC (httpOnly cookie) | Rotating refresh + reuse detection → revoke family |
| POST | `/auth/logout` | JWT | Revoke current refresh token |
| POST | `/auth/realtime/ticket` | JWT | One-time 30s WS ticket → Redis |

### Users (`/api/v1/users`)

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/users` | JWT `users:read` | Paginated; `?q=` search; filter `?role=&supervisorId=`. Admin → all; Trainer → own trainees (supervisees) |
| GET | `/users/:id` | JWT `users:read` | Full profile + supervisor + supervisees |
| POST | `/users` | JWT `users:write` | Create; `{role, supervisorId?}`. **Admin** → create Trainer or Trainee (+ map Trainee to a Trainer). **Trainer** → create Trainee under self (`supervisorId` forced = self). 409 on duplicate employeeId |
| PATCH | `/users/:id` | JWT `users:write` | Partial update (Trainer scoped to own trainees) |
| POST | `/users/:id/supervisor` | JWT `users:write` ADMIN | `{supervisorId}` — (re)map a trainee to a trainer |
| DELETE | `/users/:id` | JWT `users:delete` | Soft-delete |
| POST | `/users/import` | JWT `users:write` | Multipart XLSX/CSV → BullMQ → returns ImportReport.id |
| GET | `/users/import/:reportId` | JWT `users:write` | Import job status + error file URL |
| GET | `/users/import/:reportId/errors` | JWT `users:write` | Download error XLSX |
| POST | `/users/:id/avatar` | JWT own or `users:write` | Upload → storage → update avatarUrl |

### Roles (`/api/v1/roles`)

`GET /roles` — list all (JWT, no permission gate).

### Personas (`/api/v1/personas`)

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/personas` | JWT `personas:read` | Paginated. Admin → all; Trainer → own (any state); Trainee → published personas of own trainer only |
| GET | `/personas/:id` | JWT `personas:read` | With score criteria + model config (visibility-checked per hierarchy) |
| POST | `/personas` | JWT `personas:write` | Trainer creates; `ownerId` = current trainer; starts as draft (`isPublished=false`) |
| PATCH | `/personas/:id` | JWT `personas:write` | Owner only; auto-snapshots version row on every edit |
| DELETE | `/personas/:id` | JWT `personas:delete` | Owner/Admin; soft-delete |
| GET | `/personas/:id/versions` | JWT `personas:read` | Version history list |
| GET | `/personas/:id/versions/:v` | JWT `personas:read` | Snapshot detail |
| POST | `/personas/:id/enhance` | JWT `personas:write` | Stream LLM-enhanced instructions (SSE) |
| POST | `/personas/:id/publish` | JWT `personas:write` | Owner only; set `isPublished=true`, `publishedVersion` = current → visible to trainer's trainees |
| POST | `/personas/:id/unpublish` | JWT `personas:write` | Owner only; hide from trainees again |
| POST | `/personas/:id/test` | JWT `personas:write` | Owner only; start a roleplay-test session against a **draft** (not counted as a trainee session) |
| GET | `/personas/my` | JWT own | Trainee: published personas of own trainer they can roleplay |

### Sessions (`/api/v1/sessions`)

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/sessions` | JWT `sessions:write` | Start session → returns `{sessionId, uid, startedAt}` |
| GET | `/sessions` | JWT `sessions:read` | Paginated; admin sees all, users see own; filter by personaId/userId/status/from/to |
| GET | `/sessions/:uid` | JWT `sessions:read` | Detail with scores + feedback |
| GET | `/sessions/:uid/messages` | JWT `sessions:read` | Paginated chat history |
| POST | `/sessions/:uid/end` | JWT own | Mark COMPLETED; enqueue `score-session` BullMQ job |
| GET | `/sessions/export` | JWT ADMIN | XLSX export (enqueue BullMQ job) |

### LLM Ops (`/api/v1/llm`)

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/llm/providers` | JWT `llmops:read` | List |
| POST | `/llm/providers` | JWT `llmops:write` ADMIN | Create |
| PATCH | `/llm/providers/:id` | JWT `llmops:write` ADMIN | |
| DELETE | `/llm/providers/:id` | JWT `llmops:write` ADMIN | Disable (never hard-delete) |
| GET | `/llm/models` | JWT `llmops:read` | Filter `?providerId=&capability=` |
| POST | `/llm/models` | JWT `llmops:write` ADMIN | |
| PATCH | `/llm/models/:id` | JWT `llmops:write` ADMIN | |
| POST | `/llm/models/:id/promote` | JWT `llmops:write` ADMIN | Set as default; requires regression suite pass |
| GET | `/llm/usage` | JWT `llmops:read` | Aggregated token/cost; filter `?from=&to=&modelId=&interval=` |
| GET | `/llm/usage/export` | JWT ADMIN | XLSX export (BullMQ) |

### Files (`/api/v1/files`)

Simple upload/download via `StorageService` (S3-compatible). MIME + size validation. Pre-signed URL generation for client-side direct download.

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/files/upload` | JWT | Multipart; returns `{fileId, url}` |
| GET | `/files/:fileId` | JWT | Redirect to pre-signed download URL (60s TTL) |
| DELETE | `/files/:fileId` | JWT `files:delete` | Hard-delete from storage + DB record |

### Analytics (`/api/v1/analytics`)

All JWT + `analytics:read`. Reads from BullMQ-materialized rollup tables (never live CTE scans).

| Method | Path | Notes |
|---|---|---|
| GET | `/analytics/overview` | Period summary from rollup tables |
| GET | `/analytics/sessions` | Session completion + duration breakdown |
| GET | `/analytics/scores` | Per-criterion score trends |
| GET | `/analytics/users/:userId` | Individual user activity (own or `analytics:read`) |
| GET | `/analytics/export` | XLSX export (BullMQ) |

All accept `?personaId=&version=&from=&to=`.

### Dashboards (`/api/v1/dashboard`) — CORE reporting

Role-scoped reporting. Reads ClickHouse (`session_events`, `llm_events`) + Postgres; no live multi-CTE scans.

| Method | Path | Auth | Returns |
|---|---|---|---|
| GET | `/dashboard/admin` | JWT SUPER_ADMIN | Org-wide: total training activity, trainee performance distribution, completion rates, **token usage + cost by provider/model**, per-trainer rollups, active users |
| GET | `/dashboard/trainer` | JWT TRAINER | Own trainees: per-trainee avg score, completion rate, sessions + practice time, activity, at-risk list (low completion / declining) |
| GET | `/dashboard/me` | JWT (own) | Trainee: own sessions, avg score per criterion, progress over time, practice time, last sessions with feedback |

All accept `?from=&to=&personaId=`. Admin token-usage panel groups `llm_events` by `provider`/`model`.

> **Gamification + leaderboard (badges, streaks, performance-score ranking) → future enhancement** (deferred out of core). Endpoints `/leaderboard*`, `/badges*` land in a later phase; dashboards above cover the core reporting need without them.

### Announcements (`/api/v1/announcements`)

CRUD; authenticated.

### Health (PUBLIC)

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | Liveness — always 200 |
| GET | `/ready` | Readiness — checks DB + Redis + ClickHouse |

### WebSocket Gateways

| Path | Auth | Protocol |
|---|---|---|
| `WS /api/v1/realtime/chat` | one-time ticket (`?ticket=`) | JSON streaming |
| `WS /api/v1/realtime/voice` | one-time ticket + `?provider=gemini\|azure\|openai` | binary PCM16 + JSON control |

---

## 8. WebSocket Protocol

Typed in `packages/contracts/realtime.ts`.

### Chat gateway — client → server (JSON)

```jsonc
{ "type": "message", "content": "Hello",  "id": "<client-uuid>" }
{ "type": "control", "action": "end" }
{ "type": "resume",  "lastMessageId": "<id>" }   // reconnect resume
{ "type": "ping" }
```

### Chat gateway — server → client (JSON)

```jsonc
{ "type": "token",        "delta": "..." }                            // streaming token
{ "type": "message_done", "messageId": "...", "emotion": "friendly", "emoji": "😊" }
{ "type": "session_ending" }                                           // triggers scoring job
{ "type": "session_ended", "scores": [...], "feedback": "..." }
{ "type": "error",        "code": "PROVIDER_ERROR", "message": "..." }
{ "type": "reconnect",    "reason": "server_drain" }                  // graceful drain advisory
{ "type": "pong" }
```

**Reconnect contract:** client reconnects to same URL with same `sessionId`; sends `resume` with `lastMessageId`. Server replays any missed `message_done` events from Postgres chat history and continues.

### Voice gateway — client → server

- **Binary frames:** raw PCM16, 16 kHz, mono, 20 ms chunks
- **JSON control frames:**
  ```jsonc
  { "type": "control", "action": "interrupt" }
  { "type": "control", "action": "end" }
  { "type": "ping" }
  ```

### Voice gateway — server → client

- **Binary frames:** PCM16 audio from assistant
- **JSON frames:**
  ```jsonc
  { "type": "speech_start" }
  { "type": "speech_end" }
  { "type": "transcript", "role": "user"|"assistant", "text": "..." }
  { "type": "emotion",    "value": "assertive" }
  { "type": "session_ended", "scores": [...], "feedback": "..." }
  { "type": "error",      "code": "...", "message": "..." }
  { "type": "reconnect",  "reason": "..." }
  { "type": "pong" }
  ```

---

## 9. LLM Platform Layer — LangChain + LangGraph (in-app, no gateway)

> **Core swap: LiteLLM gateway removed.** Provider access and roleplay orchestration live in the app via LangChain.js / LangGraph.js, mirroring the legacy FastAPI engine (`utils/new_chat.py` + `utils/llm_provider.py`) which already runs LangGraph + LangChain — now with a **persistent checkpointer** so it scales horizontally (the legacy used in-process `MemorySaver`).
>
> **Stack note:** LangGraph's reference implementation is Python; the legacy engine is Python. This plan uses **LangGraph.js in NestJS** for a single TS codebase. Fallback if JS features lag: run the roleplay/LLM engine as a small Python LangGraph service behind the WS gateway (the `realtime` run target is already a separate deployment). Decision: LangGraph.js unless a concrete gap forces the split.

### Model access — `ModelFactoryService` (`core/llm/model-factory.service.ts`)

- Resolves a persona's **logical role** (`conversationModelId`, `scoringModelId`) → `llm_models` row → `llm_providers` + `llm_credentials` → a **LangChain chat-model instance**:
  - `ChatOpenAI` — OpenAI, OpenRouter, and any OpenAI-compatible **local** endpoint (vLLM / Ollama) via `configuration.baseURL`
  - `AzureChatOpenAI` — Azure OpenAI
  - `ChatGoogleGenerativeAI` — Gemini
- API key decrypted in-memory from `llm_credentials` (E6), passed to the constructor; never logged.
- **Fallbacks:** `primary.withFallbacks([fallbackA, fallbackB])` — ordered per logical role (replaces the gateway's fallback feature; legacy already used `with_fallbacks`).
- **Streaming:** `model.stream()` for chat turns. **Structured output:** `model.withStructuredOutput(zodSchema)` for scoring/feedback (per criterion or batched).
- **Usage + cost:** LangChain `usage_metadata` callback → in-memory accumulator → `flush-llm-events` job → ClickHouse `llm_events` (tokens, model, **provider**, cost, latency).
- No hardcoded model strings anywhere — model identity is always registry-resolved.

### Roleplay orchestration — `roleplay-graph.ts` (`core/llm/roleplay-graph.ts`)

- **LangGraph `StateGraph`** (ports legacy `utils/new_chat.py`): state = `messages` (with the `add_messages` reducer) + persona/session metadata; nodes: build-system-prompt (from persona `customInstructions` — **no hardcoded client names**) → model call (streamed) → persist turn to `chat_messages`.
- `[CONVERSATION_ENDED]` sentinel ends the session server-side (legacy behavior retained).
- **Checkpointer = `PostgresSaver`** (`@langchain/langgraph-checkpoint-postgres`), `thread_id = session.uid`. **Fixes the legacy `MemorySaver` flaw** (in-process state, no horizontal scale): any `realtime` pod resumes from Postgres; reconnect replays from the checkpoint + `chat_messages`.
- Redis session registry (`session:{uid}`) holds liveness/routing only; durable conversation state is the Postgres checkpoint.

### Provider / model / credential registry (DB, admin-configurable — BYOK)

**Super Admin configures providers + keys once**; all trainers and trainees consume them transparently — **no per-user keys.**

| Table | Key columns |
|---|---|
| `llm_providers` | `type` (`openai` / `azure_openai` / `gemini` / `openrouter` / **`local`** / `custom`), `baseUrl` (set for Azure + local vLLM/Ollama), `isEnabled`, `priority`, `monthlyBudgetUsd` — **no credential column** |
| `llm_credentials` | many keys per provider; `{encryptedKey, iv, authTag, keyVersion}` (AES-256-GCM via `core/crypto`), `rpm`/`tpm`, `isActive`, `healthStatus`. **Write-only API**, masked reads (`sk-...x7Qp`); decrypted only inside `ModelFactoryService`. `local` providers need no key |
| `llm_models` | `name` (slug: `gpt-4o`, `gemini-2.5-flash`, or a local model id), `providerId`, `capabilities[]`, `contextWindowTokens`, prices, `isDefault` |

- Personas reference models by **logical role** resolved at session start — never a hardcoded string.
- `POST /llm/models/:id/promote` → requires offline prompt-regression suite to pass → flips the default; `ModelFactoryService` simply reads the new default (no gateway to sync).
- **Future — local/self-hosted:** register a `local` provider with the vLLM/Ollama `baseUrl`; its models use `ChatOpenAI` with that base URL and no key. Switching to self-hosted = insert provider + model rows, flip defaults, **zero code change**.

### Voice (DEFERRED — text-only is the current focus)

Two approaches are on the table; **the backend must not preclude either.** Build neither now.

**Approach A — client-side STT/TTS (preferred for simplicity).**
Browser does speech→text (STT) and text→speech (TTS) locally; sends/receives **text** over the **existing chat WS**. The backend stays **text-only** — no audio, no `VoiceProvider`, no binary frames. "Voice" is just the same LangGraph text turn with a mic/speaker UI on the frontend. Zero extra backend surface. This rides the F6 chat path as-is.

**Approach B — server-side realtime voice.**
Browser streams PCM16; backend runs a realtime provider behind a `VoiceProvider` interface:

```typescript
interface VoiceProvider {
  connect(instructions: string): Promise<void>;
  sendAudio(chunk: Buffer): Promise<void>;
  onAudio(handler: (chunk: Buffer) => void): void;
  interrupt(): Promise<void>;
  end(): Promise<void>;
}
```
Implementations: `GeminiLiveProvider`, `AzureVoiceLiveProvider`, `OpenAIRealtimeProvider` (vendor SDKs — outside LangChain), or a future OSS pipeline (LiveKit + open STT/TTS). Selected per persona / `?provider=` param. This is the only approach that adds a backend voice gateway + binary protocol.

**Design rule so both stay open:** the session/scoring path is transport-agnostic — it consumes a **text transcript**, never raw audio. Approach A feeds transcripts directly; Approach B's gateway transcribes to text before it touches the session. Whichever ships, scoring/analytics/checkpointing are unchanged.

---

## 10. Background Jobs (BullMQ — 10 Job Types, 6 Queues)

| Queue | Job | Trigger | Notes |
|---|---|---|---|
| `import` | `process-user-import` | POST /users/import | exceljs streaming parse, upsert batches of 100, write ImportReport progress |
| `export` | `export-sessions` | GET /sessions/export | Postgres cursor → exceljs → storage → pre-signed URL |
| `export` | `export-analytics` | GET /analytics/export | ClickHouse query → exceljs → storage → pre-signed URL |
| `export` | `export-llm-usage` | GET /llm/usage/export | ClickHouse query → exceljs → storage |
| `scoring` | `score-session` | POST /sessions/:uid/end | LLM call per criterion → `score_results` (Postgres); insert `session_events` row → ClickHouse |
| `analytics` | `flush-llm-events` | cron every 30s | Drain in-memory LLM call accumulator → batch-insert `llm_events` → ClickHouse |
| `analytics` | `flush-telemetry` | cron every 30s | Drain in-memory activity accumulator → batch-insert `telemetry_events` → ClickHouse |
| `retention` | `purge-old-partitions` | cron monthly | Drop Postgres partitions + ClickHouse TTL partition cleanup; archive to storage |
| `registry` | `refresh-model-cache` | on provider/model/credential change | Bust `ModelFactoryService` model cache across pods (Redis pub/sub); next turn rebuilds from DB — no gateway to sync |
| `cleanup` | `expire-realtime-tickets` | cron every 5 min | Delete expired `realtime_tickets` rows (Postgres) |

> **Gamification jobs deferred:** `compute-performance-scores`, `award-badges`, `update-streaks`, `weekly-ranking-badges` ship with the future gamification/leaderboard phase. Core dashboards aggregate from `session_events`/`llm_events` on read (or via simple rollups added later if needed).

---

## 11. Dashboards (core) + Gamification (future)

### Dashboards — core reporting (built in Phase 4)

Three role-scoped dashboards (`/dashboard/admin|trainer|me`, §7), reading ClickHouse + Postgres:
- **Super Admin:** org-wide training activity, trainee performance distribution, completion, **token usage + cost by provider/model**, per-trainer rollups.
- **Trainer:** their trainees' scores, completion, activity, at-risk list.
- **Trainee:** own sessions, per-criterion scores, progress over time, practice time.

No gamification tables required — aggregates come straight from `session_events` / `llm_events`.

---

### Gamification & Leaderboard — **FUTURE (deferred)**

> The full spec below (performance score, 17 badges, leaderboard) is retained for the later gamification phase. **Not built in core.** When built, it adds `badge_definitions`/`user_badges`/`user_streaks`/`user_performance_scores`, the 4 gamification jobs (§10), and `/leaderboard*`+`/badges*` endpoints. Leaderboard is **global** (no group/cohort).

### Performance Score (composite, 0–100)

```
Performance Score =
  (avg_session_score        × 0.40)   // quality
+ (completion_rate          × 0.20)   // follow-through (completed / started, rolling 30d)
+ (consistency_score        × 0.15)   // min(sessions_this_week / target, 1) × 100
+ (improvement_delta_norm   × 0.15)   // clamped score delta vs last month / 20
+ (streak_bonus             × 0.10)   // min(current_streak / 30, 1) × 100
```

Computed per user per period (weekly/monthly/all-time) by `compute-performance-scores` job after every session end and on daily cron. Stored in `user_performance_scores` with global rank + percentile.

### 17 Badges (seeded in `badge_definitions`)

**Milestone (volume):**

| Badge | Trigger | Tier |
|---|---|---|
| First Step | Complete first session | Bronze |
| Getting Started | 10 sessions | Bronze |
| Dedicated | 25 sessions | Silver |
| Expert | 50 sessions | Gold |
| Elite | 100 sessions | Platinum |
| Hour Glass | 1h total practice | Bronze |
| Marathon | 10h total practice | Gold |

**Performance (score-based):**

| Badge | Trigger | Tier |
|---|---|---|
| Sharp | Rolling 7-day avg score ≥ 70 | Bronze |
| Advanced | Rolling 7-day avg score ≥ 85 | Silver |
| Master | Rolling 7-day avg score ≥ 95 | Gold |
| Perfect Session | All criteria 10/10 in one session | Gold |

**Streak (consistency):**

| Badge | Trigger | Tier |
|---|---|---|
| On a Roll | 3-day streak | Bronze |
| Committed | 7-day streak | Silver |
| Unstoppable | 30-day streak | Gold |
| Iron Will | 60-day streak | Platinum |

**Improvement (monthly, re-earnable):**

| Badge | Trigger | Tier |
|---|---|---|
| Rising Star | Score improved ≥ 20% vs last month | Silver |
| Most Improved | Top improver globally this month | Gold |

**Ranking (weekly/monthly, re-earnable):**

| Badge | Trigger | Tier |
|---|---|---|
| Top 10% | Top 10th percentile globally | Silver |
| Podium | Top 3 globally this month | Gold |
| Champion | Rank 1 globally this month | Platinum |

### Leaderboard views

Global leaderboard. Periods: weekly / monthly / all-time. Own row pinned at bottom if outside top 50. Response shape per row: `{rank, userId, name, avatarUrl, performanceScore, avgScore, completedSessions, currentStreak, totalPracticeMin, topBadges[3], deltaVsPrevPeriod}`.

---

## 12. RBAC Permission Map

Three roles: `SUPER_ADMIN`, `TRAINER`, `USER`.

| Permission | SUPER_ADMIN | TRAINER | USER |
|---|---|---|---|
| `users:read` | all | supervisees | — |
| `users:write` | all (create Trainer/Trainee + map) | own trainees (create/edit) | — |
| `users:delete` | ✓ | — | — |
| `personas:read` | all | own (any state) | published, own trainer only |
| `personas:write` | ✓ | own (create/edit/publish/test) | — |
| `personas:delete` | ✓ | own | — |
| `sessions:read` | all | supervisees | own |
| `sessions:write` | ✓ | ✓ (incl. draft test) | ✓ |
| `files:delete` | ✓ | — | — |
| `dashboard:read` | org-wide | supervisees | own |
| `analytics:read` | global | supervisees | own |
| `llmops:read` | ✓ | — | — |
| `llmops:write` (incl. BYOK credentials) | ✓ | — | — |

Object-level checks enforced in **services**, not just guards: trainer scope = `supervisorId = trainer.id` (users/sessions/dashboard); persona visibility = owner (trainer) or `isPublished && ownerId = trainee.supervisorId` (trainee). `llmops:write` governs the encrypted BYOK credential endpoints; keys are write-only/masked regardless of role.

> `leaderboard:read` / `badges:*` permissions arrive with the deferred gamification phase.

---

## 13. Security Hardening

### Interim legacy FastAPI fixes (do before Phase 0 — only 4 changes)

1. **SQL injection** — parameterize f-string SQL in `routers/users.py` and `utils/async_db_utlil.py` (record-by-id, search) → asyncpg named params
2. **CORS** — `allow_origins=["*"]` → `settings.CORS_ORIGINS` (comma-split from env)
3. **Auth gaps** — add `Depends(get_user_id_from_token)` to `analytics_dashboard.py` and `llm_dashboard.py` routers
4. **Rate limiting** — add `slowapi` limiter on `POST /api/login` (5/min/IP)

No other changes to the Python codebase.

### NestJS app (built-in from day 1)

5. Global `JwtAuthGuard` (default-deny) + explicit `@Public()` opt-out
6. `@nestjs/throttler` + Redis; strict login bucket (5/min/IP)
7. `@Permissions()` guard on every mutation; object-level ownership checks in services
8. JWT access 15 min + rotating refresh tokens + reuse-detection (revoke entire token family on reuse)
9. Login: plain JSON over TLS (no AES-ECB); AES-GCM adapter only if external contract requires payload encryption
10. File upload: extension + MIME allowlist, size caps (video 500 MB, doc 50 MB)
11. Secrets via External Secrets Operator; no credentials in source or env files in prod
12. `Permissions-Policy` header; security pen-test before launch

---

## 14. Delivery Phases

### Phase 0 — Scaffold & Foundations (Week 1)

- Monorepo: npm workspaces + turbo, `apps/api`, `packages/contracts` (Zod envelope + pagination + error codes + WS protocol types)
- NestJS 11 skeleton on Fastify; Zod-validated config module (fail-fast on missing env vars)
- `docker-compose.yml`: postgres, redis, clickhouse, minio, api, worker services (no LiteLLM — LangChain runs in-app)
- Prisma init + baseline schema draft (all models from §6); ClickHouse DDL migration script for `llm_events`, `session_events`, `telemetry_events`
- `ClickHouseService` wired into `core/clickhouse/`; `core/crypto` (AES-256-GCM + `MASTER_ENCRYPTION_KEY`); `/ready` probe checks DB + Redis + ClickHouse
- CI skeleton: lint → typecheck → unit test gate
- pino logging + request-id correlation
- Global envelope interceptor + exception filter (typed domain errors → proper 4xx/5xx)
- `GET /health` + `GET /ready` (DB + Redis + ClickHouse probes)

**Exit gate:** `docker compose up --build` → all services start including ClickHouse; `/ready` 200 with all 4 probes ok; CI green

---

### Phase 1 — Identity & Auth (Weeks 2–3)

- Prisma migrations: `users`, `role_defs`, `assistant_voices`, `refresh_tokens`, `realtime_tickets`, `default_credentials`, `import_reports`
- `AuthModule`: login with `CredentialVerifier` (local + external), JWT access + refresh rotation, logout revocation, `@Public()`, `JwtAuthGuard` global, `RolesGuard`, `@Permissions()`
- Redis throttler: global default + strict login bucket
- Users/roles CRUD: pagination, `?q=` search, soft-delete, audit columns via Prisma extension
- Bulk import BullMQ job: exceljs streaming parse, upsert batches of 100, write `import_reports` progress
- Integration tests: every endpoint — happy path, 401, 403, 409, pagination edges

**Exit gate:** login → JWT; `GET /users` without token → 401; PATCH without permission → 403; bulk import 1000-row XLSX → `ImportReport` completed with error file; refresh rotation revokes old token on reuse

---

### Phase 2 — Personas & Sessions (Weeks 4–5)

- Prisma migrations: `voice_styles`, `personas`, `persona_versions`, `score_criteria`, `sessions`, `chat_messages`, `score_results`
- Persona CRUD + versioning (auto-snapshot on every PATCH) + scoring criteria + voice styles
- Prompt-enhance endpoint: SSE streaming via first `LlmClientService` consumer
- Session lifecycle: `POST /sessions` → `GET /sessions/:uid` → `GET /sessions/:uid/messages` → `POST /sessions/:uid/end`
- `score-session` BullMQ job: LLM call per criterion → `score_results` rows; updates `session.status = COMPLETED`
- Session queries + export job
- LLM call → in-memory accumulator → `flush-llm-events` job batch-inserts to ClickHouse `llm_events` (token counts, model, cost, latency)

**Exit gate:** create persona → PATCH (verify version snapshot created) → start session → end session → `score_results` rows exist in Postgres → `llm_events` row exists in ClickHouse with token counts

---

### Phase 3 — LLM Registry & Realtime Text Chat (Weeks 6–8)

- Prisma migrations: `llm_providers`, `llm_models`, `llm_credentials`
- LLM ops admin API + **BYOK credential vault** (encrypted, write-only/masked) + `refresh-model-cache` (Redis pub/sub busts `ModelFactoryService` cache on change — no gateway)
- `ModelFactoryService`: logical-role → registry → decrypted cred → LangChain chat model; `.withFallbacks()`
- `POST /auth/realtime/ticket` — one-time 30s WS ticket stored in Redis
- **Chat gateway (`/realtime/chat`) — the core deliverable:**
  - **LangGraph `StateGraph` roleplay engine** (`roleplay-graph.ts`, ports legacy `utils/new_chat.py`); streamed via `graph.stream()`
  - **`PostgresSaver` checkpointer** (`thread_id = session.uid`) — durable, horizontal-scale-safe
  - Session liveness/routing in Redis registry (`session:{uid}` TTL)
  - Reconnect/resume: replay missed `message_done` from checkpoint + Postgres on `resume`
  - Graceful drain on SIGTERM: close new connections, send `reconnect` advisory, flush registry
- Prompt-regression fixture suite: runs against any model before `POST /llm/models/:id/promote`
- **Voice: DEFERRED** (text-only focus). When built, two options (see §9): client-side STT/TTS over the same text WS (no backend change), or a server-side `/realtime/voice` gateway. Not in this phase.

**Exit gate:** WS chat → 3 turns → disconnect → reconnect with `lastMessageId` → server replays missed turn from the Postgres checkpoint → continues; `POST /llm/providers` + key → next turn uses it (cache refreshed), no restart; SIGTERM → clients get `reconnect`

---

### Phase 4 — Files, Analytics, Dashboards (Weeks 9–10)

**Files:**
- Simple upload/download via `StorageService` (S3 adapter); MIME + size validation; pre-signed URL generation

**Analytics + ClickHouse:**
- `ClickHouseService` in `core/clickhouse/` (thin `@clickhouse/client` wrapper)
- ClickHouse tables: `llm_events`, `session_events`, `telemetry_events` (MergeTree engine, no migrations — DDL in migration script)
- `flush-llm-events` + `flush-telemetry` BullMQ jobs (every 30s) → batch-insert to ClickHouse
- `score-session` job inserts `session_events` row after scoring completes
- Analytics + dashboard endpoints (`GET /analytics/*`, `GET /dashboard/*`, `GET /llm/usage`) call `ClickHouseService.query<T>()` — zero Postgres reads for analytics
- Export jobs: ClickHouse query → exceljs stream → storage → pre-signed URL

**Audit:**
- Prisma client extension reads CLS actor context → `audit_logs` rows in Postgres (replaces PG trigger `log_audit()`)

**Dashboards (core):**
- `dashboard` module: `GET /dashboard/admin|trainer|me` — role-scoped reporting from ClickHouse `session_events`/`llm_events` + Postgres
- Admin **token-usage-by-provider/model + cost** panel (group `llm_events`); trainer supervisee rollups; trainee own progress
- Object-level scope enforced in service (supervisor mapping)

> **Gamification + leaderboard deferred** to a later phase (badges, streaks, performance-score ranking, `/leaderboard*`, `/badges*`).

**Exit gate:** upload file → `GET /files/:fileId` returns pre-signed URL; `GET /dashboard/admin` returns token-usage-by-provider from ClickHouse (verify zero Postgres analytics reads); `GET /dashboard/trainer` scoped to own supervisees; `GET /dashboard/me` returns own progress; session end → `session_events` row in ClickHouse

---

### Phase 5 — Production Hardening & Cutover (Weeks 11–13)

**Infrastructure:**
- Helm charts: `api` (HPA on CPU), `realtime` (HPA on connection count), `worker` (HPA on queue depth) — no LiteLLM gateway chart (LangChain runs in-app)
- PodDisruptionBudgets; preStop drain hook for `realtime` pods
- Terraform/OpenTofu modules: cluster, postgres, redis, clickhouse, storage, DNS, secrets
- PgBouncer in transaction mode
- External Secrets Operator (all credentials out of env files)
- OTel auto-instrumentation; Prometheus metrics; Grafana + Loki + Tempo dashboards; SLO alert rules

**SLOs:**
- API p95 < 300 ms
- WS first-token < 2 s
- Voice round-trip < 800 ms
- Availability 99.5%

**Load testing (k6):**
- 500 concurrent WS chat sessions, sustained 5 min
- Login endpoint: 1000 req/min burst
- Dashboard endpoints under 100 concurrent users

**Security:**
- Full pen-test pass
- `Permissions-Policy` header added

**Data migration (`tools/migration/`):**
- ETL scripts: legacy Postgres → new Prisma schema
- `custom_alfa` → `personas`, `custom_alfa_sessions` → `sessions`, `mapped_customalfas` JSON array → `personaId` FK on users
- `custom_alfa_chat_history` → `chat_messages`, etc.
- Rehearse on staging snapshots; verify row counts + data integrity

**Cutover:**
- Parallel run: NestJS `/api/v1` alongside legacy `/api` on migrated data
- Consumer switches endpoint base URL; soak period (≥ 2 weeks)
- Legacy FastAPI decommissioned

**Exit gate:** k6 load test passes SLOs; SIGTERM on realtime pod → clients receive `reconnect`, reconnect to another pod, continue session without data loss; pen-test report no criticals

---

### Phase 6 — Enhancements (Quarter 2)

- **Gamification & Leaderboard** (deferred from core): `badge_definitions`/`user_badges`/`user_streaks`/`user_performance_scores`, the 4 gamification jobs, `/leaderboard*` + `/badges*` endpoints (global scope), 17 badges (§11)
- **Voice** (deferred): pick an approach (§9) — client-side STT/TTS over the text WS (no backend change), or server-side `/realtime/voice` gateway (`GeminiLiveProvider`/`AzureVoiceLiveProvider`/`OpenAIRealtimeProvider`, or OSS LiveKit + open STT/TTS)
- Generated OpenAPI client SDKs (CI-generated from Zod contracts in `packages/contracts`)
- Notification system: session completed, badge earned + webhooks
- Full-text search (`tsvector`) over personas
- pgvector semantic search (no separate vector DB until proven necessary)
- LMS/xAPI export for training-industry integrations
- E3–E5 (playground analytics isolation, semantic cache, context pruning) from ENHANCEMENT_PLAN

---

## 15. Environment Variables

```env
# ── App ──────────────────────────────────────
NODE_ENV=development|staging|production
APP_ROLE=api|realtime|worker
PORT=3000
CORS_ORIGINS=https://app.example.com,https://admin.example.com

# ── Database ─────────────────────────────────
DATABASE_URL=postgresql://user:pass@pgbouncer:5432/alfa?pgbouncer=true&connection_limit=5
DATABASE_POOL_SIZE=5

# ── Redis ─────────────────────────────────────
REDIS_URL=redis://redis:6379

# ── Auth ──────────────────────────────────────
JWT_ACCESS_SECRET=              # min 64 chars
JWT_ACCESS_TTL_SECONDS=900      # 15 min
JWT_REFRESH_SECRET=             # min 64 chars, different from access
JWT_REFRESH_TTL_SECONDS=604800  # 7 days
WS_TICKET_TTL_SECONDS=30

# ── LLM (LangChain / LangGraph — BYOK credential vault) ──
MASTER_ENCRYPTION_KEY=          # base64 32 bytes — encrypts llm_credentials (E6); the ONLY LLM secret in env
# Provider API keys are NOT in env — Super Admin enters them at runtime; stored encrypted in llm_credentials.
# Local models (vLLM/Ollama): register a `local` provider with baseUrl in the DB; no env key needed.

# ── Object storage ────────────────────────────
STORAGE_PROVIDER=s3|azure
# S3 / MinIO / GCS-interop
S3_ENDPOINT=                    # blank = AWS default
S3_BUCKET=alfa-storage
S3_REGION=
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
# Azure Blob (when STORAGE_PROVIDER=azure)
AZURE_BLOB_CONNECTION_STRING=
AZURE_BLOB_CONTAINER=alfa-storage

# ── External auth (optional) ──────────────────
CREDENTIAL_VERIFIER=local|external
EXTERNAL_AUTH_URL=
EXTERNAL_AUTH_METHOD=POST
EXTERNAL_AUTH_HEADER_KEY=
EXTERNAL_AUTH_HEADER_VALUE=     # resolved from secret manager in prod

# ── ClickHouse ────────────────────────────────
CLICKHOUSE_URL=http://clickhouse:8123
CLICKHOUSE_DATABASE=alfa
CLICKHOUSE_USERNAME=default
CLICKHOUSE_PASSWORD=

# ── Rate limiting ──────────────────────────────
THROTTLE_TTL_MS=60000
THROTTLE_LIMIT=100              # global
THROTTLE_LOGIN_LIMIT=5          # /auth/login strict bucket

# ── Uploads (avatars, bulk-import, generic /files) ──
UPLOAD_MAX_FILE_MB=50
UPLOAD_ALLOWED_AVATAR_MIME=image/png,image/jpeg,image/webp
UPLOAD_ALLOWED_IMPORT_MIME=application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv

# ── Worker ────────────────────────────────────
WORKER_CONCURRENCY=5

# ── Observability ─────────────────────────────
LOG_LEVEL=info
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
SENTRY_DSN=                     # optional
```

---

## 16. Testing Strategy

| Layer | Tool | Scope |
|---|---|---|
| Unit | Jest + SWC | services, guards, envelope/error mapping, registry resolution, token accounting, gamification score formula |
| Integration | Jest + Supertest + Testcontainers (real Postgres + Redis + ClickHouse) | every endpoint: happy path, 401, 403, 409, validation, pagination edges; analytics endpoints verify ClickHouse reads |
| WS / E2E | Jest + `ws` client | chat lifecycle, reconnect contract, voice control frames, end-session scoring |
| LLM contract | mocked LangChain models (recorded fixtures) | streaming parse, `.withFallbacks()` behavior, `[CONVERSATION_ENDED]` handling, LangGraph checkpoint resume |
| Prompt regression | promptfoo / fixture suite | model-promotion gate — required before `POST /llm/models/:id/promote` |
| Load | k6 | WS concurrency (500 sessions), login burst, dashboard concurrency |

**Coverage gate:** 80% on `src/modules` and `src/core`. TDD per feature. CI fails below gate. MSW mocks generated from OpenAPI spec so frontend tests break when contract drifts.

---

## 17. White-Label Checklist

Required before deploying to any client. None of these should require code changes — only env/DB config.

- [ ] System prompts in `chat.gateway.ts` + `voice.gateway.ts` contain no client names; all persona-specific identity lives in `customInstructions` DB field
- [ ] `POST /personas/:id/enhance` LLM instructions strip client names (port logic from legacy `enhance_prompt`, not the hardcoded name list)
- [ ] `CredentialVerifier` selected by `CREDENTIAL_VERIFIER` env var; external auth URL in `external_apis` DB table + env — no Sutherland/client-specific URL in source
- [ ] Storage object paths use generic prefix (`{orgId}/{type}/`), not client name
- [ ] Log messages, error strings, and pino redaction patterns contain no client names
- [ ] New client onboarding = set env vars + insert DB rows → zero code change required

---

## 18. Verification Per Phase

| Phase | Checks |
|---|---|
| **0** | `docker compose up --build` → all services healthy; `GET /health` 200; `GET /ready` 200 with db/redis/clickhouse ok; CI green |
| **1** | Login → JWT; no-token request → 401; wrong-role request → 403; 1000-row XLSX import → ImportReport completed with error file for bad rows; refresh reuse → 401 + family revoked |
| **2** | Create persona → PATCH → verify `persona_versions` row exists; start session → end session → `score_results` rows exist; `llm_events` row (ClickHouse) with token counts present |
| **3** | WS chat → 3 turns → disconnect → reconnect with `lastMessageId` → missed turn replayed → session continues; `POST /llm/providers` → job runs → gateway config updated without restart |
| **4** | Upload file → `GET /files/:fileId` returns pre-signed URL; `GET /analytics/overview` reads from rollup (no live scan); session end → badge job → row in `user_badges`; leaderboard ranked list with performance scores |
| **5** | k6: 500 WS sessions 5 min sustained, p95 < 300ms API, voice < 800ms; SIGTERM on realtime pod → clients reconnect to other pod, session continues; pen-test zero criticals |
