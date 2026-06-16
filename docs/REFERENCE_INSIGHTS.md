# Reference Implementation Insights

Distilled strategy notes from the prior reference implementation (Python/FastAPI), captured to inform the Learnium build. **Not a spec** — [`DEV_STRATEGY.md`](./DEV_STRATEGY.md) is authoritative. Each section lists what to **adopt**, what to **avoid**, and how it maps to the current stack (NestJS · Prisma · LangChain.js + LangGraph.js · Redis/BullMQ · ClickHouse).

---

## 1. Roleplay chat engine

**How it worked:** single-node LangGraph (`START → chatbot → END`); state = `{messages, user_query, final_text, emoji, token counts}`. System prompt wraps the persona in an XML `<character_definition>` block with strict no-break-character rules, a "exactly one emoji per response" rule, and a `[CONVERSATION_ENDED]` termination sentinel. DB (`chat_history`) is the source of truth; graph memory was an in-process `MemorySaver` seeded on connect via `preload_history()`.

**Adopt:**
- **Persona-prompt wrapper**: XML-tagged sections (`<character_definition>`, rules, termination logic). Portable, model-agnostic.
- **Sentinel-based end detection**: LLM emits a termination marker; server strips it and ends the session. Plus an explicit client `end_session` fallback.
- **Per-message emoji extraction**: parse + strip emoji from the response, send as separate metadata (`emotion`/`emoji`), robust to dict/list/string LLM output.
- **DB-as-truth + cache overlay**: conversation lives in Postgres; the graph checkpointer is a fast overlay, not the system of record.

**Avoid / fix:**
- **`MemorySaver` (in-process, unbounded, lost on restart)** → use the mandated **`PostgresSaver` checkpointer** (thread_id = `session.uid`); replica-safe, no eviction problem. *(current code reloads `chat_messages` each turn instead — works, but the checkpointer is the planned path.)*
- **Streaming regression**: the LangGraph rewrite blocked on `invoke()` and emitted one full message; the older path streamed per-chunk. → **stream token-by-token** via LangChain.js callbacks (`{type:"token", delta}` frames).
- **Sentinel splitting across chunks**: substring match on a streamed marker can split (`[CONVER` + `SATION_ENDED]`). → emit the marker as a structured control event, never inside streamed tokens.
- **Idle-timeout dead code**: `receive()` wasn't wrapped in a timeout. → wrap WS receive in a timeout race.
- **Fragile turn-count derivation** from `unique_id` suffix. → store an explicit turn counter.

**WS protocol seen (for `packages/contracts`):** `control{action:started|conversation_ended}`, per-turn `{id, role, output_message, emoji}`, `response_meta`, `error{message}`; client→server `{input_message}`, `{action:end_session}`, first-message `unique_session_id` ownership check (tab-hijack guard, close 4003).

---

## 2. End-of-session scoring & feedback

**How it worked:** an `EndSessionHandler` ran 3 concurrent tasks (stream feedback, generate scores, watch disconnect). Scoring = **one holistic LLM call** returning a flat JSON `{column_name: score}` (not per-criterion calls), parsed with markdown-fence stripping + `repair_json`. Feedback = free-text, streamed to the client and always persisted even on disconnect. Scores written one row per rubric column.

**Adopt:**
- **Rubric versioning at session START**: load + snapshot the scoring/feedback prompts and criteria for the version active when the session began — scores stay reproducible if the persona is edited later. *(Strongly worth porting — matches `PersonaVersion`.)*
- **Trivial-session guard**: skip scoring if `< 6 messages` or `< 60s`.
- **Decouple end from chat**: HTTP/Control `end` triggers a background scoring job (BullMQ), never blocking the chat socket.
- **Tolerant JSON parsing**: strip fences + repair before `JSON.parse`, but **add schema validation** (Zod) the reference lacked.
- **Always-persist feedback/scores even if the client disconnected** (watch-disconnect task).

**Avoid / fix:**
- **Scoring/feedback LLM calls were NOT cost-logged** — the most expensive calls were invisible. → **log every LLM call** (chat, scoring, feedback, enhance) with tokens + cost.
- **No transaction around partial scores/feedback** → wrap in a transaction or status flags (`feedback_pending`, `scores_pending`).
- **No output schema validation** → enforce a Zod contract on the scoring JSON.

---

## 3. LLM provider selection & cost observability

**How it worked:** `LLMProvider.get_provider(user_id)` spread users across gemini/azure/vertex by **in-memory registration order** (`idx % 460` → fixed bands), with LangChain `.with_fallbacks()` chains. Per-call rows written to `llm_logs`; dashboards computed cost as `tokens/1e6 × price_per_million` joined to an `llm_models` pricing table. External integrations (auth, lookups) stored in an `external_apis` table and invoked through a multi-backend HTTP client (aiohttp→httpx→urllib) with retry+backoff.

**Adopt:**
- **`.withFallbacks()` chains** per logical model role (LangChain.js native).
- **Cost formula + pricing table**: `inputTokens/1e6 × inputPricePerMillion + …`; keep input/output price-per-million on `LlmModel`.
- **`llm_logs` dimensional schema**: tokens (in/out/thoughts/total), model, session, user, persona, **`mode`** (chat|voice|scoring|feedback|enhance), latency, metadata → maps cleanly to a **ClickHouse `llm_events`** table for analytics.
- **DB-driven external-API registry**: store URL/method/headers/templates in a table, look up by name (matches `ExternalApi`/`CredentialVerifier external`).
- **Multi-backend HTTP + retry/backoff** for the corporate auth API.

**Avoid / fix:**
- **In-memory provider assignment resets on restart and differs per replica** → resolve provider/model from the **DB registry per request**; let the LangChain.js factory + key-pool (BYOK `llm_credentials`) handle balancing. No process-local state.
- **Hardcoded provider list + model IDs** (`model_id = 2`) → everything via the registry; personas reference models by logical role, never a literal.
- **Pricing seeded once, no hot-reload** → registry is editable at runtime (already the F8 design); refresh via Redis pub/sub.

---

## 4. Realtime voice  *(DEFERRED — forward-reference only)*

**How it worked:** two providers — `BasicVoiceAssistant` (Azure VoiceLive, server VAD) and `GeminiVoiceAssistant` (Gemini Live, RMS-energy barge-in) — duplicating lifecycle, transcript, and persistence logic. PCM16 @ 16 kHz in / 24 kHz out, base64 JSON frames. Sessions tracked in a global `active_voice_sessions[session_id]` registry enabling reconnect.

**Adopt (when voice is built):**
- **Common `VoiceProvider` interface** — `connect / sendAudio / onAudio / interrupt / end` — the reference *lacked* this and paid for it in duplication; define it up front.
- **Provider-agnostic transcript protocol**: stream deltas `{type:user_transcript|assistant_transcript, text, isFinal}`; persist final text via the **same scoring path as text** (transport-agnostic — already a DEV_STRATEGY decision).
- **3-point timestamps** (user-query-start, user-response-end, llm-start) for latency metrics.
- **Session registry → reconnect** by swapping the socket and replaying history.

**Avoid / fix:**
- Hardcoded VAD/energy thresholds → config.
- Reconnect asymmetry (Azure replayed history, Gemini didn't) → uniform resume.
- Unreliable token counts on streaming voice → reconcile/estimate explicitly.
- Per-provider duplicated state machines → the interface above.

---

## 5. Auth

**How it worked:** JWT HS256, single claim `user_id`, TTL in hours, **no refresh token** (re-login required). HTTP via Bearer (raises 401); WS via `?token=` query param returning `{type:error|user_id}` instead of raising.

**Adopt:**
- WS auth that **returns** a typed result rather than throwing (clean gateway handling).
- Pluggable credential verification (local seeded users vs external corporate API).

**Avoid / fix:**
- **AES-ECB login payload** (deterministic, no IV) → TLS-only; AES-256-GCM only if a contract forces payload encryption.
- **No refresh/revocation** → short access JWT (15 min) + **rotating refresh tokens** with reuse detection (already implemented). 
- **Long-lived JWT in WS query string** → one-time short-TTL **WS ticket** (already implemented).
- **Unauthenticated dashboard/analytics endpoints** → global default-deny guard + explicit `@Public()`.

---

## 6. Personas & users

**Personas — adopt:** snapshot-on-edit **versioning** (full row copy into a version-control table, immutable history); scoring config as structured columns/criteria; logical model roles (conversation/scoring) resolved via registry. **Avoid:** unstructured `score_columns` JSON for the rubric (use proper `ScoreCriterion` rows); no input validation on `custom_instructions` (sanitize for prompt-injection).

**Users — adopt:** bulk XLSX import with a **bounded worker pool** (semaphore), pre-loaded lookup maps, get-or-create with locks, **per-row error tracking → error report file in object storage → import-report row** (matches `ImportReport` + BullMQ). Case-insensitive dedupe (`LOWER(...)`). Soft-delete (`is_deleted` filtered everywhere). **Avoid:** **import concurrency exceeding the DB pool** (cap it); **denormalized JSON columns for relationships** (`mapped_jcs`, `domains`) → use proper join tables; f-string SQL in lookups → parameterized.

---

## 7. Telemetry & analytics

**Telemetry — how it worked:** middleware did a **synchronous DB write on every HTTP request** (`asyncio.to_thread`) accumulating per-session active/idle duration (120s idle threshold), plus daily aggregate rows.
- **Adopt:** the session/active/idle/daily-rollup model; 120s idle detection.
- **Avoid:** **per-request sync DB writes** (contention, latency) → in-memory accumulator flushed every ~30s by a **BullMQ worker** (batch upsert) — same data, ~1000× fewer writes.

**Analytics — how it worked:** heavy multi-CTE Postgres queries (lifetime + date-filtered summaries, per-day/per-wave breakdowns, `JSONB_BUILD_OBJECT` assembly), no caching, minimal pagination, 31-day range cap.
- **Adopt:** the aggregate set (sessions, completion, durations formatted HH:MM:SS, distinct users/personas, time-series buckets); range caps to bound scans.
- **Avoid:** live multi-CTE scans on the hot path → **materialize into ClickHouse `session_events`/rollups** and read those (per DEV_STRATEGY); add caching + pagination.

---

## Cross-cutting "do not port" (the reference's known flaws)

AES-ECB · errors returned as **HTTP 200** with `status:"error"` · **POST for updates** (use PATCH/DELETE) · **no migrations** (tables auto-created at boot) · plaintext seeded credentials · f-string SQL · per-request sync telemetry writes · unauthenticated analytics/LLM endpoints · in-memory session/provider state. The new stack already addresses each — this list is the regression checklist.
