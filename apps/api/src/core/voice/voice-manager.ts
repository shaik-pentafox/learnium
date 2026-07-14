/**
 * Common contract every voice session manager implements.
 *
 * Native speech-to-speech (OpenAI Realtime, Gemini Live): one upstream socket
 * does STT+LLM+TTS in-model. The manager OWNS the LLM turn; the app graph is
 * bypassed. Transcripts surface via {@link S2SCallbacks} so the gateway can
 * persist ChatMessages and keep scoring working.
 *
 * The gateway holds managers only as this interface — never concrete classes.
 */
export interface IVoiceManager {
  readonly pipeline: 's2s';
  /** Open upstream connection(s) and begin listening for user audio. */
  start(): Promise<void>;
  /** Feed one PCM16 mono 16kHz frame from the client mic. */
  pushAudio(buf: Buffer): void;
  /** Barge-in: abort in-flight generation/synthesis, return to listening. */
  cancel(): void;
  /** Tear down all upstream connections. Idempotent. */
  destroy(): Promise<void>;
}

/**
 * How an S2S manager talks back to the session. All side effects (WS frames,
 * DB persistence, telemetry, session end) live behind these callbacks so the
 * manager stays transport- and framework-agnostic.
 */
export interface S2SCallbacks {
  /** Send a JSON control frame to the client (stt_partial, tts_meta, ...). */
  sendJson(payload: unknown): void;
  /** Send a binary audio frame to the client. */
  sendBinary(buf: Buffer): void;
  /** Settled user utterance — persist as a user ChatMessage. */
  onUserTranscript(text: string): void;
  /** Completed assistant reply (sentinel already stripped) — persist + message_done. */
  onAssistantTranscript(text: string, latencyMs: number): void;
  /** The model emitted the end-of-conversation sentinel — trigger scoring. */
  onConversationEnded(): void;
  /** Provider-reported usage for one response. `inputAudioMs`/`outputAudioMs`
   *  are the measured audio durations — only used to cost per-minute-billed
   *  voice models; token-billed models ignore them. */
  onUsage(usage: {
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
    inputAudioMs?: number;
    outputAudioMs?: number;
  }): void;
  /** Fatal upstream error — surface to the client and stop the voice session. */
  onError(code: string, message: string): void;
}

/** Construction options shared by every S2S manager. */
export interface S2SManagerOptions {
  apiKey: string;
  /** Provider-side model id, e.g. 'gpt-4o-realtime-preview'. */
  modelId: string;
  /** Full system prompt (persona + language instruction). */
  instructions: string;
  /** BCP-47 the trainee chose — also baked into `instructions`. */
  languageCode: string;
  /** Provider voice id, e.g. 'alloy' or 'Puck'. */
  voiceId: string;
  callbacks: S2SCallbacks;
}
