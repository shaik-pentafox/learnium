# ALFA Learnium — Development Strategy

> This document is the **single source of truth** for how we build the NestJS backend.
> Read this at the start of every session. It tells you: what's done, what's next, and how we work.

---

## 0. Philosophy

**Core first, features on top.**
We don't build everything at once. We make the minimum thing work end-to-end, prove it, then stack features on top. Each feature lives in its own branch, gets manually tested via curl, and only merges to `develop` when it passes.

**Claude's job in every session:**
- Know which feature is in progress (check this doc + git log)
- Provide curl commands + expected responses for every endpoint built
- Fix failures immediately, commit the fix, re-test
- When feature passes → merge to `develop` → update this doc → ask to proceed

---

## 1. Branch Model

```
main          ← stable, never touch directly
develop       ← integration branch; merge completed features here
feature/<name> ← one branch per feature below
```

**Merge rule:** feature branch → `develop` only when all curl tests pass.
**Never merge** to `main` until Phase 0–3 features all pass end-to-end.

---

## 2. Tech Stack (confirmed)

| Layer | Choice |
|---|---|
| Framework | NestJS 11 + Fastify |
| Language | TypeScript 5.x strict |
| Package manager | **npm workspaces** |
| ORM | Prisma (Postgres operational data) |
| Analytics DB | **ClickHouse 24+** (`@clickhouse/client`) |
| Cache / queues | Redis 7 + BullMQ |
| LLM access | OpenAI SDK → LiteLLM gateway |
| Auth | JWT access (15 min) + rotating refresh tokens |
| WebSockets | NestJS raw `ws` gateways (no socket.io) |
| Object storage | `StorageService` interface (S3 / Azure Blob) |
| Logging | pino (`nestjs-pino`) |
| Testing | manual curl (primary); Jest + Testcontainers (integration gate) |

---

## 3. Feature Build Order

Priority: **core chat first**, everything else on top.

| # | Feature Branch | Status | Depends On |
|---|---|---|---|
| 1 | `feature/scaffold` | ⬜ TODO | — |
| 2 | `feature/auth` | ⬜ TODO | scaffold |
| 3 | `feature/users` | ⬜ TODO | auth |
| 4 | `feature/personas` | ⬜ TODO | users |
| 5 | `feature/sessions` | ⬜ TODO | personas |
| 6 | `feature/ws-chat` | ⬜ TODO | sessions ← **CORE** |
| 7 | `feature/scoring` | ⬜ TODO | ws-chat |
| 8 | `feature/llm-ops` | ⬜ TODO | scaffold |
| 9 | `feature/voice` | ⬜ TODO | ws-chat |
| 10 | `feature/files` | ⬜ TODO | auth |
| 11 | `feature/clickhouse-analytics` | ⬜ TODO | sessions + scoring |
| 12 | `feature/gamification` | ⬜ TODO | clickhouse-analytics |

**Statuses:** ⬜ TODO → 🔨 IN PROGRESS → ✅ MERGED

---

## 4. Feature Scope — What Each Branch Builds

### F1: `feature/scaffold`
- npm workspaces monorepo: `apps/api`, `packages/contracts`
- NestJS 11 + Fastify skeleton
- Zod config module (fails fast on missing env vars)
- `docker-compose.yml`: postgres, redis, clickhouse, minio, litellm, api, worker
- `GET /health` (liveness)
- `GET /ready` (checks Postgres + Redis + ClickHouse + LiteLLM)
- pino logging + request-id middleware
- Global response envelope + exception filter
- **No auth yet — `/health` and `/ready` are PUBLIC**

**Test endpoints:**
```
GET /health
GET /ready
```

---

### F2: `feature/auth`
- Prisma migrations: `users`, `role_defs`, `refresh_tokens`, `realtime_tickets`, `default_credentials`
- `POST /api/v1/auth/login` — JSON body `{username, password}`; returns access + refresh tokens
- `POST /api/v1/auth/refresh` — rotating refresh token → new pair
- `POST /api/v1/auth/logout` — revokes refresh token
- `POST /api/v1/auth/realtime/ticket` — one-time 30s WS ticket (JWT required)
- Global `JwtAuthGuard` (default-deny) + `@Public()` decorator
- Redis throttler: 5 req/min on login; global 100/min
- Local `CredentialVerifier` (argon2 hash vs `default_credentials` table)

**Test endpoints:**
```
POST /api/v1/auth/login
POST /api/v1/auth/refresh
POST /api/v1/auth/logout
POST /api/v1/auth/realtime/ticket
```

---

### F3: `feature/users`
- Prisma migrations: `import_reports`
- `GET /api/v1/users` — paginated, `?q=` search, `?role=`
- `GET /api/v1/users/:id`
- `POST /api/v1/users` — create
- `PATCH /api/v1/users/:id` — partial update
- `DELETE /api/v1/users/:id` — soft-delete
- `POST /api/v1/users/import` — multipart XLSX/CSV → BullMQ job → `import_reports`
- `GET /api/v1/users/import/:reportId` — job status + error file URL
- `POST /api/v1/users/:id/avatar` — upload → storage → update avatarUrl
- RBAC: `users:read` (Trainer), `users:write/delete` (Super Admin only)
- Audit columns via Prisma CLS extension

**Test endpoints:**
```
GET /api/v1/users
POST /api/v1/users
PATCH /api/v1/users/:id
DELETE /api/v1/users/:id
POST /api/v1/users/import
GET /api/v1/users/import/:reportId
```

---

### F4: `feature/personas`
- Prisma migrations: `assistant_voices`, `voice_styles`, `personas`, `persona_versions`, `score_criteria`
- `GET /api/v1/personas` — paginated
- `GET /api/v1/personas/:id` — with score criteria + model config
- `POST /api/v1/personas`
- `PATCH /api/v1/personas/:id` — auto-snapshot to `persona_versions`
- `DELETE /api/v1/personas/:id` — soft-delete
- `GET /api/v1/personas/:id/versions` — version history
- `GET /api/v1/personas/:id/versions/:v` — snapshot detail
- `POST /api/v1/personas/:id/enhance` — SSE streaming LLM prompt enhancement
- `GET /api/v1/personas/my` — personas accessible to current user
- `GET /api/v1/roles` — list roles

**Test endpoints:**
```
POST /api/v1/personas
GET /api/v1/personas
GET /api/v1/personas/:id
PATCH /api/v1/personas/:id   (verify version snapshot created)
POST /api/v1/personas/:id/enhance
```

---

### F5: `feature/sessions`
- Prisma migrations: `sessions`, `chat_messages`, `score_results`
- `POST /api/v1/sessions` — start session → `{sessionId, uid, startedAt}`
- `GET /api/v1/sessions` — paginated; admin sees all, users see own
- `GET /api/v1/sessions/:uid` — detail with scores + feedback
- `GET /api/v1/sessions/:uid/messages` — paginated chat history
- `GET /api/v1/sessions/export` — enqueue XLSX export BullMQ job

**Does NOT include session end scoring yet** — that's F7.

**Test endpoints:**
```
POST /api/v1/sessions
GET /api/v1/sessions
GET /api/v1/sessions/:uid
GET /api/v1/sessions/:uid/messages
```

---

### F6: `feature/ws-chat` ← CORE FEATURE

This is the primary deliverable. Everything before is setup for this.

- `POST /api/v1/auth/realtime/ticket` already done in F2; verified here
- `WS /api/v1/realtime/chat?ticket=<token>` — the chat gateway
- Redis session registry: `session:{uid}` → status, personaId, modelId, lastMessageId, pod, lastSeen (TTL 24h)
- LiteLLM `LlmClientService`: streaming roleplay turns via OpenAI SDK
- `RoleplaySession` state machine per WebSocket connection
- System prompt: built from persona `customInstructions`; **no hardcoded client names**
- [CONVERSATION_ENDED] sentinel: triggers session end on server side
- Token streaming: `{type:"token", delta:"..."}` per chunk
- Turn complete: `{type:"message_done", messageId:"...", emotion:"...", emoji:"..."}`
- Chat history: each turn written to `chat_messages` (Postgres) after `message_done`
- **Reconnect contract:**
  - Client connects with same `?ticket=` (re-issue ticket before reconnect)
  - Client sends `{type:"resume", lastMessageId:"<id>"}`
  - Server replays missed `message_done` events from `chat_messages`
  - Continues session
- Session hijack protection: session bound to userId on connect; mismatch → close 4003
- Graceful drain: SIGTERM → send `{type:"reconnect", reason:"server_drain"}` to all clients

**Test this feature manually:**
1. Get ticket → connect WS → send message → observe streaming tokens → observe message_done
2. Disconnect → get new ticket → reconnect with resume → verify replay + continuation
3. Test [CONVERSATION_ENDED] flow

---

### F7: `feature/scoring`
- `POST /api/v1/sessions/:uid/end` — mark COMPLETED; enqueue `score-session` BullMQ job
- `score-session` job: LLM call per criterion in `score_criteria` → upsert `score_results` rows
- After scoring: insert `session_events` row → ClickHouse (async, non-blocking)
- `GET /api/v1/sessions/:uid` — now returns `scores` + `feedback` populated
- `session_ending` + `session_ended` WS messages sent to client if still connected

**Test endpoints:**
```
POST /api/v1/sessions/:uid/end
GET /api/v1/sessions/:uid   (verify scores populated)
```

---

### F8: `feature/llm-ops`
- Prisma migrations: `llm_providers`, `llm_models`
- `GET/POST /api/v1/llm/providers` — registry CRUD (ADMIN)
- `PATCH/DELETE /api/v1/llm/providers/:id`
- `GET/POST /api/v1/llm/models`
- `PATCH /api/v1/llm/models/:id`
- `POST /api/v1/llm/models/:id/promote` — set as default; `sync-llm-registry` BullMQ job
- `GET /api/v1/llm/usage` — reads from ClickHouse `llm_events`
- `GET /api/v1/llm/usage/export` — ClickHouse → exceljs → storage → pre-signed URL

---

### F9: `feature/voice`
- `WS /api/v1/realtime/voice?ticket=<token>&provider=gemini|azure|openai`
- `VoiceProvider` interface: `connect / sendAudio / onAudio / interrupt / end`
- `GeminiLiveProvider` implementation
- `AzureVoiceLiveProvider` implementation
- Binary PCM16 frames + JSON control frames
- Session end → same scoring path as F7

---

### F10: `feature/files`
- `POST /api/v1/files/upload` — multipart; MIME + size validation; returns `{fileId, url}`
- `GET /api/v1/files/:fileId` — redirect to pre-signed download URL (60s TTL)
- `DELETE /api/v1/files/:fileId` — hard-delete from storage + DB record

---

### F11: `feature/clickhouse-analytics`
- ClickHouseService fully wired: `llm_events`, `session_events`, `telemetry_events`
- `flush-llm-events` + `flush-telemetry` BullMQ jobs (every 30s)
- `GET /api/v1/analytics/overview`
- `GET /api/v1/analytics/sessions`
- `GET /api/v1/analytics/scores`
- `GET /api/v1/analytics/users/:userId`
- `GET /api/v1/analytics/export`

---

### F12: `feature/gamification`
- Prisma migrations: `badge_definitions`, `user_badges`, `user_streaks`, `user_performance_scores`
- Seed 17 badges
- `compute-performance-scores` job (reads ClickHouse `session_events` → writes Postgres)
- `award-badges` job
- `update-streaks` job
- `weekly-ranking-badges` cron
- `GET /api/v1/leaderboard` + `GET /api/v1/leaderboard/me`
- Badge endpoints: catalog, earned, unseen/seen

---

## 5. Session Workflow (How We Work Together)

```
[Start of session]
  Claude reads this doc + git log → knows current state
  Claude states: "Feature X is in progress / next up is Feature Y"

[During feature build]
  Claude builds endpoints
  Claude provides curl commands + expected responses
  User runs curls → reports pass/fail
  If fail → Claude diagnoses, fixes, provides updated curls
  Claude does NOT commit until user confirms tests pass

[Feature complete — tests pass]
  Claude asks: "All tests pass. OK to commit?"
  User approves → Claude commits with simple message (see §5.1)
  Claude asks: "OK to merge feature/X → develop?"
  User approves → Claude merges
  Claude updates Feature Build Order table (status → ✅ MERGED)
  Claude asks: "Feature X done. Start Feature Y?"

[Next session, different machine]
  Claude reads this doc → picks up exactly where left off
```

### 5.1 Commit Rules

- **Simple messages only.** Format: `<type>: <what changed>` — e.g. `feat: add auth login endpoint`, `fix: token expiry off-by-one`
- **No Co-Authored-By tag.** Never append co-author lines to commits.
- **Never commit without user approval.** Claude asks permission before every `git commit`.
- **Never merge without user approval.** Claude asks permission before every merge.
- **One commit per logical change.** Don't batch unrelated fixes into one commit.

```bash
# Good commit messages
git commit -m "feat: scaffold NestJS monorepo with health endpoints"
git commit -m "fix: JWT expiry check uses < not <="
git commit -m "feat: add persona versioning on PATCH"

# Never
git commit -m "... Co-Authored-By: Claude ..."
```

---

## 6. Curl Testing Template

For every feature, Claude will provide curls in this format:

```bash
# ── Test: <endpoint name> ──────────────────────
# Purpose: <what this verifies>
# Setup: <any prerequisite (e.g. need JWT from login first)>

curl -X <METHOD> http://localhost:3000/api/v1/<path> \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN>" \
  -d '{
    "field": "value"
  }'

# Expected status: 200 / 201 / 204
# Expected response:
# {
#   "status": "success",
#   "data": { ... }
# }
#
# Known failure cases:
# - No token → 401 {"status":"error","code":"UNAUTHORIZED"}
# - Wrong role → 403
```

Claude will always provide curls for:
1. Happy path (expect success)
2. Missing auth (expect 401)
3. Wrong role where relevant (expect 403)
4. Validation failure (expect 400)

---

## 7. Environment Setup (local dev)

```bash
# 1. Clone + install
git clone <repo>
cd alfa-learnium
npm install

# 2. Copy env
cp apps/api/.env.example apps/api/.env
# Fill: DATABASE_URL, REDIS_URL, CLICKHOUSE_URL, LITELLM_BASE_URL, JWT secrets

# 3. Start infra
docker compose -f infra/docker/docker-compose.yml up -d

# 4. Run migrations + seed
cd apps/api
npx prisma migrate dev
npx prisma db seed

# 5. Start API
npm run dev --workspace=apps/api
# → http://localhost:3000
```

---

## 8. Current Session State

> **Update this section at the end of every session.**

```
Last updated: 2026-06-15
Current active branch: —
Last completed feature: — (starting from scratch)
Next feature to build: F1 — feature/scaffold
Blocked on: nothing
Notes: Project kicked off. E2E_BACKEND_PLAN.md is finalized.
       Stack confirmed: NestJS 11 + Fastify, npm workspaces, Prisma, ClickHouse, Redis, BullMQ, LiteLLM.
       No org groupings (no Groups/Cohorts/Domains).
       No content library (simple /files upload/download only).
       Leaderboard is global only.
```

---

## 9. Decisions Log

| Date | Decision | Reason |
|---|---|---|
| 2026-06-15 | Removed Groups / Cohorts / Domains | Not needed for initial scope |
| 2026-06-15 | Removed Content Library → simple /files API | Scope reduction |
| 2026-06-15 | Added ClickHouse for analytics | Postgres rollup tables not sufficient at scale |
| 2026-06-15 | npm workspaces instead of pnpm | Team preference |
| 2026-06-15 | Global-only leaderboard | No group/cohort scoping |
| 2026-06-15 | Build core chat (WS) first | Core product value is roleplay; everything else secondary |
