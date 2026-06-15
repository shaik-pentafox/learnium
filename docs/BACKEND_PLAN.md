# ALFA Learnium — Backend Implementation Plan (NestJS)

Companion to [PRODUCT_PLAN.md](./PRODUCT_PLAN.md). That document defines the product scope, gap analysis, and target architecture; this one defines **how the backend gets built: NestJS, the detailed stack, project structure, and delivery phases**.

Decision: the backend is **rebuilt in NestJS (TypeScript)** rather than evolving the existing FastAPI codebase. The existing Python app remains the reference implementation and stays running until cutover.

**Why NestJS works now (it didn't before):** the original concern was that LLM tooling lives in Python. The architecture removes that dependency — all chat/scoring LLM traffic goes through the **LiteLLM gateway** in OpenAI format, so the backend only ever needs one OpenAI-compatible client. No LangChain/LangGraph required. Realtime voice uses provider WebSocket protocols, which TypeScript handles as well as Python.

---

## 1. Stack

| Concern | Choice | Packages / Notes |
|---|---|---|
| Runtime | Node.js 22 LTS | |
| Framework | NestJS 11 | `@nestjs/core`, modular DI, guards/interceptors/pipes |
| Language | TypeScript 5.x strict | `noUncheckedIndexedAccess`, ESM |
| Package manager | pnpm + workspaces | monorepo-ready for the future frontend |
| HTTP adapter | Fastify | `@nestjs/platform-fastify` — faster than Express, better under load |
| Database | PostgreSQL 16 | PgBouncer in front |
| ORM / migrations | **Prisma** | Prisma Migrate for schema versioning; `$queryRaw` (tagged template, auto-parameterized) for the heavy analytics SQL; client extensions for soft-delete + audit columns |
| Validation / contracts | **Zod** end-to-end | `nestjs-zod`; schemas live in `packages/contracts`, shared with any future frontend |
| API docs | OpenAPI generated from Zod | `zod-openapi` / `@nestjs/swagger` bridge; SDKs generated from the spec |
| AuthN | JWT access (15 min) + rotating refresh tokens | `@nestjs/passport`, `passport-jwt`, `argon2` for local credentials; pluggable `CredentialVerifier` (local / external corporate auth API) |
| AuthZ | RBAC guard + permission decorators | `@Roles()` / `@Permissions()` on the existing role model |
| LLM access | **OpenAI SDK → LiteLLM gateway** | one client, OpenAI format; providers (OpenAI, Gemini, Azure OpenAI, OpenRouter, OSS models) are gateway/registry config |
| Voice realtime | `VoiceProvider` interface | Gemini Live via `@google/genai` (JS Live API); Azure VoiceLive via its WebSocket protocol; OpenAI Realtime addable |
| WebSockets | Nest gateways on raw `ws` | `@nestjs/platform-ws` — binary PCM16 frames, no socket.io overhead; Redis pub/sub for cross-pod signaling |
| Cache / sessions / rate limit | Redis 7 (Valkey-compatible) | `ioredis`; session registry, reconnect state, limiter buckets |
| Background jobs | **BullMQ** | `@nestjs/bullmq` — bulk imports, exports, stat rollups, retention purge, telemetry flush |
| Object storage | `StorageService` interface | adapters: S3-compatible (`@aws-sdk/client-s3`, covers MinIO/GCS-interop), Azure Blob (`@azure/storage-blob`) |
| Rate limiting | `@nestjs/throttler` + Redis storage | strict bucket on login |
| Logging | pino | `nestjs-pino`, request-id correlation, redaction |
| Observability | OpenTelemetry | `@opentelemetry/auto-instrumentations-node` → Prometheus / Grafana / Loki / Tempo; Sentry OSS for errors |
| Excel import/export | `exceljs` (streaming) | bulk user import, dashboard exports |
| Testing | Jest (+SWC), Supertest, Testcontainers | real Postgres + Redis in integration tests; k6 for load |
| Lint/format | ESLint (typescript-eslint strict) + Prettier | pre-commit via husky + lint-staged |
| CI/CD | repo-host pipeline | lint → typecheck → unit → integration → build + scan → Helm deploy |
| Containers | Docker multi-stage (distroless/alpine, non-root) | docker-compose for local dev (postgres, redis, minio, litellm) |

---

## 2. Repository Structure

Monorepo from day one.

```
alfa-learnium/
├── apps/
│   ├── api/                          # NestJS backend (this plan)
│   └── web/                          # React SPA — see FRONTEND_PLAN.md
├── packages/
│   ├── contracts/                    # Zod schemas + inferred types — single source of truth
│   │                                 # entities, request/response DTOs, envelope, error codes,
│   │                                 # pagination, WS message protocol types
│   └── tsconfig/                     # shared TS config bases
├── infra/
│   ├── docker/                       # Dockerfile, docker-compose.yml (pg, redis, minio, litellm)
│   ├── helm/                         # api, realtime, worker, gateway charts
│   └── terraform/                    # cloud-agnostic modules
├── tools/migration/                  # data migration scripts from the legacy database
├── pnpm-workspace.yaml
└── turbo.json
```

### 2.1 `apps/api` structure

One NestJS codebase, **three run targets** (same image, different entrypoint/env) so the WS tier scales independently:

- `api` — REST modules only
- `realtime` — WS gateways only
- `worker` — BullMQ processors only

```
apps/api/src/
├── main.ts                           # bootstrap per ROLE env: api | realtime | worker
├── app.module.ts                     # conditional module loading by role
├── core/                             # cross-cutting, no business logic
│   ├── config/                       # @nestjs/config + Zod env schema (fail fast)
│   ├── database/                     # PrismaService, client extensions:
│   │                                 #   soft-delete filter injection, audit columns (CLS)
│   ├── auth/                         # strategies, JwtAuthGuard (global), RolesGuard,
│   │   │                             # @Public(), @CurrentUser(), refresh rotation service
│   │   └── verifiers/                # CredentialVerifier interface:
│   │                                 #   local (argon2 vs seeded users), external-api
│   ├── redis/                        # ioredis provider, distributed locks, pub/sub
│   ├── storage/                      # StorageService iface + s3 / azure-blob adapters
│   ├── llm/                          # see §4
│   │   ├── llm-client.service.ts     # OpenAI SDK → LiteLLM gateway (chat, stream, embeddings)
│   │   ├── registry/                 # provider/model registry service + admin sync
│   │   ├── cost/                     # token accounting → llm_logs
│   │   └── voice/                    # VoiceProvider iface + gemini-live / azure-voicelive impls
│   ├── envelope/                     # response interceptor {status, message, data, meta}
│   ├── errors/                       # typed domain errors + global exception filter → 4xx/5xx
│   ├── pagination/                   # PageQuery pipe + paginated envelope helper
│   └── telemetry/                    # request-activity interceptor → in-memory accumulator
│                                     # (flushed by worker job, never per-request writes)
├── modules/
│   ├── identity/                     # users, roles, org groupings (job categories,
│   │   │                             # business domains, training cohorts), supervisor mapping
│   │   ├── identity.controller.ts    # /v1/users, /v1/roles, /v1/groups...
│   │   ├── identity.service.ts
│   │   ├── identity.repository.ts
│   │   └── import/                   # bulk XLSX/CSV import (enqueue → worker processes)
│   ├── personas/                     # roleplay persona CRUD, versioning, scoring config,
│   │                                 # voice styles, prompt-enhancement endpoint
│   ├── sessions/                     # session lifecycle, chat history, scoring + feedback
│   │                                 # generation (LLM), session queries/exports
│   ├── realtime/                     # loaded only in realtime role
│   │   ├── ticket.controller.ts      # POST /v1/realtime/ticket (one-time WS auth)
│   │   ├── chat.gateway.ts           # text roleplay WS
│   │   ├── voice.gateway.ts          # voice roleplay WS (binary PCM16)
│   │   └── session-registry.ts       # Redis-backed live-session state + resume
│   ├── content/                      # videos/docs library, reactions, archive/restore,
│   │                                 # configurable UI buttons
│   ├── analytics/                    # dashboards reading rollup tables; export jobs
│   ├── llmops/                       # /v1/llm/providers, /v1/llm/models admin API,
│   │                                 # usage/cost dashboard endpoints
│   └── notifications/                # (phase 4) events + webhooks
├── workers/                          # BullMQ processors: import, export, rollups,
│                                     # retention purge, telemetry flush, registry sync
└── health/                           # /health (liveness), /ready (DB+Redis+gateway probes)
```

Module rules: controllers/gateways do transport only; services hold business logic; repositories own data access (Prisma or `$queryRaw`); modules talk to each other through exported services, never repositories.

---

## 3. Cross-Cutting Design

### 3.1 API contract
- Everything under `/api/v1`, REST-correct verbs (PATCH partial update, DELETE delete), real HTTP status codes.
- Uniform envelope `{status, message, data, meta}` via interceptor; global exception filter maps typed domain errors → 4xx/5xx.
- Pagination: `page`/`limit` (1–100), `meta: {total, page, limit, totalPages}`.
- OpenAPI spec generated from Zod contracts; client SDKs generated in CI.

### 3.2 AuthN / AuthZ
- Login: TLS-only JSON body (no AES-ECB payload encryption; AES-GCM adapter only if an external contract forces it).
- `CredentialVerifier` strategy: `local` (argon2 against seeded users) and `external` (corporate auth API) — selected by config.
- Access JWT 15 min; refresh token rotation with family-reuse detection, stored hashed, revoked on logout.
- Global `JwtAuthGuard` (default-deny) + `@Public()` opt-out — analytics and LLM dashboards are protected by default, fixing the legacy gaps.
- RBAC: permissions per module action mapped to the five roles; `@Permissions('users:write')` style guard. Object-level checks in services (own-data access for dashboards/history).
- WS auth: `POST /v1/realtime/ticket` returns a one-time short-lived ticket; gateways validate and consume it — no JWT in query strings.

### 3.3 Data layer
- Prisma schema is a **clean redesign informed by the legacy schema** (~25 tables), fixing: missing FK constraints, JSON-array ID columns where join tables belong (group mappings, persona mappings → proper M:N tables), inconsistent audit columns, soft-delete drift.
- Soft delete + audit columns (`createdBy/At`, `modifiedBy/At`) enforced via Prisma client extension reading request context (AsyncLocalStorage) — impossible to forget.
- High-growth tables (chat history, llm_logs, audit_logs, telemetry) partitioned by month via raw SQL migrations; retention purge job archives to object storage.
- Analytics: BullMQ rollup jobs materialize aggregates into summary tables; dashboard endpoints read rollups only. Heavy SQL lives in repositories as `$queryRaw` tagged templates (parameterized by construction).
- Seeds: idempotent `prisma db seed` command (roles, statuses, voice styles, default models) — never at app boot.

### 3.4 Realtime design
- Gateways on raw `ws`; text protocol = JSON messages, voice = binary PCM16 frames + JSON control messages (typed in `packages/contracts`).
- **Session registry in Redis**: `session:{id}` → status, persona, resolved model, history cursor, pod, last-seen (TTL).
- Conversation state = chat history in Postgres + registry cursor; any pod can resume. Reconnect contract: client sends session id + last message id, server replays the delta and continues.
- Sticky sessions at ingress for live connections; Redis pub/sub for cross-pod control (force-end, admin broadcast).
- Graceful drain on SIGTERM: stop accepting, send `reconnect` advisory, flush registry, exit.
- Backpressure: bounded per-session queues, drop-oldest for audio frames, per-user concurrent-session cap in Redis.

---

## 4. LLM Platform Layer (core requirement)

**One client, many providers.** The backend speaks OpenAI chat-completions format to the LiteLLM gateway. Providers — **OpenAI, Google Gemini, Azure OpenAI, OpenRouter**, plus any OpenAI-compatible endpoint (vLLM, Ollama, Together, Groq) — are configuration.

1. **`LlmClientService`** (`core/llm`): thin wrapper over the official `openai` SDK pointed at the gateway. Streaming for chat, non-streaming for scoring/feedback, timeout + abort handling, token usage extraction → `llm_logs`.

2. **Provider/model registry (DB, admin-configurable):**
   - `llm_providers`: type (`openai | gemini | azure_openai | openrouter | custom`), base URL, credential **reference** (secret name, never the key), enabled, priority, monthly budget.
   - `llm_models`: name, provider FK, capabilities (chat/stream/voice/vision), context window, input/output price per million tokens, default flag.
   - Personas reference models by **logical role** (`conversationModel`, `scoringModel`) resolved through the registry at session start — no hardcoded model strings anywhere.
   - `POST/PATCH /v1/llm/providers|models` admin API; a registry-sync job pushes changes to the gateway config. Provider swap = rows + default flip, zero deploys.

3. **Routing & resilience:** per-persona primary model + ordered fallback list executed by the gateway; gateway health signals demote failing providers; budget enforcement at the gateway, actuals reconciled against `llm_logs`.

4. **Voice (`VoiceProvider` interface):** `connect / sendAudio / onAudio / interrupt / end`. Implementations: Gemini Live (`@google/genai`), Azure VoiceLive (WebSocket protocol client). Selected per persona/request via the registry. OpenAI Realtime is a third implementation when needed; OSS pipeline (LiveKit + open STT/TTS) remains the long-term exit door.

5. **Prompt-regression gate:** recorded-fixture eval suite (promptfoo or Jest-based) runs persona behavior + scoring stability against any candidate model; passing is required before a model can be promoted to default in the registry.

---

## 5. Testing & Quality

| Layer | Tool | Scope |
|---|---|---|
| Unit | Jest + SWC | services, guards, envelope/error mapping, registry resolution, token accounting |
| Integration | Jest + Supertest + Testcontainers (Postgres, Redis) | every endpoint: happy path, authz failure, validation, pagination edges, duplicate keys |
| WS / E2E | Jest + `ws` client | chat lifecycle, reconnect contract, voice control frames, end-session scoring |
| LLM contract | mocked gateway (recorded fixtures) | streaming parse, fallback behavior, conversation-end handling |
| Prompt regression | promptfoo / fixture suite | model-promotion gate (§4.5) |
| Load | k6 | WS concurrency, login, dashboards |

80% coverage gate in CI. TDD per feature: failing test → implement → refactor. Contracts package gives compile-time API-drift protection for any future frontend.

---

## 6. Delivery Phases

### Phase 0 — Scaffold & foundations (week 1)
Monorepo (pnpm + turbo), `apps/api` NestJS skeleton on Fastify, `packages/contracts` with envelope/pagination/error types, Zod-validated config, docker-compose (postgres, redis, minio, litellm), Prisma init + baseline schema draft, CI skeleton (lint, typecheck, unit), pino logging + request IDs, health/ready endpoints, global envelope interceptor + exception filter.

**Exit:** `docker compose up` runs the stack; CI green on an empty-but-wired app.

### Phase 1 — Identity & auth (weeks 2–3)
Prisma schema for identity (users, roles, groupings, supervisor mapping) + first migrations + seeds. Login with `CredentialVerifier` (local + external), argon2, JWT access + refresh rotation, logout revocation. Global auth guard + `@Public()`, RBAC guard + permissions map, login throttling. Users/roles/groups CRUD with pagination/search, soft delete, audit columns via client extension. Bulk import job (BullMQ + exceljs streaming) with import report tracking. Integration tests throughout.

**Exit:** identity domain fully usable and tested; auth model final.

### Phase 2 — Personas & sessions (weeks 4–5)
Persona CRUD with versioning (every edit snapshots a version row), scoring config, voice styles, prompt-enhancement endpoint (first `LlmClientService` consumer). Session lifecycle (start → history → end), scoring + feedback generation via gateway, `llm_logs` writing, session queries + Excel export job.

**Exit:** complete roleplay loop works over REST (no WS yet) against any configured provider.

### Phase 3 — LLM registry & realtime (weeks 6–8)
Provider/model registry tables + admin API + gateway sync (**OpenAI, Gemini, Azure OpenAI, OpenRouter configurable at runtime**); logical-role model resolution; fallback chains. Realtime run target: ticket auth, chat gateway (streaming roleplay), Redis session registry + reconnect contract, graceful drain. Voice gateway behind `VoiceProvider` with Gemini Live + Azure VoiceLive implementations; backpressure + session caps. Prompt-regression suite wired as registry promotion gate.

**Exit:** full text + voice roleplay over WS, horizontally scalable, provider-swappable via admin API.

### Phase 4 — Content, analytics, llmops (weeks 9–10)
Content library (upload via `StorageService`, validation: extension/MIME allowlist + size caps, group-scoped visibility, soft-delete/restore/archive, reactions, UI buttons). Analytics rollup jobs + dashboard endpoints (cohort/user/persona/version) + exports. LLM usage/cost dashboard from `llm_logs` reconciled with gateway spend. Telemetry interceptor + batch flush job. Audit logging (Prisma extension or DB triggers).

**Exit:** feature parity with the legacy backend on `/api/v1`.

### Phase 5 — Production hardening & cutover (weeks 11–13)
Helm charts (api/realtime/worker/gateway), Terraform modules, PgBouncer, External Secrets. OTel + Prometheus + Grafana + Loki + Sentry; SLO dashboards + alert rules. Load tests (k6) against SLOs (API p95 < 300 ms, WS first-token < 2 s, voice round-trip < 800 ms). Security review/pen test. **Data migration:** `tools/migration` ETL scripts (legacy Postgres → new schema, JSON-array mappings → join tables), rehearsed on staging snapshots. Parallel run: new API alongside legacy on migrated data, consumer switches, soak period, legacy retired.

**Exit:** production traffic on NestJS backend; legacy decommissioned.

### Phase 6 — Product enhancements (quarter 2)
Generated client SDKs, notifications + webhooks, full-text + pgvector search, multi-tenancy groundwork (tenant scoping), LMS/xAPI export, optional OSS voice pipeline (LiveKit + open STT/TTS) as an additional `VoiceProvider`.

---

## 7. Database Schema (Prisma)

Clean redesign — no client-specific column names, no JSON-array FK hacks, proper join tables, all constraints enforced. High-growth tables noted for monthly partitioning.

```prisma
// ─────────────────────────────────────────────
// ENUMS
// ─────────────────────────────────────────────

enum Role {
  SUPER_ADMIN   // full platform control
  TRAINER       // persona config, content, group analytics
  USER          // trainee — sessions, own scores, leaderboard
}

enum ConsoleType {
  MODERATOR
  USER
  BOTH
}

enum SessionStatus {
  IN_PROGRESS
  COMPLETED
  ABANDONED
}

enum ProviderType {
  OPENAI
  GEMINI
  AZURE_OPENAI
  OPENROUTER
  CUSTOM
}

enum ModelCapability {
  CHAT
  STREAMING
  VOICE
  VISION
  EMBEDDINGS
}

enum ContentType {
  VIDEO
  DOCUMENT
}

enum ImportStatus {
  PENDING
  PROCESSING
  COMPLETED
  FAILED
}

enum AuditOperation {
  INSERT
  UPDATE
  DELETE
}

// ─────────────────────────────────────────────
// IDENTITY
// ─────────────────────────────────────────────

model RoleDef {
  id          Int      @id @default(autoincrement())
  name        Role     @unique
  description String?
  users       User[]
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  @@map("role_defs")
}

model User {
  id               Int       @id @default(autoincrement())
  username         String
  employeeId       String    @unique               // was nt_id; generic identifier
  email            String?   @unique
  passwordHash     String?                          // null for external-auth users
  roleId           Int
  role             RoleDef   @relation(fields: [roleId], references: [id])
  gender           String?
  country          String?
  program          String?
  isActive         Boolean   @default(true)
  isDeleted        Boolean   @default(false)
  deletedAt        DateTime?
  avatarUrl        String?
  cartoonAvatarUrl String?
  preferredVoiceId Int?
  preferredVoice   AssistantVoice? @relation(fields: [preferredVoiceId], references: [id])
  // supervisor self-reference
  supervisorId     Int?
  supervisor       User?     @relation("Supervision", fields: [supervisorId], references: [id])
  supervisees      User[]    @relation("Supervision")
  // relations
  groups           UserGroup[]
  cohorts          UserCohort[]
  sessions         Session[]
  telemetry        UserTelemetry[]
  telemetryDaily   UserTelemetryDaily[]
  refreshTokens    RefreshToken[]
  createdBy        Int?
  createdAt        DateTime  @default(now())
  modifiedBy       Int?
  updatedAt        DateTime  @updatedAt
  @@map("users")
}

model AssistantVoice {
  id         Int      @id @default(autoincrement())
  name       String   @unique
  gender     String
  country    String?
  speechStyle String?
  users      User[]
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  @@map("assistant_voices")
}

// Org groupings (was "jcs" / job categories — generic name)
model Group {
  id          Int          @id @default(autoincrement())
  name        String       @unique
  description String?
  members     UserGroup[]
  personas    PersonaGroup[]
  content     ContentItem[]
  cohorts     Cohort[]
  sessions    Session[]
  importReports ImportReport[]
  createdBy   Int?
  createdAt   DateTime     @default(now())
  modifiedBy  Int?
  updatedAt   DateTime     @updatedAt
  @@map("groups")
}

model UserGroup {
  userId    Int
  groupId   Int
  user      User  @relation(fields: [userId], references: [id], onDelete: Cascade)
  group     Group @relation(fields: [groupId], references: [id], onDelete: Cascade)
  assignedAt DateTime @default(now())
  assignedBy Int?
  @@id([userId, groupId])
  @@map("user_groups")
}

model Domain {
  id          Int       @id @default(autoincrement())
  name        String    @unique
  description String?
  subDomains  SubDomain[]
  createdBy   Int?
  createdAt   DateTime  @default(now())
  modifiedBy  Int?
  updatedAt   DateTime  @updatedAt
  @@map("domains")
}

model SubDomain {
  id        Int     @id @default(autoincrement())
  name      String
  domainId  Int
  domain    Domain  @relation(fields: [domainId], references: [id])
  @@unique([name, domainId])
  @@map("sub_domains")
}

// Training waves / cohorts (was "wave_masters")
model Cohort {
  id          Int          @id @default(autoincrement())
  name        String       @unique
  description String?
  groupId     Int?
  group       Group?       @relation(fields: [groupId], references: [id])
  members     UserCohort[]
  sessions    Session[]
  createdBy   Int?
  createdAt   DateTime     @default(now())
  modifiedBy  Int?
  updatedAt   DateTime     @updatedAt
  @@map("cohorts")
}

model UserCohort {
  userId   Int
  cohortId Int
  user     User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  cohort   Cohort @relation(fields: [cohortId], references: [id], onDelete: Cascade)
  enrolledAt DateTime @default(now())
  @@id([userId, cohortId])
  @@map("user_cohorts")
}

// ─────────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────────

model RefreshToken {
  id          String    @id @default(cuid())
  tokenHash   String    @unique              // bcrypt hash of the raw token
  familyId    String                         // all tokens in one rotation chain
  userId      Int
  user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  isRevoked   Boolean   @default(false)
  expiresAt   DateTime
  createdAt   DateTime  @default(now())
  @@index([userId])
  @@index([familyId])
  @@map("refresh_tokens")
}

// One-time WS auth tickets (short TTL, consumed on use)
model RealtimeTicket {
  id        String   @id @default(cuid())
  userId    Int
  usedAt    DateTime?
  expiresAt DateTime
  createdAt DateTime @default(now())
  @@map("realtime_tickets")
}

// Seeded local-dev credentials (ENVIRONMENT=local only)
model DefaultCredential {
  id           Int      @id @default(autoincrement())
  identifier   String   @unique
  passwordHash String
  roleId       Int
  createdAt    DateTime @default(now())
  @@map("default_credentials")
}

// ─────────────────────────────────────────────
// PERSONAS (was custom_alfa)
// ─────────────────────────────────────────────

model VoiceStyle {
  id        Int       @id @default(autoincrement())
  name      String    @unique
  personas  Persona[]
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  @@map("voice_styles")
}

model Persona {
  id                     Int              @id @default(autoincrement())
  name                   String           @unique
  consoleType            ConsoleType      @default(BOTH)
  customInstructions     String           @db.Text
  feedbackPrompt         String           @db.Text
  scoringPrompt          String           @db.Text
  currentVersion         Int              @default(1)
  conversationModelId    Int?             // logical role → resolved via registry
  conversationModel      LlmModel?        @relation("ConversationModel", fields: [conversationModelId], references: [id])
  scoringModelId         Int?
  scoringModel           LlmModel?        @relation("ScoringModel", fields: [scoringModelId], references: [id])
  voiceStyleId           Int?
  voiceStyle             VoiceStyle?      @relation(fields: [voiceStyleId], references: [id])
  domainId               Int?
  domain                 Domain?          @relation(fields: [domainId], references: [id])
  // relations
  groups                 PersonaGroup[]
  versions               PersonaVersion[]
  scoreCriteria          ScoreCriterion[]
  sessions               Session[]
  isDeleted              Boolean          @default(false)
  deletedAt              DateTime?
  createdBy              Int?
  createdAt              DateTime         @default(now())
  modifiedBy             Int?
  updatedAt              DateTime         @updatedAt
  @@map("personas")
}

model PersonaGroup {
  personaId Int
  groupId   Int
  persona   Persona @relation(fields: [personaId], references: [id], onDelete: Cascade)
  group     Group   @relation(fields: [groupId], references: [id], onDelete: Cascade)
  @@id([personaId, groupId])
  @@map("persona_groups")
}

// Snapshot of every persona state at the time of edit
model PersonaVersion {
  id                 Int      @id @default(autoincrement())
  personaId          Int
  persona            Persona  @relation(fields: [personaId], references: [id])
  version            Int
  label              String?
  customInstructions String   @db.Text
  feedbackPrompt     String   @db.Text
  scoringPrompt      String   @db.Text
  consoleType        ConsoleType
  conversationModelId Int?
  scoringModelId     Int?
  scoreCriteriaSnapshot Json  // snapshot of criteria at version time
  createdBy          Int?
  createdAt          DateTime @default(now())
  @@unique([personaId, version])
  @@map("persona_versions")
}

// Scoring rubric — proper rows instead of JSON column
model ScoreCriterion {
  id          Int       @id @default(autoincrement())
  personaId   Int
  persona     Persona   @relation(fields: [personaId], references: [id], onDelete: Cascade)
  label       String                         // displayed name
  description String    @db.Text             // what the LLM scores against
  maxScore    Int       @default(10)
  order       Int       @default(0)
  results     ScoreResult[]
  @@map("score_criteria")
}

// ─────────────────────────────────────────────
// SESSIONS
// ─────────────────────────────────────────────

model Session {
  id                    Int           @id @default(autoincrement())
  uid                   String        @unique @default(cuid())   // stable client-facing id
  userId                Int
  user                  User          @relation(fields: [userId], references: [id])
  personaId             Int
  persona               Persona       @relation(fields: [personaId], references: [id])
  personaVersion        Int
  groupId               Int?
  group                 Group?        @relation(fields: [groupId], references: [id])
  cohortId              Int?
  cohort                Cohort?       @relation(fields: [cohortId], references: [id])
  status                SessionStatus @default(IN_PROGRESS)
  startedAt             DateTime      @default(now())
  endedAt               DateTime?
  totalDurationSec      Int?
  userAvgLatencyMs      Int?
  llmAvgLatencyMs       Int?
  feedback              String?       @db.Text
  messages              ChatMessage[]
  scores                ScoreResult[]
  llmLogs               LlmLog[]
  createdAt             DateTime      @default(now())
  updatedAt             DateTime      @updatedAt
  // partitioned by month on createdAt
  @@index([userId])
  @@index([personaId])
  @@index([createdAt])
  @@map("sessions")
}

// Per-message history — partitioned by month
model ChatMessage {
  id                Int      @id @default(autoincrement())
  sessionId         Int
  session           Session  @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  role              String   // "user" | "assistant"
  content           String   @db.Text
  emotion           String?
  emojiCode         String?
  userLatencyMs     Int?
  llmLatencyMs      Int?
  sentAt            DateTime @default(now())
  @@index([sessionId])
  @@index([sentAt])
  @@map("chat_messages")
}

// LLM scores per criterion per session
model ScoreResult {
  id          Int            @id @default(autoincrement())
  sessionId   Int
  session     Session        @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  criterionId Int
  criterion   ScoreCriterion @relation(fields: [criterionId], references: [id])
  score       Float
  rationale   String?        @db.Text
  personaVersionId Int?
  createdAt   DateTime       @default(now())
  @@map("score_results")
}

// ─────────────────────────────────────────────
// LLM OPS
// ─────────────────────────────────────────────

model LlmProvider {
  id             Int          @id @default(autoincrement())
  name           String       @unique
  type           ProviderType
  baseUrl        String?                        // null = LiteLLM default for the type
  credentialRef  String                         // secret-manager key name, NEVER the key
  isEnabled      Boolean      @default(true)
  priority       Int          @default(100)     // lower = higher priority
  monthlyBudgetUsd Decimal?   @db.Decimal(12,4)
  models         LlmModel[]
  createdBy      Int?
  createdAt      DateTime     @default(now())
  modifiedBy     Int?
  updatedAt      DateTime     @updatedAt
  @@map("llm_providers")
}

model LlmModel {
  id                   Int               @id @default(autoincrement())
  name                 String            // model slug, e.g. "gpt-4o", "gemini-2.5-flash"
  displayName          String?
  providerId           Int
  provider             LlmProvider       @relation(fields: [providerId], references: [id])
  capabilities         ModelCapability[]
  contextWindowTokens  Int?
  inputPricePerMillion  Decimal          @db.Decimal(12,6)
  outputPricePerMillion Decimal          @db.Decimal(12,6)
  isDefault            Boolean           @default(false)
  isEnabled            Boolean           @default(true)
  personasConversation Persona[]         @relation("ConversationModel")
  personasScoring      Persona[]         @relation("ScoringModel")
  llmLogs              LlmLog[]
  createdBy            Int?
  createdAt            DateTime          @default(now())
  modifiedBy           Int?
  updatedAt            DateTime          @updatedAt
  @@unique([name, providerId])
  @@map("llm_models")
}

// Per-call LLM usage log — partitioned by month
model LlmLog {
  id                Int       @id @default(autoincrement())
  sessionId         Int?
  session           Session?  @relation(fields: [sessionId], references: [id])
  modelId           Int?
  model             LlmModel? @relation(fields: [modelId], references: [id])
  mode              String    // "chat" | "voice" | "scoring" | "feedback" | "enhance"
  promptTokens      Int
  completionTokens  Int
  reasoningTokens   Int       @default(0)
  totalTokens       Int
  estimatedCostUsd  Decimal   @db.Decimal(12,6)
  durationMs        Int?
  userId            Int?
  personaId         Int?
  createdAt         DateTime  @default(now())
  @@index([sessionId])
  @@index([userId])
  @@index([createdAt])
  @@map("llm_logs")
}

// ─────────────────────────────────────────────
// CONTENT LIBRARY
// ─────────────────────────────────────────────

model ContentItem {
  id            Int         @id @default(autoincrement())
  type          ContentType
  title         String
  description   String?     @db.Text
  storageKey    String      // object-storage path
  mimeType      String
  thumbnailKey  String?     // for videos
  groupId       Int?
  group         Group?      @relation(fields: [groupId], references: [id])
  isDeleted     Boolean     @default(false)
  deletedAt     DateTime?
  deletedBy     Int?
  restoredAt    DateTime?
  restoredBy    Int?
  reactions     Reaction[]
  createdBy     Int?
  createdAt     DateTime    @default(now())
  modifiedBy    Int?
  updatedAt     DateTime    @updatedAt
  @@map("content_items")
}

model Reaction {
  id        Int         @id @default(autoincrement())
  userId    Int
  itemId    Int
  item      ContentItem @relation(fields: [itemId], references: [id], onDelete: Cascade)
  liked     Boolean
  createdAt DateTime    @default(now())
  updatedAt DateTime    @updatedAt
  @@unique([userId, itemId])
  @@map("reactions")
}

model ActionButton {
  id           Int      @id @default(autoincrement())
  name         String   @unique
  tooltipText  String?
  iconKey      String?
  order        Int      @default(0)
  isActive     Boolean  @default(true)
  createdBy    Int?
  createdAt    DateTime @default(now())
  modifiedBy   Int?
  updatedAt    DateTime @updatedAt
  @@map("action_buttons")
}

// ─────────────────────────────────────────────
// NOTIFICATIONS / MARQUEE
// ─────────────────────────────────────────────

model Announcement {
  id        Int      @id @default(autoincrement())
  text      String   @db.Text
  groupId   Int?
  group     Group?   @relation(fields: [groupId], references: [id])
  isActive  Boolean  @default(true)
  createdBy Int?
  createdAt DateTime @default(now())
  modifiedBy Int?
  updatedAt DateTime @updatedAt
  @@map("announcements")
}

// ─────────────────────────────────────────────
// ANALYTICS ROLLUPS (worker-materialized)
// ─────────────────────────────────────────────

model AnalyticsSessionRollup {
  id              Int      @id @default(autoincrement())
  periodDate      DateTime @db.Date      // day of the roll-up
  groupId         Int?
  cohortId        Int?
  personaId       Int?
  personaVersion  Int?
  totalSessions   Int      @default(0)
  completedSessions Int    @default(0)
  totalDurationSec  BigInt @default(0)
  avgDurationSec    Float?
  avgScore          Float?
  updatedAt       DateTime @updatedAt
  @@unique([periodDate, groupId, cohortId, personaId, personaVersion])
  @@map("analytics_session_rollups")
}

model AnalyticsUserRollup {
  id                    Int      @id @default(autoincrement())
  userId                Int
  periodDate            DateTime @db.Date
  totalSessions         Int      @default(0)
  completedSessions     Int      @default(0)
  totalActiveSec        BigInt   @default(0)
  totalInactiveSec      BigInt   @default(0)
  updatedAt             DateTime @updatedAt
  @@unique([userId, periodDate])
  @@map("analytics_user_rollups")
}

// ─────────────────────────────────────────────
// TELEMETRY & AUDIT
// ─────────────────────────────────────────────

// Raw per-login activity (partitioned by month)
model UserTelemetry {
  id                 Int       @id @default(autoincrement())
  userId             Int
  user               User      @relation(fields: [userId], references: [id])
  loginAt            DateTime
  logoutAt           DateTime?
  isActive           Boolean   @default(true)
  totalActiveSec     Int       @default(0)
  totalInactiveSec   Int       @default(0)
  lastActivityAt     DateTime?
  createdAt          DateTime  @default(now())
  updatedAt          DateTime  @updatedAt
  @@index([userId])
  @@index([loginAt])
  @@map("user_telemetry")
}

// Daily aggregated stats per user
model UserTelemetryDaily {
  id                  Int      @id @default(autoincrement())
  userId              Int
  user                User     @relation(fields: [userId], references: [id])
  statDate            DateTime @db.Date
  totalSessions       Int      @default(0)
  totalActiveSec      BigInt   @default(0)
  totalInactiveSec    BigInt   @default(0)
  avgActiveSec        Float?
  updatedAt           DateTime @updatedAt
  @@unique([userId, statDate])
  @@map("user_telemetry_daily")
}

// Append-only audit log — partitioned by month
model AuditLog {
  id          Int            @id @default(autoincrement())
  tableName   String
  operation   AuditOperation
  recordId    String
  oldData     Json?
  newData     Json?
  actorId     Int?
  createdAt   DateTime       @default(now())
  @@index([tableName, recordId])
  @@index([actorId])
  @@index([createdAt])
  @@map("audit_logs")
}

// ─────────────────────────────────────────────
// SYSTEM / OPERATIONS
// ─────────────────────────────────────────────

// Tracks bulk import jobs
model ImportReport {
  id               Int          @id @default(autoincrement())
  groupId          Int?
  group            Group?       @relation(fields: [groupId], references: [id])
  status           ImportStatus @default(PENDING)
  totalRows        Int          @default(0)
  importedRows     Int          @default(0)
  failedRows       Int          @default(0)
  sourceFileKey    String?      // storage key of uploaded file
  errorFileKey     String?      // storage key of failed-rows report
  elapsedMs        Int?
  uploadedBy       Int?
  createdAt        DateTime     @default(now())
  updatedAt        DateTime     @updatedAt
  @@map("import_reports")
}

// External corporate API config (login verification, user lookup, etc.)
model ExternalApi {
  id          Int      @id @default(autoincrement())
  name        String   @unique   // e.g. "LOGIN", "USER_LOOKUP"
  method      String   // GET | POST
  url         String
  headers     Json?
  bodyTemplate Json?
  isEnabled   Boolean  @default(true)
  createdBy   Int?
  createdAt   DateTime @default(now())
  modifiedBy  Int?
  updatedAt   DateTime @updatedAt
  @@map("external_apis")
}

// ─────────────────────────────────────────────
// GAMIFICATION
// ─────────────────────────────────────────────

enum BadgeCategory {
  MILESTONE     // session/time volume thresholds
  PERFORMANCE   // score-based
  STREAK        // consecutive-days consistency
  IMPROVEMENT   // month-over-month growth (re-earnable)
  RANKING       // cohort rank (re-earnable weekly/monthly)
}

enum BadgeTier {
  BRONZE
  SILVER
  GOLD
  PLATINUM
}

enum PeriodType {
  WEEKLY
  MONTHLY
  ALL_TIME
}

// Badge catalog — editable by Super Admin
model BadgeDefinition {
  id          Int           @id @default(autoincrement())
  key         String        @unique   // e.g. "streak_7", "rank_top10pct"
  name        String
  description String        @db.Text
  iconKey     String        // storage key or static asset slug
  category    BadgeCategory
  tier        BadgeTier
  // evaluation rules — evaluated by the badge-award worker
  // shape varies by category; see badge-award job §11
  criteria    Json
  isReearnable Boolean      @default(false)  // if true, can be awarded each period
  isActive    Boolean       @default(true)
  awards      UserBadge[]
  createdBy   Int?
  createdAt   DateTime      @default(now())
  modifiedBy  Int?
  updatedAt   DateTime      @updatedAt
  @@map("badge_definitions")
}

// Each badge instance earned by a user
model UserBadge {
  id         Int             @id @default(autoincrement())
  userId     Int
  user       User            @relation(fields: [userId], references: [id], onDelete: Cascade)
  badgeId    Int
  badge      BadgeDefinition @relation(fields: [badgeId], references: [id])
  periodKey  String?         // "2026-W24" or "2026-06" for re-earnable badges
  sessionId  Int?            // session that triggered the award (if applicable)
  context    Json?           // e.g. {score: 97, streakDays: 30}
  earnedAt   DateTime        @default(now())
  seenByUser Boolean         @default(false)   // drives unread notification dot
  @@unique([userId, badgeId, periodKey])
  @@index([userId])
  @@map("user_badges")
}

// Live streak tracker — one row per user, updated on session complete
model UserStreak {
  userId          Int      @id
  user            User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  currentStreak   Int      @default(0)
  longestStreak   Int      @default(0)
  lastActivityDate DateTime? @db.Date
  updatedAt       DateTime @updatedAt
  @@map("user_streaks")
}

// Composite performance scores — computed by worker, read by leaderboard endpoints
// Partitioned by periodType + periodKey (no Prisma partitioning; use $queryRaw migrations)
model UserPerformanceScore {
  id               Int        @id @default(autoincrement())
  userId           Int
  user             User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  cohortId         Int?
  groupId          Int?
  periodType       PeriodType
  periodKey        String     // "2026-W24" | "2026-06" | "alltime"
  // raw inputs
  totalSessions    Int        @default(0)
  completedSessions Int       @default(0)
  avgScore         Float?
  completionRate   Float?
  streakDays       Int        @default(0)
  totalPracticeMin Int        @default(0)
  avgResponseLatencyMs Int?
  improvementPct   Float?     // vs same period prior month
  // composite
  performanceScore Float      @default(0)  // 0–100
  // ranking (updated in the same rollup job after all scores computed)
  rankInCohort     Int?
  rankInGroup      Int?
  percentileInCohort Float?
  updatedAt        DateTime   @updatedAt
  @@unique([userId, cohortId, groupId, periodType, periodKey])
  @@index([cohortId, periodType, periodKey, performanceScore])
  @@index([groupId,  periodType, periodKey, performanceScore])
  @@map("user_performance_scores")
}
```

**Partition strategy** (raw SQL in Alembic-equivalent migration files):
```sql
-- partition by month on createdAt:
-- sessions, chat_messages, llm_logs, user_telemetry, audit_logs
-- Example (run once, then monthly cron adds new partition):
CREATE TABLE chat_messages_2026_06 PARTITION OF chat_messages
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
```

**Seed data** (`prisma db seed`):

| Table | Seed rows |
|---|---|
| `role_defs` | SUPER_ADMIN, TRAINER, USER |
| `badge_definitions` | all 17 badges defined in PRODUCT_PLAN §3.4 |
| `assistant_voices` | Male (en-US), Female (en-US) |
| `voice_styles` | Friendly, Professional, Assertive, Coaching |
| `llm_providers` | placeholder rows (creds via secret ref) |
| `llm_models` | common defaults per provider |
| `action_buttons` | Bulletin, Schedule, Curriculum, Locate, Travel, Help |
| `external_apis` | LOGIN, USER_LOOKUP rows (urls from env) |
| `default_credentials` | local-dev accounts (argon2-hashed, loaded from env) |

---

## 8. Complete API Endpoints

All routes prefixed `/api/v1`. Auth: `JWT` (global default-deny). `PUBLIC` = no auth. `ADMIN` = requires Super Admin or Admin role.

### Auth (`/api/v1/auth`)

| Method | Path | Auth | Body / Params | Response | Notes |
|---|---|---|---|---|---|
| POST | `/auth/login` | PUBLIC | `{employeeId, password}` | `{accessToken, user}` + refresh cookie | rate-limited 5/min/IP |
| POST | `/auth/refresh` | PUBLIC (cookie) | — | `{accessToken}` + rotated refresh cookie | reuse detection → revoke family |
| POST | `/auth/logout` | JWT | — | 204 | revokes current refresh token |
| POST | `/auth/realtime/ticket` | JWT | — | `{ticket, expiresAt}` | one-time WS ticket, 30 s TTL |

### Users (`/api/v1/users`)

| Method | Path | Auth | Permissions | Notes |
|---|---|---|---|---|
| GET | `/users` | JWT | `users:read` | paginated; search `?q=`; filter `?role=&isActive=&groupId=&cohortId=` |
| GET | `/users/:id` | JWT | `users:read` | full profile with groups, cohorts, supervised-by |
| POST | `/users` | JWT | `users:write` | create; 409 on duplicate employeeId |
| PATCH | `/users/:id` | JWT | `users:write` | partial update |
| DELETE | `/users/:id` | JWT | `users:delete` | soft-delete |
| POST | `/users/import` | JWT | `users:write` | multipart XLSX/CSV → enqueue → `ImportReport.id` returned |
| GET | `/users/import/:reportId` | JWT | `users:write` | import job status + error file URL |
| GET | `/users/import/:reportId/errors` | JWT | `users:write` | download error XLSX |
| POST | `/users/:id/avatar` | JWT | own or `users:write` | upload avatar → storage → update avatarUrl |

### Roles (`/api/v1/roles`)

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/roles` | JWT | list all roles (for dropdowns) |

### Groups (`/api/v1/groups`)

| Method | Path | Auth | Permissions | Notes |
|---|---|---|---|---|
| GET | `/groups` | JWT | `groups:read` | paginated, searchable |
| GET | `/groups/:id` | JWT | `groups:read` | with member count |
| POST | `/groups` | JWT | `groups:write` | |
| PATCH | `/groups/:id` | JWT | `groups:write` | |
| DELETE | `/groups/:id` | JWT | `groups:delete` | soft-delete |
| GET | `/groups/:id/members` | JWT | `groups:read` | paginated user list |
| POST | `/groups/:id/members` | JWT | `groups:write` | `{userIds: int[]}` bulk assign |
| DELETE | `/groups/:id/members/:userId` | JWT | `groups:write` | remove member |

### Domains & Cohorts (`/api/v1/domains`, `/api/v1/cohorts`)

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET/POST | `/domains` | JWT | list + create |
| GET/PATCH/DELETE | `/domains/:id` | JWT | |
| GET/POST | `/cohorts` | JWT | list + create |
| GET/PATCH/DELETE | `/cohorts/:id` | JWT | |
| POST | `/cohorts/:id/members` | JWT | `{userIds: int[]}` bulk enroll |
| DELETE | `/cohorts/:id/members/:userId` | JWT | |

### Personas (`/api/v1/personas`)

| Method | Path | Auth | Permissions | Notes |
|---|---|---|---|---|
| GET | `/personas` | JWT | `personas:read` | paginated; filter `?groupId=` |
| GET | `/personas/:id` | JWT | `personas:read` | with score criteria, voice style, current model config |
| POST | `/personas` | JWT | `personas:write` | |
| PATCH | `/personas/:id` | JWT | `personas:write` | auto-snapshots a version row |
| DELETE | `/personas/:id` | JWT | `personas:delete` | soft-delete |
| GET | `/personas/:id/versions` | JWT | `personas:read` | version history list |
| GET | `/personas/:id/versions/:version` | JWT | `personas:read` | version snapshot detail |
| POST | `/personas/:id/enhance` | JWT | `personas:write` | streams LLM-enhanced instructions (SSE) |
| GET | `/personas/my` | JWT | own | personas accessible to the logged-in user's groups |

### Sessions (`/api/v1/sessions`)

| Method | Path | Auth | Permissions | Notes |
|---|---|---|---|---|
| POST | `/sessions` | JWT | `sessions:write` | starts session → returns `{sessionId, uid, startedAt}` |
| GET | `/sessions` | JWT | `sessions:read` | paginated; filter `?personaId=&userId=&groupId=&cohortId=&status=&from=&to=`; admins see all, users see own |
| GET | `/sessions/:uid` | JWT | `sessions:read` | detail with scores + feedback |
| GET | `/sessions/:uid/messages` | JWT | `sessions:read` | paginated chat history |
| POST | `/sessions/:uid/end` | JWT | own | marks COMPLETED; triggers scoring + feedback LLM job |
| GET | `/sessions/export` | JWT | `sessions:read` ADMIN | XLSX export (enqueue → BullMQ) |

### LLM Ops (`/api/v1/llm`)

| Method | Path | Auth | Permissions | Notes |
|---|---|---|---|---|
| GET | `/llm/providers` | JWT | `llmops:read` | list |
| POST | `/llm/providers` | JWT | `llmops:write` ADMIN | create |
| PATCH | `/llm/providers/:id` | JWT | `llmops:write` ADMIN | |
| DELETE | `/llm/providers/:id` | JWT | `llmops:write` ADMIN | disable (never hard-delete) |
| GET | `/llm/models` | JWT | `llmops:read` | list; filter `?providerId=&capability=` |
| POST | `/llm/models` | JWT | `llmops:write` ADMIN | |
| PATCH | `/llm/models/:id` | JWT | `llmops:write` ADMIN | |
| POST | `/llm/models/:id/promote` | JWT | `llmops:write` ADMIN | set as default; requires regression suite pass |
| GET | `/llm/usage` | JWT | `llmops:read` | aggregated token/cost dashboard; filter `?from=&to=&modelId=&interval=` |
| GET | `/llm/usage/export` | JWT | `llmops:read` ADMIN | XLSX export |

### Content (`/api/v1/content`)

| Method | Path | Auth | Permissions | Notes |
|---|---|---|---|---|
| GET | `/content` | JWT | `content:read` | paginated; filter `?type=&groupId=&isDeleted=`; non-admin scoped to own groups |
| GET | `/content/:id` | JWT | `content:read` | with reaction counts + own reaction |
| POST | `/content` | JWT | `content:write` | multipart: file (video or doc) + metadata; validation: type/MIME/size |
| PATCH | `/content/:id` | JWT | `content:write` | metadata update |
| DELETE | `/content/:id` | JWT | `content:write` | soft-delete |
| POST | `/content/:id/restore` | JWT | `content:write` | restore soft-deleted |
| POST | `/content/:id/react` | JWT | own | `{liked: boolean}` upsert |
| GET | `/content/archive` | JWT | `content:write` | soft-deleted items |

### Action Buttons (`/api/v1/action-buttons`)
CRUD + reorder; `content:write` permission; GET is public within JWT.

### Analytics (`/api/v1/analytics`)

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/analytics/overview` | JWT `analytics:read` | cohort/group/period summary from rollup tables |
| GET | `/analytics/sessions` | JWT `analytics:read` | session completion + duration breakdown |
| GET | `/analytics/scores` | JWT `analytics:read` | per-criterion score trends |
| GET | `/analytics/users/:userId` | JWT own or `analytics:read` | individual user activity |
| GET | `/analytics/export` | JWT ADMIN | XLSX export (enqueue) |

All accept `?groupId=&cohortId=&personaId=&version=&from=&to=`.

### Announcements / Marquee (`/api/v1/announcements`)
CRUD; scoped to group; authenticated.

### Leaderboard (`/api/v1/leaderboard`)

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/leaderboard/cohort/:cohortId` | JWT | returns ranked list; `?period=weekly\|monthly\|alltime`; own row pinned at bottom if not in top 50 |
| GET | `/leaderboard/group/:groupId` | JWT | same shape, group scope |
| GET | `/leaderboard/global` | JWT `analytics:read` | Super Admin / Trainer only |
| GET | `/leaderboard/me` | JWT | own scores across all periods; performance score breakdown with component weights |

Response shape per row: `{rank, userId, name, avatarUrl, performanceScore, avgScore, completedSessions, currentStreak, totalPracticeMin, topBadges[3], deltaVsPrevPeriod}`.

### Badges (`/api/v1/badges`)

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/badges` | JWT | full catalog with earned/unearned state for current user |
| GET | `/badges/me` | JWT | only earned badges for current user; sorted by earnedAt desc |
| GET | `/badges/me/unseen` | JWT | unread badge notifications; PATCH marks seen |
| PATCH | `/badges/me/seen` | JWT | mark all unseen badges as seen |
| GET | `/badges/users/:userId` | JWT own or `analytics:read` | another user's earned badges |
| GET | `/badges/definitions` | JWT `llmops:write` (Super Admin) | admin catalog view |
| POST | `/badges/definitions` | JWT `llmops:write` | create custom badge |
| PATCH | `/badges/definitions/:id` | JWT `llmops:write` | edit badge |

### Health (no auth)

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | liveness — always 200 |
| GET | `/ready` | readiness — checks DB, Redis, LiteLLM gateway |

### WebSocket Gateways

| Path | Auth | Protocol |
|---|---|---|
| `WS /api/v1/realtime/chat` | one-time ticket (`?ticket=`) | see §9 |
| `WS /api/v1/realtime/voice` | one-time ticket + `?provider=gemini\|azure\|openai` | see §9 |

---

## 9. WebSocket Message Protocol

Typed in `packages/contracts/realtime.ts`.

### Chat Gateway (`/realtime/chat?ticket=&sessionId=`)

**Client → Server (JSON):**
```jsonc
// send a message
{ "type": "message", "content": "Hello", "id": "<client-generated-uuid>" }

// signal end of session
{ "type": "control", "action": "end" }

// heartbeat
{ "type": "ping" }
```

**Server → Client (JSON):**
```jsonc
// streaming token
{ "type": "token", "delta": "..." }

// turn complete
{ "type": "message_done", "messageId": "<id>", "emotion": "friendly", "emoji": "😊" }

// session ending — triggers scoring
{ "type": "session_ending" }

// scoring/feedback complete
{ "type": "session_ended", "scores": [...], "feedback": "..." }

// error
{ "type": "error", "code": "PROVIDER_ERROR", "message": "..." }

// reconnect advisory (drain)
{ "type": "reconnect", "reason": "server_drain" }

// heartbeat ack
{ "type": "pong" }
```

**Reconnect:** client reconnects to same URL with same `sessionId`; sends `{ "type": "resume", "lastMessageId": "<id>" }`. Server replays any missed `message_done` events and continues.

### Voice Gateway (`/realtime/voice?ticket=&sessionId=&provider=`)

**Client → Server:**
- Binary frames: raw PCM16, 16 kHz, mono, 20 ms chunks
- JSON control frames (text):
  ```jsonc
  { "type": "control", "action": "interrupt" }
  { "type": "control", "action": "end" }
  { "type": "ping" }
  ```

**Server → Client:**
- Binary frames: PCM16 audio from the assistant
- JSON frames:
  ```jsonc
  { "type": "speech_start" }
  { "type": "speech_end" }
  { "type": "transcript", "role": "user"|"assistant", "text": "..." }
  { "type": "emotion", "value": "assertive" }
  { "type": "session_ended", "scores": [...], "feedback": "..." }
  { "type": "error", "code": "...", "message": "..." }
  { "type": "reconnect", "reason": "..." }
  { "type": "pong" }
  ```

---

## 10. Environment Variables

Validated by Zod at startup — missing required var = hard crash with clear message.

```env
# ── App ──────────────────────────────────────
NODE_ENV=development|staging|production
APP_ROLE=api|realtime|worker            # controls which modules load
PORT=3000
CORS_ORIGINS=https://app.example.com,https://admin.example.com

# ── Database ─────────────────────────────────
DATABASE_URL=postgresql://user:pass@pgbouncer:5432/alfa?pgbouncer=true&connection_limit=5
DATABASE_POOL_SIZE=5

# ── Redis ─────────────────────────────────────
REDIS_URL=redis://redis:6379

# ── Auth ──────────────────────────────────────
JWT_ACCESS_SECRET=                      # min 64 chars
JWT_ACCESS_TTL_SECONDS=900              # 15 min
JWT_REFRESH_SECRET=                     # min 64 chars, different from access
JWT_REFRESH_TTL_SECONDS=604800          # 7 days
WS_TICKET_TTL_SECONDS=30

# ── LiteLLM gateway ───────────────────────────
LITELLM_BASE_URL=http://litellm:4000
LITELLM_API_KEY=                        # master key for the gateway

# ── Object storage ────────────────────────────
STORAGE_PROVIDER=s3|azure               # selects the adapter
# S3 / MinIO / GCS-interop
S3_ENDPOINT=                            # blank = AWS default
S3_BUCKET=alfa-content
S3_REGION=
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
# Azure Blob
AZURE_BLOB_CONNECTION_STRING=
AZURE_BLOB_CONTAINER=alfa-content

# ── External corporate auth (optional) ────────
CREDENTIAL_VERIFIER=local|external      # selects the strategy
EXTERNAL_AUTH_URL=
EXTERNAL_AUTH_METHOD=POST
EXTERNAL_AUTH_HEADER_KEY=               # API key header name
EXTERNAL_AUTH_HEADER_VALUE=             # resolved from secret manager in prod

# ── Rate limiting ──────────────────────────────
THROTTLE_TTL_MS=60000
THROTTLE_LIMIT=100                      # global
THROTTLE_LOGIN_LIMIT=5                  # /auth/login strict bucket

# ── Uploads ───────────────────────────────────
UPLOAD_MAX_VIDEO_MB=500
UPLOAD_MAX_DOC_MB=50
UPLOAD_ALLOWED_VIDEO_MIME=video/mp4,video/webm,video/quicktime
UPLOAD_ALLOWED_DOC_MIME=application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document

# ── BullMQ / worker ───────────────────────────
WORKER_CONCURRENCY=5

# ── Observability ─────────────────────────────
LOG_LEVEL=info
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
SENTRY_DSN=                             # optional
```

---

## 11. Background Jobs (BullMQ)

| Queue | Job | Trigger | Notes |
|---|---|---|---|
| `import` | `process-user-import` | POST /users/import | streaming exceljs parse, upsert via batches of 100, write ImportReport progress |
| `export` | `export-sessions` | GET /sessions/export | `$queryRaw` cursor, stream rows → exceljs → upload to storage → pre-signed URL |
| `export` | `export-analytics` | GET /analytics/export | same pattern |
| `export` | `export-llm-usage` | GET /llm/usage/export | |
| `scoring` | `score-session` | session end | LLM call per criterion (batched), write ScoreResult rows; update session.status |
| `rollup` | `rollup-sessions-daily` | cron 02:00 UTC | insert/upsert AnalyticsSessionRollup for yesterday |
| `rollup` | `rollup-users-daily` | cron 02:15 UTC | insert/upsert UserTelemetryDaily for yesterday |
| `rollup` | `rollup-llm-daily` | cron 02:30 UTC | LLM cost aggregates |
| `telemetry` | `flush-telemetry` | cron every 30 s | drain in-memory accumulator → batch-upsert UserTelemetry |
| `retention` | `purge-old-messages` | cron monthly | drop old chat_messages / llm_logs / audit_logs partitions older than retention window |
| `registry` | `sync-llm-registry` | on provider/model change | push updated config to LiteLLM gateway admin API |
| `cleanup` | `expire-realtime-tickets` | cron every 5 min | delete expired RealtimeTicket rows |
| `gamification` | `compute-performance-scores` | on session end + cron 03:00 UTC | recalculate `UserPerformanceScore` for the user in all periods; update cohort/group ranks + percentiles |
| `gamification` | `award-badges` | immediately after `compute-performance-scores` | evaluate each active `BadgeDefinition.criteria` against user's latest stats; insert `UserBadge` rows for newly earned badges; skip if already earned (and not re-earnable in this period) |
| `gamification` | `update-streaks` | on session end | increment `UserStreak.currentStreak` if last activity was yesterday; reset to 1 if gap > 1 day; update `longestStreak` |
| `gamification` | `weekly-ranking-badges` | cron Monday 04:00 UTC | compute cohort percentiles for the closed week; award RANKING badges (top-10%, podium, champion) |
| `gamification` | `monthly-improvement-badges` | cron 1st of month 04:30 UTC | compute improvement delta vs prior month; award IMPROVEMENT badges |

---

## 12. RBAC Permission Map

Three roles. Permissions checked by `@Permissions()` guard; object-level checks (own-group, own) enforced in services.

| Permission | SUPER_ADMIN | TRAINER | USER |
|---|---|---|---|
| `users:read` | ✓ (all) | ✓ (own-group) | — |
| `users:write` | ✓ | — | — |
| `users:delete` | ✓ | — | — |
| `groups:read` | ✓ | ✓ (own) | — |
| `groups:write` | ✓ | — | — |
| `groups:delete` | ✓ | — | — |
| `cohorts:read` | ✓ | ✓ (own-group) | ✓ (own) |
| `cohorts:write` | ✓ | — | — |
| `personas:read` | ✓ | ✓ | ✓ (own-groups) |
| `personas:write` | ✓ | ✓ | — |
| `personas:delete` | ✓ | — | — |
| `sessions:read` | ✓ (all) | ✓ (own-group) | ✓ (own) |
| `sessions:write` | ✓ | ✓ | ✓ |
| `content:read` | ✓ | ✓ | ✓ (own-groups) |
| `content:write` | ✓ | ✓ | — |
| `analytics:read` | ✓ (global) | ✓ (own-group) | ✓ (own) |
| `leaderboard:read` | ✓ (global) | ✓ (own-group) | ✓ (own-cohort) |
| `badges:read` | ✓ (any user) | ✓ (own-group) | ✓ (own) |
| `badges:write` | ✓ | — | — |
| `llmops:read` | ✓ | — | — |
| `llmops:write` | ✓ | — | — |

---

## 13. Key Decisions & Trade-offs

| Decision | Choice | Why |
|---|---|---|
| Framework | NestJS 11 + Fastify | DI/guards/interceptors map cleanly to the cross-cutting needs; Fastify for throughput |
| Rebuild vs evolve | Rebuild in TS; legacy stays as reference until cutover | gateway removes the Python-only LLM dependency; clean schema + typed contracts pay for the rewrite |
| ORM | Prisma | migrations, type safety, client extensions (soft-delete/audit); `$queryRaw` for heavy analytics SQL |
| Validation | Zod in `packages/contracts` | one schema source for API, env, WS protocol — and the future frontend |
| LLM access | OpenAI SDK → LiteLLM gateway + DB registry | OpenAI, Gemini, Azure OpenAI, OpenRouter as runtime config; no per-provider SDK code |
| Agent framework | **None** | roleplay = system prompt + history + streaming; scoring = single structured call; a graph framework adds nothing here |
| WS transport | raw `ws` via Nest gateways | binary audio frames, minimal overhead; Redis pub/sub for cross-pod control |
| Jobs | BullMQ | Redis-only, first-class Nest integration |
| Process model | one codebase, three run targets (api/realtime/worker) | independent scaling without microservice overhead |
| Schema | clean redesign + ETL migration | legacy JSON-array relations and constraint gaps are not worth porting |
| Legacy quirks (errors-as-200, POST updates, payload encryption) | not ported; `/api/v1` is REST-correct | parallel-run cutover means the old API keeps serving the old consumer until switch |
| Frontend | React SPA in `apps/web` ([FRONTEND_PLAN.md](./FRONTEND_PLAN.md)) | shares `packages/contracts`; builds in parallel from backend Phase 1 |
