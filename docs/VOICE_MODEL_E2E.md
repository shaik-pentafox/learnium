# Voice Models — End-to-End Working

How a spoken conversation flows through the system: from the admin registering a
voice model, to a trainee talking with a persona, to the scored transcript.

Related: [VOICE_MODEL_REGISTRY.md](./VOICE_MODEL_REGISTRY.md) (design/plan) ·
[VOICE_SESSION_FLOW.md](./VOICE_SESSION_FLOW.md) (session/turn lifecycle) ·
[AFTER_PULL_SETUP.md](./AFTER_PULL_SETUP.md) (developer setup)

---

## 1. The registry: masters → configured → persona

Everything is driven by a two-level catalog in Postgres:

```
master_providers (seeded)          llm_providers (admin-configured)
  OpenAI    chat+voice      ──►      "OpenAI" + encrypted API key
  Google    chat+voice      ──►      "Google Gemini" + encrypted API key
  Anthropic chat
  Sarvam    chat+voice

master_models (seeded)             llm_models (admin-picked)
  gpt-realtime         voice s2s ─►   kind='voice', isDefault (primary)
  gpt-realtime-mini    voice s2s
  gemini-2.0-flash-live voice s2s
  saarika-bulbul       voice stt+tts
  gpt-4o-mini, gemini-2.5-flash, ...  (chat)
```

- **Masters** are seeded by `npm run seed:llm` (upsert by key — re-run to refresh;
  ad-hoc additions via `npm run model:add`). Never edited through the API.
- **Configured providers** = master + API key (AES-256-GCM encrypted at rest;
  only a masked hint like `sk-…Yn4A` is ever returned).
- **Configured models** copy metadata from their master. Exactly one primary
  (`isDefault`) **per kind** — one chat primary and one voice primary may live
  on different providers (e.g. gpt-4o-mini chat + Gemini Live voice).
- **Persona** may pin `voiceModelId` (else primary voice model), pick `voiceId`
  (e.g. `alloy`, `Puck`; else the model's first voice) and `languages`
  (BCP-47 codes the trainee can choose from; empty = text-only persona).

## 2. Two pipelines, one interface

`VoiceModelFactory.resolve()` loads the persona's voice model + decrypts the
provider key, then `createManager()` dispatches on the master's `adapterType`:

| adapterType | Manager | Pipeline |
|---|---|---|
| `openai` | `OpenAIRealtimeManager` | **s2s** — one WebSocket to OpenAI Realtime (GA API): VAD + STT + LLM + TTS in-model |
| `gemini` | `GeminiLiveManager` | **s2s** — Gemini Live via `@google/genai` |
| `sarvam` | `VoiceTurnManager` | **stt+tts** — Saarika STT ws → app LangGraph LLM → Bulbul TTS REST |

All three implement `IVoiceManager` (`start / pushAudio / cancel / destroy`),
so the gateway never sees provider specifics.

Key difference: in **s2s** the manager owns the whole turn (the app's LangGraph
is bypassed; the persona system prompt + language instruction are sent as the
model's `instructions`). In **stt+tts** the gateway still drives the LangGraph
stream and pipes token deltas into the manager for sentence-chunked TTS.

## 3. A voice session, step by step

```
Arena card ──"Voice"──► language picker ──► /session/:uid?voice=hi-IN
                                                   │
Client               Gateway (ws)                  │ auto voice_start
  │  {control voice_start, languageCode}           ▼
  │──────────────────────────────► resolve voice model (persona pin → primary)
  │                                validate language ∈ model.languages
  │                                voice = persona.voiceId → model.voices[0]
  │                                factory.createManager(...)  → manager.start()
  │ ◄────────────── {voice_started, languageCode, voiceId}
  │
  │  mic PCM16 16kHz binary frames (AudioWorklet)
  │──────────────────────────────► manager.pushAudio()
  │                                  s2s: resample 16k→24k, stream upstream
  │ ◄── {stt_partial}/{stt_final}   (live captions; user turn settled)
  │ ◄── {tts_meta} + WAV binary     (24kHz pcm16 batched ~500ms per frame)
  │      AudioPlayer queues + plays
  │
  │  ...user speaks over the agent...
  │ ◄── {tts_stop}                  (barge-in: playback killed instantly;
  │                                  upstream response auto-cancelled)
```

- **Transcripts persist as ChatMessages** exactly like text turns (user +
  assistant rows with latency), so the transcript UI, reconnect/replay, and
  **scoring pipeline are unchanged**.
- The `[CONVERSATION_ENDED]` sentinel in the model's output triggers the same
  end-of-session scoring as text chat.
- "End & score" (or the sentinel) destroys the voice manager server-side and
  stops client playback before scoring starts.
- Usage telemetry: s2s records `kind='voice'` with real audio-token counts from
  the provider; Sarvam records `kind='stt'` + `kind='tts'`.

## 4. Barge-in (interruption)

OpenAI: `turn_detection: { type: 'server_vad', interrupt_response: true }` —
when the user starts speaking mid-reply, OpenAI cancels generation upstream and
emits `input_audio_buffer.speech_started`; the manager drops its batched audio
and sends `tts_stop` so the client stops playback immediately. Gemini does the
same on its `interrupted` signal. The manual "Interrupt" button still sends
`{control cancel}` → `manager.cancel()`.

## 5. Voice previews

Persona builder shows a play button per voice. `GET /voice/preview?voiceId=&languageCode=`
resolves the voice model, then generates a short localized sample via the
provider's one-shot TTS (OpenAI `gpt-4o-mini-tts`, Gemini `2.5-flash-preview-tts`,
Sarvam Bulbul) and caches it in memory — first play costs one tiny TTS call,
repeats are instant.

## 6. Protocol crib sheet (client ⇄ gateway)

| Direction | Frame | Meaning |
|---|---|---|
| → | `{control, action: 'voice_start', languageCode, voiceId?}` | begin voice loop |
| → | binary PCM16 16kHz | mic audio |
| → | `{control, action: 'cancel'}` | manual barge-in |
| → | `{control, action: 'voice_stop'}` | leave voice mode |
| ← | `voice_started` / `voice_stopped` | loop state |
| ← | `stt_partial` / `stt_final` | captions / settled user turn |
| ← | `tts_meta` + binary WAV | assistant audio |
| ← | `tts_stop` | kill playback (barge-in / interruption) |
| ← | `token`, `message_done`, `session_ending`, `session_ended` | same as text chat |

## 7. Key files

| Area | File |
|---|---|
| Manager contract | `apps/api/src/core/voice/voice-manager.ts` |
| Factory (resolve + dispatch) | `apps/api/src/core/voice/voice-model-factory.service.ts` |
| OpenAI Realtime (GA) | `apps/api/src/core/voice/managers/openai-realtime.manager.ts` |
| Gemini Live | `apps/api/src/core/voice/managers/gemini-live.manager.ts` |
| Sarvam turn loop | `apps/api/src/core/voice/voice-turn.manager.ts` |
| Previews | `apps/api/src/core/voice/voice-preview.service.ts` |
| Gateway wiring | `apps/api/src/modules/realtime/chat.gateway.ts` (`startVoice`, `buildS2SCallbacks`) |
| Registry API | `apps/api/src/modules/llm-ops/` |
| Master seed / ad-hoc add | `apps/api/prisma/seed-llm.ts`, `apps/api/prisma/add-master-model.ts` |
| Client session hook | `apps/web/src/features/roleplay/use-roleplay-session.ts` |
| Voice UI (orb overlay) | `apps/web/src/routes/_auth/session/$uid.tsx` |
