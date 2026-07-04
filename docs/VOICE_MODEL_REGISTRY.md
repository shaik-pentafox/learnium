# Unified Provider/Model Masters + Native Voice Models

## Context

Voice today = Sarvam STT → LLM → Sarvam TTS, hardcoded, ~1.5–4s time-to-first-audio. Latency and UX are unacceptable, so we move to native speech-to-speech (S2S) voice models — but provider-agnostic. The admin flow becomes master-driven: a seeded DB catalog of providers and models (chat + voice); admin picks a master provider, enters an API key, then registers models by picking from that provider's master models. Manual primary selection per kind — one primary **chat** model and one primary **voice** model, allowed to be from different providers (e.g., gpt-4o-mini chat + Gemini Live voice).

Decisions locked:
- **Extend existing** `LlmProvider`/`LlmModel` tables (client VM has live data) — no parallel new registry
- **Keep per-persona override** (conversation/scoring/voice model pinning; unset = primary)
- **No provider priority** — manual primary instead; auto-primary when only one model of a kind exists
- Extras in scope: **masked key + rotate** only
- Implement **both** OpenAI Realtime and Gemini Live managers; seed a **rich master catalog**

## Admin Flow

1. **Add provider** → pick from master provider list → enter API key → provider configured
2. **Add model** → dropdown of *configured* providers only → select **Chat | Voice** tab →
   - Chat: dropdown of that provider's master chat models, each row shows `name · $in/$out per M tokens · context window`
   - Voice: that provider's master voice models, each row shows `name · pipeline · languages`
3. **Primary**: manual "Set primary" per kind; first model of a kind auto-primary. Chat primary and voice primary can be different providers.

---

## Phase 1 — DB Schema (`apps/api/prisma/schema.prisma`)

### New master tables

```prisma
model MasterProvider {
  id             Int              @id @default(autoincrement())
  key            String           @unique   // 'openai' | 'google' | 'anthropic' | 'sarvam'
  name           String                     // "OpenAI", "Google Gemini", ...
  adapterType    String                     // runtime construct branch: 'openai' | 'gemini' | 'anthropic' | 'sarvam'
  defaultBaseUrl String?
  supports       String[]                   // ['chat'] | ['chat','voice'] | ['voice']
  models         MasterModel[]
  configured     LlmProvider[]
  @@map("master_providers")
}

model MasterModel {
  id                    Int            @id @default(autoincrement())
  masterProviderId      Int
  masterProvider        MasterProvider @relation(fields: [masterProviderId], references: [id])
  key                   String         // provider model id: 'gpt-4o-mini', 'gpt-4o-realtime-preview'
  name                  String         // display
  kind                  String         // 'chat' | 'voice'
  contextWindowTokens   Int?           // chat
  inputPricePerMillion  Float?         // chat
  outputPricePerMillion Float?         // chat
  voicePipeline         String?        // voice: 's2s' | 'stt+tts'
  languages             String[]       // voice: BCP-47
  voices                String[]       // voice: provider voice ids
  configured            LlmModel[]
  @@unique([masterProviderId, key])
  @@map("master_models")
}
```

### Extend existing tables

```prisma
model LlmProvider {
  // + masterProviderId Int?  (FK, null = legacy row)
  // + credentialHint  String?  // "sk-…abc4" computed at write, for masked display
  // - priority  (DROP column; UI + fallback logic no longer use it)
}

model LlmModel {
  // + masterModelId Int?  (FK, null = legacy row)
  // + kind String @default("chat")   // 'chat' | 'voice'
  // isDefault invariant changes: exactly one default PER KIND (one chat primary + one voice primary)
  // + voicePersonas Persona[] @relation("VoiceModel")
}

model Persona {
  // + voiceModelId Int?
  // + voiceModel   LlmModel? @relation("VoiceModel", ...)
  // voiceStyleId stays for now (deprecated; removed in a later cleanup migration)
}
```

Migration: `npx prisma migrate dev --name add_master_catalog_and_voice_models`

### Master seed (extend `apps/api/prisma/seed-llm.ts`, keep `npm run seed:llm`)

Upsert-by-key so re-running updates the catalog. Seed:

**Providers:** OpenAI (chat+voice), Google Gemini (chat+voice), Anthropic (chat), Sarvam AI (chat+voice).

**Chat masters** (name, ctx, $in/$out per M):
- OpenAI: `gpt-4o-mini`, `gpt-4o`, `gpt-4.1`, `gpt-4.1-mini`, `gpt-4.1-nano`
- Google: `gemini-2.5-flash`, `gemini-2.5-flash-lite`, `gemini-2.5-pro`, `gemini-2.0-flash`
- Anthropic: `claude-sonnet-4-5`, `claude-haiku-4-5`
- Sarvam: `sarvam-m` (OpenAI-compatible, baseUrl `https://api.sarvam.ai/v1`)

**Voice masters:**
- OpenAI: `gpt-4o-realtime-preview`, `gpt-4o-mini-realtime-preview` (s2s, voices: alloy/echo/shimmer/verse/…)
- Google: `gemini-2.0-flash-live-001`, `gemini-2.5-flash-preview-native-audio-dialog` (s2s, strong Indic coverage)
- Sarvam: `saarika-bulbul` (stt+tts, existing 11 Indic languages + 8 voices)

Backfill: seed script best-effort links existing `LlmModel` rows to masters by name match; unmatched rows stay legacy (`masterModelId` null) and keep working.

---

## Phase 2 — LLM Ops API (`apps/api/src/modules/llm-ops/`)

**New read endpoints:**
- `GET /llm/masters/providers` → master providers (+ which are already configured)
- `GET /llm/masters/models?providerId=<configuredId>&kind=chat|voice` → master models for that configured provider's master

**Provider CRUD changes:**
- Create DTO: `{ masterProviderId, apiKey, name?, baseUrl? }` — type/baseUrl default from master; drop `priority`
- On write: compute `credentialHint` = first 3 + last 4 chars masked; encrypt key via existing `encryptSecret` (`core/crypto/crypto.util.ts`)
- List response includes `credentialHint`; key itself never returned
- Update with `apiKey` present = rotate (re-encrypt + new hint)

**Model CRUD changes:**
- Create DTO: `{ providerId, masterModelId, isDefault? }` — name/kind/pricing/context copied from master into the LlmModel row, voice metadata read from master at runtime
- `promoteModel(id)` → primary invariant scoped **per kind**
- Auto-primary: first enabled model of a kind gets `isDefault=true`
- Legacy manual create path stays for legacy rows but UI no longer exposes it

Redis cache invalidation on all writes (existing pattern, unchanged).

---

## Phase 3 — ModelFactoryService (`apps/api/src/core/llm/model-factory.service.ts`)

- `resolve(null)` → default where `kind='chat'` AND `isDefault=true` AND provider enabled
- **Remove priority-based fallback chain** — primary failure surfaces as PROVIDER_ERROR (accepted behavior change)
- `construct()`: add `adapterType === 'anthropic'` branch → `ChatAnthropic` (new dep `@langchain/anthropic`); `sarvam` chat via ChatOpenAI + baseUrl
- Resolution prefers `masterProvider.adapterType` when linked, falls back to legacy `provider.type`

---

## Phase 4 — Voice Runtime (`apps/api/src/core/voice/`)

### Common interface

```typescript
// voice-manager.ts
export interface IVoiceManager {
  start(): Promise<void>
  pushAudio(buf: Buffer): void
  cancel(): void                       // barge-in
  destroy(): Promise<void>
  readonly pipeline: 's2s' | 'stt+tts'
  // stt+tts only (gateway pipes LLM stream through these):
  onTokenDelta?(delta: string): void
  onStreamEnd?(): void
}
```

Existing `VoiceTurnManager` implements it (`pipeline = 'stt+tts'`).

### `voice-model-factory.service.ts`

Resolves `persona.voiceModelId` (fallback: primary voice model) → loads LlmModel + master + provider → decrypts key → dispatches by `masterProvider.adapterType`:
- `openai` → `OpenAIRealtimeManager`
- `gemini` → `GeminiLiveManager`
- `sarvam` → existing `VoiceTurnManager` + `SarvamVoiceProvider` (apiKey from registry; `SARVAM_API_KEY` env stays as legacy fallback)

### `managers/openai-realtime.manager.ts` (raw `ws`, no new dep)

- WS `wss://api.openai.com/v1/realtime?model=<key>`, headers `Authorization: Bearer`, `OpenAI-Beta: realtime=v1`
- On open: `session.update` — `instructions` = persona system prompt + language instruction, `voice`, `input_audio_format: pcm16` (16kHz in), `output_audio_format: pcm16` (24kHz out), `turn_detection: server_vad`, input+output transcription enabled
- Client PCM16 frames → `input_audio_buffer.append` (base64)
- `response.output_audio.delta` → binary frame to client via existing `tts_meta` + binary protocol (client AudioPlayer unchanged)
- Transcription events → `stt_partial`/`stt_final` frames (captions keep working)
- `response.done` → persist user + assistant ChatMessages (scoring pipeline unchanged); usage `kind: 'voice'` via `UsageService`
- `[CONVERSATION_ENDED]` sentinel on output transcript → trigger endSession (same as text flow)
- `cancel()` → `response.cancel` + `input_audio_buffer.clear`

### `managers/gemini-live.manager.ts` (new dep `@google/genai`)

- `ai.live.connect({ model, config: { systemInstruction, responseModalities: ['AUDIO'], speechConfig } })`
- Client PCM16 16kHz → `sendRealtimeInput({ audio: { data, mimeType: 'audio/pcm;rate=16000' } })`
- Server audio (24kHz PCM) → binary frames; transcription events → `stt_partial`/`stt_final`
- Same persistence/usage/sentinel duties (shared transcript persistence helper)

`UsageService`: add `'voice'` to `UsageKind` (keeps `'stt'`/`'tts'` for Sarvam path).

---

## Phase 5 — Gateway (`apps/api/src/modules/realtime/chat.gateway.ts`)

`startVoice()`:
- Resolve voice model via `VoiceModelFactory` (persona.voiceModelId → else primary voice model → else `VOICE_NOT_CONFIGURED`)
- Validate `languageCode` against master model `languages`
- S2S manager: graph NOT used — manager owns the LLM. Language instruction goes into manager session instructions (reuse `languageInstruction()`)
- stt+tts manager: existing flow unchanged (graph + `onTokenDelta`/`onStreamEnd`)
- `WsClient`: `voiceTurn?: IVoiceManager`; `personaLanguages` = voice model languages ∩ persona.languages (also in `joined` frame)

---

## Phase 6 — LLM Ops Frontend

Files: `apps/web/src/routes/_auth/llm-ops.tsx`, `components/llm-ops/`, `components/settings/models-section.tsx`

**Providers tab:**
- Add provider dialog: step 1 — master provider dropdown (configured ones marked); step 2 — API key (+ optional baseUrl override). No priority, no free-text type.
- Provider cards: masked key (`credentialHint`), Rotate key action, enable/disable.

**Models tab:**
- Add model dialog: (1) configured-provider dropdown; (2) **Chat | Voice** tabs; (3) master model dropdown with metadata rows.
- Table: kind badge; primary badge per kind; "Set primary" scoped to kind.

---

## Phase 7 — Persona Builder + Session Flow

- Persona builder: **Voice model** dropdown replaces `voiceStyleId` picker (empty = primary voice model; "None" disables voice); `languages` multi-select filtered to selected model's languages
- Persona DTO/service: add `voiceModelId`
- Arena/session (already shipped `d61ff9b8`): unchanged — voice button when persona has languages; `?voice=<lang>` flow same

---

## Phase 8 — Cleanup (follow-up)

- Drop `VoiceStyle` + `Persona.voiceStyleId` + `/voice` catalog module once re-configured
- Remove `SARVAM_*` env vars after Sarvam is registry-configured

---

## Dependencies to add (`apps/api`)

- `@langchain/anthropic` (Anthropic chat)
- `@google/genai` (Gemini Live; distinct from `@langchain/google-genai`)
- OpenAI Realtime uses existing `ws` — no SDK needed

## Verification

1. `npm run seed:llm` → masters populated; existing models linked where names match
2. Add provider: pick "OpenAI" master, paste key → card shows masked hint
3. Add model → Chat tab → `gpt-4o-mini` (row shows pricing/ctx) → auto-primary
4. Add model → Voice tab → `gpt-4o-realtime-preview` → auto-primary voice
5. Add Google provider + `gemini-2.0-flash-live-001` → Set primary → chat primary (OpenAI) + voice primary (Google) coexist
6. Persona: select voice model, languages restricted to model's list
7. Arena → Voice: speak → S2S reply well under 1s TTFA; captions render; barge-in works; transcript persisted; End & score works
8. Sarvam persona → still works via old pipeline (regression)
9. Text chat unaffected; scoring override unaffected

## Implementation order

```
1. Schema + migration + master seed          (~2h)
2. LLM Ops API (masters, provider, model)    (~3h)
3. ModelFactory changes                      (~1h)
4. IVoiceManager + factory + Sarvam refit    (~2h)
5. OpenAIRealtimeManager                     (~3h)
6. GeminiLiveManager                         (~3h)
7. Gateway wiring                            (~1h)
8. LLM Ops frontend                          (~3h)
9. Persona builder + DTOs                    (~1.5h)
```
