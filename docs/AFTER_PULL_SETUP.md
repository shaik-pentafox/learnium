# After Pulling: Voice Model Registry Update

Commands to run after pulling the `feature/model-masters` work (master
provider/model catalog + native S2S voice models). Run from the repo root
unless noted.

## 1. Install dependencies

New packages: `@langchain/anthropic`, `@google/genai` (Gemini Live),
`@langchain/core` pinned to `1.1.49`.

```bash
npm install
```

## 2. Apply database migrations

Two new migrations (forward-only, **no data loss**):

- `20260702000000_add_master_catalog_and_voice_models` — master_providers /
  master_models tables, per-kind primary models, persona voiceModelId,
  drops the unused `llm_providers.priority` column
- `20260703000000_add_persona_voice_id` — `personas.voiceId`

```bash
cd apps/api
npx prisma migrate deploy
npx prisma generate
```

> If `migrate deploy` reports drift about `checkpoint_*` tables: those are
> LangGraph runtime tables, expected to be outside Prisma — do NOT reset.

## 3. Seed the master catalog (required)

Populates master providers/models and links your existing configured
providers/models to their masters. Idempotent — safe to re-run any time.

```bash
npm run seed:llm    # still inside apps/api
```

## 4. Restart services

```bash
# dev
npm run dev            # apps/api
npm run dev            # apps/web

# docker VM
docker compose up -d --build api web
```

## 5. One-time admin configuration (UI)

Voice now runs off the registry, not env vars:

1. **LLM Ops → Providers → Add provider** — pick a master (OpenAI / Google /
   Anthropic / Sarvam), paste the API key. Key is encrypted; only a masked
   hint is shown afterwards.
2. **LLM Ops → Models → Add model** — pick the provider → Chat or Voice tab →
   pick from the catalog. First model of each kind becomes primary
   automatically; use "Set primary" to change.
3. **Persona builder → Voice** — (optional) pin a voice model, pick the
   spoken voice (play button previews it), select trainee languages.

Notes:
- `SARVAM_API_KEY` env var still works as a legacy fallback for the Sarvam
  pipeline, but the registry key wins. New setups need no voice env vars.
- Existing personas keep working; text chat and scoring are unchanged.

## 6. Adding new catalog models later

```bash
cd apps/api
# ad-hoc (survives reseeds):
npm run model:add -- --provider google --kind voice \
  --key gemini-3.1-flash-live-preview --name "Gemini 3.1 Flash Live" \
  --pipeline s2s --languages en-IN,hi-IN --voices Puck,Charon

# or edit prisma/seed-llm.ts and re-run:
npm run seed:llm
```

## Quick smoke test

1. Text chat session works (persona → Chat).
2. Voice: persona with languages → Arena → mic button → speak → sub-second
   reply; talking over the agent interrupts it; End & score stops audio and
   produces scores.
