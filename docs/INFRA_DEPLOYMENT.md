# Infrastructure & Deployment

How Traineon is built, run locally, and deployed. Stack is fully Dockerised; the
backing services are containers and both apps ship as Docker images.

> Source-of-truth precedence still applies (see `CLAUDE.md` / `docs/DEV_STRATEGY.md`).
> This doc covers infra + ops only.

---

## 1. Architecture

```
                    ┌─────────────────────────────────────────────┐
   browser  ──────▶ │  web (nginx)  — serves SPA, proxies /api + WS │
                    └───────────────┬─────────────────────────────┘
                                    │  /api/*  (HTTP + WebSocket upgrade)
                                    ▼
                    ┌─────────────────────────────────────────────┐
                    │  api (NestJS + Fastify)                      │
                    │   • REST  /api/v1                            │
                    │   • WS    /api/v1/realtime/chat              │
                    │   • BullMQ worker (scoring) — in-process    │
                    └───┬───────────┬───────────────┬─────────────┘
                        │           │               │
                  ┌─────▼───┐  ┌────▼────┐   ┌───────▼────────┐
                  │ postgres │  │  redis  │   │  clickhouse    │
                  │ (Prisma) │  │ cache + │   │  (analytics)   │
                  │ + graph  │  │ BullMQ  │   │                │
                  │ checkpts │  │ + WS    │   └────────────────┘
                  └──────────┘  └─────────┘
```

- **Single API process** today: `main.ts` does not branch on `APP_ROLE`, so API +
  realtime WS gateway + BullMQ worker all run in one container. The `APP_ROLE`
  env (`api | realtime | worker`) exists for a future split into separate
  containers; until then run one `api`.
- **Conversation state** is durable in Postgres via LangGraph `PostgresSaver`
  (the `checkpoint*` tables — created at runtime, **not** Prisma-managed).
- **MinIO** (S3-compatible) is dev-only object storage; optional. Text roleplay
  does not require it. In cloud, use real S3 (`S3_*` env) or drop it.

---

## 2. Repository layout

```
apps/api            NestJS backend (Prisma, LangChain/LangGraph, ws gateway)
apps/web            React 19 + Vite SPA (TanStack Router/Query, Tailwind v4)
packages/contracts  Zod schemas shared by api + web (built to dist/)
packages/tsconfig   Shared TS config
infra/docker/       Dockerfile (api), compose files, entrypoint, pg-init
apps/web/Dockerfile + nginx.conf   web image
```

npm workspaces monorepo (root = repo root). The **web image builds from the repo
root** (not `apps/web`) because it needs `packages/contracts`.

---

## 3. Images

### API — `infra/docker/Dockerfile`
Multi-stage (node:22-alpine):
1. `deps` — `npm ci` for the workspace.
2. `builder` — `prisma generate` (no postinstall hook exists) then `nest build`.
3. `runner` — copies `dist`, `node_modules` (incl. generated Prisma client),
   `packages`, and `apps/api/prisma` (schema + migrations), plus the entrypoint.

Entrypoint `infra/docker/docker-entrypoint.sh`:
- Runs `prisma migrate deploy` (only when `APP_ROLE=api`, gated by
  `RUN_MIGRATIONS=true`) — idempotent, safe on every start.
- Then `node apps/api/dist/main.js`.

### Web — `apps/web/Dockerfile`
1. `build` — `npm ci`, build `packages/contracts`, then
   `VITE_ENABLE_MOCKS=false npm run build -w apps/web` (mocks forced **off**).
2. `runner` — `nginx:1.27-alpine` serving `dist/` with `apps/web/nginx.conf`.

`nginx.conf` serves the SPA (history fallback) and proxies `/api/` to
`api:3000`, including the **WebSocket upgrade** (`Upgrade`/`Connection` headers,
1h `proxy_read_timeout`). The browser uses a relative `/api/v1` base, so no
build-time API URL is needed.

---

## 4. Services & ports

| Service     | Container name        | Image                        | Host ports (dev) | Notes |
|-------------|-----------------------|------------------------------|------------------|-------|
| Postgres    | `traineon-db`         | `postgres:16`                | 5432             | App DB `traineon_app` (pg-init), Prisma |
| Redis       | `traineon-redis`      | `redis:7-alpine`             | 6379             | cache, BullMQ, WS session registry |
| ClickHouse  | `traineon-clickhouse` | `clickhouse/clickhouse-server:24` | 8123 / 9000 | analytics |
| MinIO       | `traineon-minio`      | `minio/minio:latest`         | 9002 / 9001      | dev object storage (optional) |
| API         | `traineon-api`        | built (`infra/docker/Dockerfile`) | 3000        | REST + WS + worker |
| Web         | `traineon-web`        | built (`apps/web/Dockerfile`)| 80 (prod)        | nginx SPA + proxy |

> Postgres uses the plain `postgres:16` image. `pgvector` was removed — nothing
> in the app uses vectors. If you later add semantic search / RAG, switch to
> `pgvector/pgvector:pg16` and `CREATE EXTENSION vector`.

---

## 5. Local development

Recommended: run the **backing services in Docker**, the **API on the host**
(fast hot-reload), and the **web dev server on the host** (Vite + MSW).

```bash
# 1. backing services
cd infra/docker
docker compose up -d postgres redis clickhouse      # (+ minio if needed)
docker compose ps                                   # all healthy

# 2. API
cd ../../apps/api
cp .env.example .env            # if not present
npx prisma migrate deploy       # or: npx prisma migrate reset --force (drops + seeds)
npx prisma db seed              # roles, admin, sample personas (colored), test users
npm run seed:llm                # OpenAI + Gemini providers/models (NO keys)
cd ../../
npm run dev --workspace=apps/api    # http://localhost:3000

# 3. Web
npm run dev --workspace=apps/web    # http://localhost:5173
```

Then add the OpenAI / Gemini API keys via **LLM Ops → Providers** (BYOK,
encrypted at rest). Default logins after seed:
`admin / Admin@123`, `trainer1|trainer2 / Trainer@123`, `trainee1..4 / Trainee@123`.

`.env` (`apps/api/.env`) key values for local:
```
DATABASE_URL=postgresql://traineon:traineon@localhost:5432/traineon_app
REDIS_URL=redis://localhost:6379
CLICKHOUSE_URL=http://localhost:8123
```

The dev `docker-compose.yml` also contains an `api` service (containerised, src
volume-mounted). Use it only if you want everything in Docker; the host-run API
above is the usual loop.

---

## 6. Production deployment (single host, Docker Compose)

Files: `infra/docker/docker-compose.prod.yml` + `infra/docker/.env.prod`
(copy from `.env.prod.example`, never commit).

```bash
# on the server
git clone <repo> /opt/traineon
cd /opt/traineon/infra/docker
cp .env.prod.example .env.prod
# fill REAL secrets — generate with: openssl rand -base64 48
nano .env.prod

docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
docker compose -f docker-compose.prod.yml ps        # healthy
```

On boot: pg-init creates `traineon_app` → the API entrypoint runs
`prisma migrate deploy` automatically → API + web come up. The API is **not**
exposed to the host; only `web` (port `WEB_PORT`, default 80) is published and
proxies to it.

### Seed once (bootstrap data)
The runtime image has no source (seeds use `ts-node` + `src`), so run seeds from
the repo checkout against the DB:
```bash
cd /opt/traineon/apps/api && npm ci
DATABASE_URL="postgresql://<user>:<pass>@<host>:5432/traineon_app" npx prisma db seed
DATABASE_URL="postgresql://<user>:<pass>@<host>:5432/traineon_app" npm run seed:llm
```
(Reach the DB by temporarily publishing the postgres port, or running on the
compose network.) Migrations are automatic; seeding is a one-time step.

### Redeploy
```bash
git pull
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```
New migrations apply at API startup.

---

## 7. Required environment (api)

From `apps/api/src/core/config/env.schema.ts`. **Required (no default):**

| Var | Notes |
|-----|-------|
| `DATABASE_URL` | Postgres connection string |
| `REDIS_URL` | Redis connection string |
| `CLICKHOUSE_URL` | ClickHouse HTTP endpoint |
| `JWT_ACCESS_SECRET` | ≥ 32 chars |
| `JWT_REFRESH_SECRET` | ≥ 32 chars |
| `CREDENTIAL_ENCRYPTION_KEY` | ≥ 32 chars — **AES-256-GCM key for BYOK provider keys.** Back it up; changing it invalidates every stored provider credential. |

Useful optional: `APP_ROLE` (`api`/`realtime`/`worker`), `CORS_ORIGINS`,
`STORAGE_PROVIDER` + `S3_*` (only if uploads used), `LOG_LEVEL`,
`SESSION_IDLE_TIMEOUT_MINUTES`, `WORKER_CONCURRENCY`. Full list in the schema.

`.env.prod.example` lists every secret needed by the prod compose.

---

## 8. TLS / HTTPS

The `web` container serves plain **HTTP on `:80`**. Production needs TLS in front
(browsers, `wss://` for the chat socket, secure cookies). Pick one:

- **Cloud load balancer / Cloudflare** terminating HTTPS → forward to `web:80`
  (no app change). Most common.
- An existing **nginx / Traefik / Caddy** on the host doing TLS → `web:80`.
- Mount certs into the web nginx and add a `443` server block.

Set `CORS_ORIGINS` to the public origin (`https://your-domain`). With the
same-origin nginx proxy, CORS is usually a non-issue.

---

## 9. Database & migrations

- **Schema**: Prisma, `apps/api/prisma/schema.prisma`. App DB = `traineon_app`.
- **Apply**: `prisma migrate deploy` (prod / CI / container entrypoint — only
  un-applied migrations, idempotent).
- **Dev reset**: `prisma migrate reset --force` drops the schema, replays all
  migrations, and runs the seed. Use when the DB drifts.
- **Checkpoint tables** (`checkpoints`, `checkpoint_writes`, …) are created by
  LangGraph at runtime and are not Prisma-managed — they reappear after a reset
  on the first roleplay session.

---

## 10. Cloud scale-out (when one host isn't enough)

- Replace stateful containers with **managed services**: Postgres → RDS/Cloud SQL,
  Redis → Elasticache/Memorystore, object → real S3 (`S3_*`), ClickHouse →
  ClickHouse Cloud. Point the API env at them.
- Split `api` / `realtime` / `worker` into separate services by `APP_ROLE` once
  `main.ts` branches on it (env enum already present).
- Run images on ECS/Fargate, Cloud Run, or k8s; serve the web build from a CDN /
  bucket instead of the nginx container.

---

## 11. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `ioredis ECONNREFUSED 127.0.0.1:6379` | Redis container not running | `docker compose up -d redis` |
| Prisma **P1000** auth failed for `traineon` | App hitting a DB without the `traineon` user — usually a **local Postgres on 5432** instead of the container, or stale volume creds | Stop the local Postgres (`Get-Service *postgres* \| Stop-Service`), then `docker compose down -v && up -d` so the container owns 5432 |
| Prisma **P3005** schema not empty | DB has tables (e.g. only LangGraph `checkpoint*` tables) but no `_prisma_migrations` | `npx prisma migrate reset --force` (drops + re-migrates + seeds) |
| Port **5432** bind error / wrong DB | A local Postgres already owns 5432 | Stop it, or remap the container host port and update `DATABASE_URL` |
| Web shows mock data in prod | `VITE_ENABLE_MOCKS` leaked into the build | Already forced `false` in `apps/web/Dockerfile`; rebuild the web image |
| WebSocket won't connect behind a proxy | Proxy not forwarding `Upgrade`/`Connection` | Ensure the TLS proxy passes WS upgrade headers (nginx config already does) |

Inspect a container's DB:
```bash
docker exec traineon-db psql -U traineon -d traineon_app -c "\dt"
```
