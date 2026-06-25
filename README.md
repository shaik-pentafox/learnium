# Traineon

> Working name — the product will be named later. Referred to as **Traineon** for now.

AI roleplay training platform: a NestJS backend with a planned React SPA frontend.

The repo is an **npm-workspaces monorepo** (workspace root = repo root):

| Path | What |
|---|---|
| `apps/api/` | NestJS backend — **active development** |
| `apps/web/` | React SPA frontend — planned (not created yet) |
| `packages/` | `contracts` (Zod schemas) + shared `tsconfig` bases |
| `infra/docker/` | Dockerfile + docker-compose |
| `docs/` | Product, backend, frontend, and dev-strategy plans |

> **Source of truth for the plan:** [`docs/DEV_STRATEGY.md`](docs/DEV_STRATEGY.md). It overrides the other plan docs where they disagree. See [Deviations](#deviations-from-dev_strategy) below for where the current code diverges from it.

---

## Implementation status

Backend follows the F1–F11 feature order in `DEV_STRATEGY.md §3`. Current state:

| # | Feature | Status | Notes |
|---|---|---|---|
| F1 | scaffold | ✅ | NestJS 11 + Fastify, npm workspaces + turbo, Zod config, pino, global envelope + exception filter, `/health` + `/ready` |
| F2 | auth | ✅ | JWT access + rotating refresh tokens, logout revocation, one-time WS tickets, local argon2 verifier, login throttling |
| F3 | users | ✅ | User CRUD, RBAC roles guard + permissions, supervisor mapping, bulk XLSX import (BullMQ) |
| F4 | personas | ✅ | CRUD, auto-versioning snapshots, score criteria, SSE prompt-enhance — ⚠️ visibility model deviates (see below) |
| F5 | sessions | ✅ | Session lifecycle, chat history, BullMQ scoring job |
| F6 | ws-chat | ✅ | `ws` chat gateway, ticket auth, **LangGraph.js** roleplay graph + **PostgresSaver** checkpointer, token streaming (`streamMode: messages`), reconnect/resume |
| F7 | scoring | ✅ | `ScoringService` via LangChain `withStructuredOutput` (+ JSON-parse fallback), end-session per-criterion scoring + feedback |
| F8 | llm-ops | ✅ | Provider/model registry, encrypted credentials, in-process LangChain model factory + Redis cache-invalidation — ⚠️ single-key (see below) |
| F9 | files | ⬜ | Not started (storage env vars present, no `StorageService`/endpoints) |
| F10 | clickhouse-analytics | ⬜ | Not started (client dep + healthcheck only; no events/flush jobs/endpoints) |
| F11 | dashboards | ⬜ | Not started |
| — | voice / gamification | ⏸ | Deferred per plan — not started (correct) |

**~8 of 11 core features implemented.** Modules live: `auth`, `identity`, `personas`, `sessions`, `realtime`, `llm-ops`.

---

## Deviations from DEV_STRATEGY

`DEV_STRATEGY.md` is the authoritative plan. The LLM-engine deviations are now **resolved** (see below); these remain:

1. **Persona visibility — simple `assignedUsers` M2M.** No `owner` + `publish`/`unpublish` workflow, no `/personas/my` (trainer-scoped), no `/test` draft endpoint. The plan requires the owner+publish hierarchy (trainee sees only their trainer's *published* personas).
2. **LLM credentials — single `credentialRef` on `LlmProvider`.** Not the F8 **BYOK `llm_credentials` vault** (many keys per provider, per-key rpm/tpm + health, write-only/masked API). The factory decrypts the one key per provider.
3. **ClickHouse stubbed.** Dependency, env config, and a `/ready` ping exist, but no `llm_events`/`session_events`/`telemetry_events` ingestion, flush jobs, or analytics endpoints.
4. **No Prisma enums.** `Role`, session `status`, provider `type`, model `capabilities` are plain strings (the plan modeled them as enums).
5. **Single-process run target.** `main.ts` ignores `APP_ROLE` — realtime + worker run in one process (plan wants separable api/realtime/worker).
6. **Minor naming.** `CREDENTIAL_ENCRYPTION_KEY` (plan: `MASTER_ENCRYPTION_KEY`); persona prompt stored in a `systemPrompt` field; session status `ACTIVE` (plan: `IN_PROGRESS`).

**Resolved (LLM layer realigned to the plan):** LiteLLM gateway removed entirely (code, deps, `docker-compose`, env); replaced by an in-process **LangChain.js** model factory (`@langchain/openai` for OpenAI-compatible providers, `@langchain/google-genai` for Gemini) built from the encrypted DB registry with `.withFallbacks()`; the chat path now uses a **LangGraph.js** `StateGraph` + **PostgresSaver** checkpointer (`thread_id = session.uid`) with token streaming; registry edits invalidate the model cache via Redis pub/sub.

Matches the plan: npm workspaces, Fastify, Prisma, Redis + BullMQ, JWT + refresh rotation + WS tickets, RBAC guard, response envelope + exception filter, pino, raw `ws` gateway with reconnect/resume, LangChain.js + LangGraph.js (PostgresSaver), contracts package, pgvector + ClickHouse + MinIO in compose.

---

## Backend stack (as built)

NestJS 11 + Fastify · TypeScript 5 strict · npm workspaces + turbo · Prisma + PostgreSQL 16 (pgvector image) · Redis 7 + BullMQ · **LangChain.js + LangGraph.js** (PostgresSaver checkpointer; no gateway) · raw `ws` gateways · ClickHouse client (wired into healthcheck only) · MinIO/S3 storage interface (env only) · argon2 · pino · Zod.

### Structure

```
.                              # repo root = npm workspace root (package.json, turbo.json)
├── apps/
│   └── api/
│       ├── prisma/            # schema + 5 migrations (auth, import, personas, sessions, llm-ops) + seed
│       └── src/
│           ├── core/          # config, database, redis, queue, auth, llm, envelope, errors, logger
│           ├── modules/       # auth, identity (users/roles/import), personas, sessions, realtime, llm-ops
│           └── health/
├── packages/
│   ├── contracts/             # Zod envelope, errors, pagination, realtime protocol
│   └── tsconfig/              # shared TS bases
├── infra/docker/              # Dockerfile, docker-compose (postgres, redis, clickhouse, minio, api)
└── docs/                      # plans + reference insights
```

---

## Quickstart

```bash
# from the repo root
npm install

cp apps/api/.env.example apps/api/.env
# fill: DATABASE_URL, REDIS_URL, CLICKHOUSE_URL,
#       JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, CREDENTIAL_ENCRYPTION_KEY

docker compose -f infra/docker/docker-compose.yml up -d   # postgres, redis, clickhouse, minio

cd apps/api
npx prisma migrate dev
npx prisma db seed

npm run dev          # http://localhost:3000  (routes under /api/v1)
```

Health: `GET /health` (liveness), `GET /ready` (Postgres + Redis + ClickHouse probes).

### Scripts (`apps/api`)

| Command | Action |
|---|---|
| `npm run dev` | Nest watch mode |
| `npm run build` | Nest build |
| `npm test` | Jest unit |
| `npm run test:integration` | Jest integration (`jest.integration.json`) |
| `npm run lint` / `npm run typecheck` | ESLint / `tsc --noEmit` |

From the repo root: `npm run build|test|lint|typecheck` fan out across workspaces via turbo (`npm run dev` runs `apps/api`).

---

## Docs

- [`docs/DEV_STRATEGY.md`](docs/DEV_STRATEGY.md) — **authoritative** stack, feature order, branch model, session state
- [`docs/PRODUCT_PLAN.md`](docs/PRODUCT_PLAN.md) — product scope, roles, target architecture
- [`docs/BACKEND_PLAN.md`](docs/BACKEND_PLAN.md) — schema + endpoint catalog
- [`docs/FRONTEND_PLAN.md`](docs/FRONTEND_PLAN.md) — React SPA plan
- [`docs/REFERENCE_INSIGHTS.md`](docs/REFERENCE_INSIGHTS.md) — distilled strategy notes (adopt/avoid) informing the build
- [`docs/E2E_BACKEND_PLAN.md`](docs/E2E_BACKEND_PLAN.md), [`docs/ENHANCEMENT_PLAN.md`](docs/ENHANCEMENT_PLAN.md)
