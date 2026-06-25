# Backend Architecture & Agentic-AI Approach

> Explanatory companion to the plan docs. Where this disagrees with older plans, **the code wins** —
> this document describes the system as it is actually built (verified against `apps/api/src`),
> not as it was originally planned. For build order and session state see
> [`DEV_STRATEGY.md`](./DEV_STRATEGY.md); for the distilled prior-implementation notes see
> [`REFERENCE_INSIGHTS.md`](./REFERENCE_INSIGHTS.md).

---

## 1. What Traineon is

Traineon is an **AI roleplay training platform**. A trainer authors a *persona* (e.g. "angry
customer", "reluctant lead") as a system prompt plus a scoring rubric. A trainee opens a live
chat session and roleplays against that persona; an LLM stays in character and drives the
conversation. When the conversation ends, a second LLM call scores the trainee's performance
against the rubric and writes structured feedback.

Two things make it "agentic" rather than a plain chatbot:

1. **Durable, stateful conversation.** Each session is a long-lived stateful interaction whose
   memory survives process restarts and can be resumed on any server replica — not a stateless
   request/response.
2. **The model decides when the roleplay is "done".** The persona prompt instructs the LLM to
   emit a termination sentinel (`[CONVERSATION_ENDED]`) when the scenario resolves. The server
   detects that, ends the session, and triggers scoring. The agent controls its own lifecycle.

---

## 2. The core concept — agentic AI approach

### 2.1 How we model an "agent"

The roleplay agent is a **single-node [LangGraph.js](https://langchain-ai.github.io/langgraphjs/)
state graph** (`START → chatbot → END`) over the built-in `MessagesAnnotation` state, compiled with
a **`PostgresSaver` checkpointer**. See `core/llm/roleplay-graph.ts`:

```ts
new StateGraph(MessagesAnnotation)
  .addNode('chatbot', callModel)   // callModel = chat.invoke([SystemMessage(prompt), ...state.messages])
  .addEdge(START, 'chatbot')
  .addEdge('chatbot', END)
  .compile({ checkpointer });
```

The graph itself is deliberately tiny — the value is in *how state is carried*:

- **State = the message list.** `MessagesAnnotation` accumulates `HumanMessage` / `AIMessage`
  entries.
- **Memory = the checkpointer.** The compiled graph is keyed by `thread_id = session.uid`. Each
  turn we append **only the new user message**; LangGraph loads the prior history from the
  checkpoint, runs the node, and writes the new state back. We never rebuild the transcript by
  hand for the model call.
- **Durability = Postgres.** `CheckpointerService` (`core/llm/checkpointer.service.ts`) holds one
  process-wide `PostgresSaver` built from `DATABASE_URL`. `.setup()` creates the checkpoint tables
  on boot. Because state lives in Postgres, **any replica can resume any session**.

The **system prompt and the model are bound per session** at connect time, not baked into the
graph definition — so the same graph code serves every persona and every provider.

### 2.2 How we reach the model — registry, not gateway

There is **no LLM gateway**. Models are constructed **in-process** by `ModelFactoryService`
(`core/llm/model-factory.service.ts`) from a **database registry**:

- `LlmProvider` rows describe a provider (`type`, optional `baseUrl`, encrypted `credentialRef`,
  `isEnabled`, `priority`). `LlmModel` rows describe a model (logical `name`, `capabilities`,
  `isDefault`, pricing).
- `resolve(modelId | null)` loads the model (null → the `isDefault` model), builds the matching
  LangChain chat model, and caches it by model id.
  - `type: "gemini"` → `ChatGoogleGenerativeAI`
  - everything else (`openai` / `openrouter` / `azure_openai` / `custom`) → `ChatOpenAI` against
    an OpenAI-compatible endpoint (OpenRouter base, custom `baseUrl`, or a local vLLM/Ollama with
    a throwaway `sk-noauth` key).
- **Fallbacks**: up to 3 other enabled-provider models are chained via LangChain's
  `.withFallbacks()`, ordered by provider `priority`. If the primary errors, the chain retries the
  next model transparently.
- **BYOK keys** are decrypted on demand with `CREDENTIAL_ENCRYPTION_KEY` (AES-256-GCM).
- **Hot reload**: when an admin edits a provider/model, `LlmOpsService` publishes on the Redis
  channel `llm:model-cache:invalidate`; every replica's factory clears its in-memory cache. No
  restart, no process-local config drift.

**Consequence of this design:** personas never reference a literal model string. They reference a
**logical role** — `conversationModelId` and `scoringModelId` (both optional → fall back to the
default model). Swapping the underlying model is a registry edit, not a code change.

### 2.3 Streaming and the termination sentinel

Tokens stream to the client turn-by-turn via `graph.stream(..., { streamMode: "messages" })`.

The persona is instructed to end its final message with `[CONVERSATION_ENDED]`. The gateway must
strip that marker before the client sees it — and the marker can **split across streamed chunks**
(`[CONVER` + `SATION_ENDED]`). So `chat.gateway.ts` keeps a **hold-back buffer** of
`len(sentinel) - 1` characters: it only emits text once it's certain the tail can't be the start
of the sentinel, scans the buffer for the marker, strips it, and sets an `ended` flag. The marker
is never streamed as visible text, and a clean end always triggers scoring.

### 2.4 New approach vs. the old reference implementation

The prior product was a **Python / FastAPI** implementation. The current stack is a deliberate
re-architecture. The shape of the agent (single-node graph, sentinel-based termination, persona
prompt wrapper, holistic one-call scoring, DB-as-source-of-truth) was **kept**; the operational
flaws were **fixed**.

| Concern | Old reference (Python/FastAPI) | Traineon (NestJS/TS) — current |
|---|---|---|
| Agent graph | Single-node LangGraph `START→chatbot→END` | **Same shape**, ported to LangGraph.js |
| Conversation memory | In-process `MemorySaver`, seeded per connect; **lost on restart**, unbounded, per-replica | **`PostgresSaver` checkpointer**, `thread_id = session.uid`; durable + replica-safe |
| Source of truth | Postgres `chat_history` (cache overlay on top) | Postgres `chat_messages` rows; checkpointer is the fast overlay |
| LLM access | Provider chosen by **in-memory registration order** (`idx % 460` bands); hardcoded model IDs | **DB registry per request**, BYOK key pool, logical model roles, no process-local state |
| Provider failover | `.with_fallbacks()` chains | **`.withFallbacks()`** chains (same idea, registry-driven) |
| Streaming | LangGraph rewrite regressed to blocking `invoke()` → one full message | **Token-by-token** `streamMode:"messages"` |
| Sentinel handling | Substring match could split across chunks | **Hold-back buffer**, marker stripped, never streamed |
| Scoring | One holistic LLM call → flat JSON, fence-strip + `repair_json`, **no schema validation** | One holistic call, **`withStructuredOutput` + Zod**, fenced-JSON fallback for dumb endpoints |
| Cost logging | Scoring/feedback calls **not** cost-logged | Pricing columns on `LlmModel` (per-call event logging → ClickHouse is the planned next step) |
| Auth | JWT HS256, single `user_id` claim, TTL in hours, **no refresh**; long-lived JWT in WS query | Short access JWT (15 min) + **rotating refresh tokens w/ reuse detection**; **one-time WS ticket** |
| Updates / errors | `POST` for updates, errors as **HTTP 200** `status:"error"`, no migrations | PATCH/DELETE, real status codes, **Prisma migrations** |
| Idle sessions | Idle-timeout was dead code | **`SessionReaperService`** cron flips idle `ACTIVE → ABANDONED` |

The "do-not-port" list (AES-ECB login, f-string SQL, per-request sync telemetry writes,
unauthenticated analytics, in-memory session/provider state) is the regression checklist in
`REFERENCE_INSIGHTS.md §Cross-cutting`.

---

## 3. Tech stack

NestJS 11 on **Fastify** · TypeScript 5 strict · npm-workspaces monorepo · **Prisma** (Postgres,
operational data) · **Redis 7 + BullMQ** (cache, pub/sub, queues) · **LangChain.js + LangGraph.js**
(LLM + agent state) · `@langchain/langgraph-checkpoint-postgres` (durable graph state) · raw `ws`
gateway (no socket.io) · JWT access + rotating refresh · pino logging · ClickHouse (analytics —
planned). All three run targets (`api` / `realtime` / `worker`) currently load in **one process**:
`AppModule` imports every module unconditionally and nothing gates on `APP_ROLE`.

---

## 4. Backend layout — `core/` vs `modules/`

The codebase splits into two layers:

- **`core/`** — cross-cutting infrastructure with no business meaning of its own. Config, database,
  Redis, queue, logger, the response envelope, error handling, crypto, auth primitives (guards /
  strategies / RBAC / verifiers), and the **LLM/agent engine** (`core/llm`).
- **`modules/`** — feature domains that compose core services into endpoints and gateways: `auth`,
  `identity` (users / roles / bulk import), `personas`, `sessions`, `realtime` (the WS chat
  gateway), `llm-ops`.

Entry point `main.ts` boots Fastify, applies the global pipe/guard/interceptor/filter stack, mounts
the `/api/v1` prefix, and starts the `ws` server. `health/` exposes public `/health` + `/ready`
probes (`/ready` checks Postgres + Redis + ClickHouse).

### Request lifecycle (HTTP)

```
Request
  → ThrottlerGuard (rate limit)
  → JwtAuthGuard       (global, default-deny; @Public() opts out)
  → RolesGuard         (@Permissions() checked against ROLE_PERMISSIONS)
  → Zod validation     (DTO schemas)
  → Controller → Service → Prisma
  → ResponseInterceptor  (wraps result in { status, message, data, meta })
  → AllExceptionsFilter  (maps DomainException / errors to the same envelope)
```

Every response uses the envelope `{ status, message, data, meta }`. The global guard is
**default-deny**: an endpoint is protected unless explicitly marked `@Public()`.

---

## 5. The roleplay flow, end to end

This is the core path everything else supports. Numbered for the happy text-chat case.

### Setup (HTTP, one-time per scenario)

1. **Admin registers a provider + model** (`POST /api/v1/llm/providers`, `POST /api/v1/llm/models`,
   `.../promote` to set the default). API key is encrypted at rest and never returned.
2. **Trainer creates a persona** (`POST /api/v1/personas`) — system prompt (instructing the
   `[CONVERSATION_ENDED]` sentinel), optional model roles, and a `scoreCriteria` rubric.
3. **Trainee starts a session** (`POST /api/v1/sessions { personaId }`) → returns
   `{ sessionId, uid, startedAt }`, status `ACTIVE`. `uid` is the durable `thread_id`.

### Connect (WebSocket handshake)

4. Client requests a **one-time realtime ticket** (`POST /api/v1/auth/realtime/ticket`) — a UUID
   stored in Redis as `rt_ticket:<id>` with a short TTL.
5. Client opens `ws://…/api/v1/realtime/chat?ticket=<t>&sessionId=<uid>`. `ChatGateway.handleConnection`:
   - `GETDEL`s the ticket from Redis (single-use). Bad/expired ticket → close `4401`.
   - Loads the session + persona. Not found / not `ACTIVE` → close `4404`. Wrong owner → close `4403`.
   - `ModelFactoryService.resolve(persona.conversationModelId)` builds the chat model (+ fallbacks).
     No usable model → close `4503`.
   - `buildRoleplayGraph(chat, persona.systemPrompt, checkpointer)` compiles the per-session agent.
   - Stores the client + graph in `SessionRegistry`, sends a **`joined`** frame.

   > **Client contract:** the `message` listener is attached *after* these awaits, so a frame sent
   > on socket `open` is dropped silently. **Clients must wait for `joined` before sending.**

### Turn loop

6. Client sends `{ type: "message", content }`. `handleTurn`:
   - Persists the user message to `chat_messages`.
   - `graph.stream({ messages: [HumanMessage(content)] }, { configurable: { thread_id: uid }, streamMode: "messages" })`
     — only the new message is passed; history comes from the checkpoint.
   - Streams `{ type: "token", delta }` frames through the hold-back buffer (sentinel-safe).
   - Persists the assembled assistant message, sends `{ type: "message_done", messageId }`.
   - If the sentinel was seen → `endSession`.

### End + scoring

7. End is triggered by **any** of: the `[CONVERSATION_ENDED]` sentinel, a `{ type:"control",
   action:"end" }` frame, or `POST /sessions/:uid/end`. Then:
   - Session status → `COMPLETED`, `endedAt` set.
   - `ScoringService.scoreSession` runs (inline from the gateway; via the **BullMQ `score-session`
     queue** from the HTTP endpoint so it never blocks).
   - One holistic LLM call against `scoringModelId` returns
     `{ scores:[{criterionId, score, feedback}], overallFeedback }`, validated by Zod
     (`withStructuredOutput`, with a fenced-JSON-parse fallback). Results are written
     transactionally: `ScoreResult` rows + `session.feedback`.
   - Gateway sends `{ type: "session_ended", scores, feedback }`.

### Reconnect & cleanup

- **Reconnect:** WS disconnect does **not** change session status. The client reconnects and sends
  `{ type:"resume", lastMessageId }`; the gateway replays missed assistant messages from
  `chat_messages`.
- **Idle reaper:** `SessionReaperService` runs every 5 min. Any `ACTIVE` session whose last
  activity (newest `chat_message.createdAt`, else `startedAt`) is older than
  `SESSION_IDLE_TIMEOUT_MINUTES` (default 30) is bulk-updated to `ABANDONED`. Abandoned sessions are
  **not** scored.

### WS frame protocol

| Direction | Frame |
|---|---|
| → in | `message{content}` · `control{action:"end"}` · `resume{lastMessageId}` · `ping` |
| ← out | `joined{sessionId,personaName,systemPrompt}` · `token{delta}` · `message_done{messageId}` · `session_ending` · `session_ended{scores,feedback}` · `pong` · `error{code,message}` |
| close codes | `4400` missing params · `4401` bad ticket · `4403` wrong owner · `4404` no/inactive session · `4503` no model |

---

## 6. Module reference

### `core/` — infrastructure

| Module / file | Responsibility |
|---|---|
| `core/config` | Loads + **Zod-validates env** at boot (`env.schema.ts`). Typed `ConfigService<Env>`. |
| `core/database` | `PrismaService` — Prisma client lifecycle. |
| `core/redis` | Provides the `REDIS_CLIENT` ioredis instance (cache, pub/sub, tickets). |
| `core/queue` | BullMQ wiring (queues backed by Redis). |
| `core/logger` | pino logger module. |
| `core/envelope` | `ResponseInterceptor` — wraps every success in `{status,message,data,meta}`. |
| `core/errors` | `DomainException` + typed subclasses (`NotFound`, `Forbidden`, `Unauthorized`); `AllExceptionsFilter` maps everything to the envelope. |
| `core/crypto` | `crypto.util.ts` — AES-256-GCM `encryptSecret` / `decryptSecret` for BYOK keys. |
| `core/auth` | `JwtAuthGuard` (global default-deny), `RolesGuard`, `@Public()` / `@Permissions()` / `@CurrentUser()` decorators, `jwt.strategy`, RBAC map (`role-permissions.ts`), pluggable `CredentialVerifier` (local seeded users; external corporate API is the extension point). |
| **`core/llm`** | **The agent engine.** `model-factory.service` (registry → LangChain models + fallbacks + cache), `checkpointer.service` (process-wide `PostgresSaver`), `roleplay-graph` (the single-node graph builder), `scoring.service` (holistic rubric scoring). |

### `modules/` — feature domains

| Module | Endpoints / surface | What it does |
|---|---|---|
| `auth` | `POST /auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/realtime/ticket` | Login via `CredentialVerifier` (`LocalVerifier` checks a `DefaultCredential` **argon2** hash); issues short access JWT + **rotating refresh token** (family-based, reuse → whole family revoked). Issues one-time **Redis** WS tickets (`rt_ticket:<id>`, single-use `GETDEL`). |
| `identity` | `/users` (CRUD), `/roles`, bulk import | User management + supervisor self-reference + persona assignment. **Bulk import** accepts XLSX or CSV (ExcelJS), enqueues one `user-import` BullMQ job, and the `import.processor` iterates rows sequentially: validates, resolves role from a cached map, **upserts by `employeeId`**, and creates a `DefaultCredential` (argon2 hash, defaulting username/password to `employeeId`) if absent. Per-row errors accumulate in `ImportReport.errorData` and download as an XLSX error report. |
| `personas` | `/personas` CRUD, `/personas/mine`, `/personas/:id/versions` | Persona authoring with rubric (`scoreCriteria`). **Snapshot-on-edit versioning**: every update copies the prior persona into `PersonaVersion` before mutating. Soft-delete (`isDeleted`). Trainees see only their `assignedPersona`. |
| `sessions` | `POST /sessions`, `GET /sessions`, `GET /sessions/:uid`, `GET /sessions/:uid/messages`, `POST /sessions/:uid/end` | Session lifecycle + transcript read. `USER` role is scoped to own sessions. `end` flips to `COMPLETED` and **queues** scoring (`score-session`). Includes the `SessionReaperService` idle cron. |
| `realtime` | WS `/api/v1/realtime/chat` | The roleplay chat gateway (§5). `SessionRegistry` maps socket ↔ session ↔ compiled graph **(in-process Map — single-node only; cross-replica liveness is a known gap).** |
| `llm-ops` | `/llm/providers`, `/llm/models`, `/llm/models/:id/promote` (perms `llmops:read/write`, SUPER_ADMIN) | Provider/model registry admin. API key **write-only** (`credentialRef` omitted on every read). Mutations publish the Redis cache-invalidation signal. |

---

## 7. Data model (Prisma)

Operational data is Postgres via Prisma (`apps/api/prisma/schema.prisma`). Key tables:

- **Identity / auth** — `RoleDef`, `User` (self-ref `supervisor`, optional `assignedPersona`,
  soft-delete), `DefaultCredential` (username + **argon2** `passwordHash`), `RefreshToken` (hash +
  `familyId` + `isRevoked`). *(`RealtimeTicket` table exists in the schema but is currently
  vestigial — live WS tickets are stored in Redis, not this table.)*
- **LLM registry** — `LlmProvider` (`type`, `baseUrl`, encrypted `credentialRef`, `priority`,
  `monthlyBudgetUsd`), `LlmModel` (`name` unique, `capabilities[]`, pricing, `isDefault`).
- **Personas** — `Persona` (`systemPrompt`, `customInstructions`, optional `conversationModelId` /
  `scoringModelId`, soft-delete), `PersonaVersion` (immutable snapshots, `@@unique([personaId,
  version])`), `ScoreCriterion` (rubric rows: `maxScore`, `weight`, `order`), `VoiceStyle`
  (deferred — voice not built).
- **Sessions** — `Session` (`uid` = graph `thread_id`, `status` ACTIVE|COMPLETED|ABANDONED,
  `feedback`), `ChatMessage` (`role` user|assistant, `content`, `tokenCount`), `ScoreResult`
  (per-criterion score + feedback).
- **Import** — `ImportReport` (status, row counts, `errorData`).

> Conversation **memory** is twofold: the human-readable transcript lives in `chat_messages`
> (system of record, used for resume + scoring), while the **LangGraph checkpoint tables** (created
> by `PostgresSaver.setup()`, keyed by `session.uid`) hold the graph state the model actually reads
> each turn. The transcript is truth; the checkpoint is the fast overlay.

---

## 8. Cross-cutting invariants

- **No hardcoded model strings.** Personas reference logical roles resolved through the registry at
  session start.
- **BYOK keys encrypted at rest** (AES-256-GCM, `CREDENTIAL_ENCRYPTION_KEY`); credential APIs are
  write-only / masked.
- **Roles:** `SUPER_ADMIN` ⊃ `TRAINER` ⊃ `USER`, one role per user, supervisor self-reference. No
  groups/cohorts. Permissions enumerated in `core/auth/rbac/role-permissions.ts`.
- **Default-deny auth** — global `JwtAuthGuard`, explicit `@Public()` opt-out.
- **Durable conversation state** via `PostgresSaver` (`thread_id = session.uid`); the Redis/in-proc
  registry holds liveness/routing only.
- **Envelope everywhere** — `{ status, message, data, meta }`; real HTTP status codes; errors never
  returned as 200.

---

## 9. Known drifts & gaps (trust code, not older docs)

- **Env names:** the encryption key is **`CREDENTIAL_ENCRYPTION_KEY`** (not `MASTER_ENCRYPTION_KEY`);
  the run target is **`APP_ROLE`** (not `ROLE`).
- **No run-role split (yet).** `AppModule` loads every module; one `npm run dev` serves HTTP + WS +
  scoring worker. The `api`/`realtime`/`worker` split is planned, not wired.
- **`SessionRegistry` is an in-process `Map`.** Single-node only. The "Redis session registry for
  cross-replica liveness/routing" described in CLAUDE.md is **not** built — the reaper covers
  single-node cleanup; multi-replica liveness is the remaining gap.
- **Cost/telemetry to ClickHouse is planned, not wired.** Pricing columns exist on `LlmModel`;
  per-call `llm_events` logging + analytics rollups are the next analytics step.
- **WS send-after-`joined` race** is a latent gateway bug (listener attached post-await). Documented
  client contract works around it; buffering/early-attach is the real fix.
- Voice, leaderboard, badges are **deferred** (text-only chat first).
</content>
</invoke>
