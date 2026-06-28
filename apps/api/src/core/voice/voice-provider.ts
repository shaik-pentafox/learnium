/**
 * Provider-agnostic voice port.
 *
 * The ONLY voice contract the rest of the app depends on. Concrete providers
 * (Sarvam today) implement this behind the {@link VOICE_PROVIDER} DI token, so
 * their wire formats, SDKs, and credentials never leak past the adapter. Swapping
 * providers = write a new adapter + rebind the token; no other code changes.
 */

/** DI token for the active {@link VoiceProvider} implementation. */
export const VOICE_PROVIDER = Symbol('VOICE_PROVIDER');

/** A single STT result frame (partial as the user speaks, final at endpoint). */
export interface SttResult {
  /** Transcript text so far (partial) or the settled utterance (final). */
  text: string;
  /** True when the provider's VAD has endpointed — the turn is ready for the LLM. */
  isFinal: boolean;
}

/** Provider-neutral handle on an open streaming-STT session. */
export interface SttStream {
  /** Feed a chunk of raw PCM16 mono audio. */
  push(pcmChunk: Buffer): void;
  /** Partial transcripts as the user speaks. */
  onPartial(cb: (r: SttResult) => void): void;
  /** Settled utterance after VAD endpoint — drives the next LLM turn. */
  onFinal(cb: (r: SttResult) => void): void;
  /** Provider/transport error. */
  onError(cb: (err: Error) => void): void;
  /** Close the upstream connection. */
  close(): Promise<void>;
}

export interface SttOptions {
  /** BCP-47 code, e.g. 'hi-IN'. */
  languageCode: string;
  /** PCM sample rate of the audio being pushed. Defaults to 16000. */
  sampleRate?: number;
}

export interface TtsOptions {
  /** One chunk of text to synthesize (typically a single sentence). */
  text: string;
  /** BCP-47 code, e.g. 'hi-IN'. */
  languageCode: string;
  /** Provider voice id / speaker name. */
  voiceId: string;
  /** Desired PCM sample rate of the returned audio. Defaults to provider default. */
  sampleRate?: number;
}

/** Synthesized audio in a neutral, decode-ready shape. */
export interface TtsAudio {
  bytes: Buffer;
  /** MIME of the bytes, e.g. 'audio/wav' or 'audio/L16'. */
  mime: string;
  sampleRate: number;
}

/** A selectable voice for the persona builder picker. */
export interface VoiceDescriptor {
  voiceId: string;
  name: string;
  /** Languages this voice supports (BCP-47). Empty = provider-wide. */
  languages: string[];
}

/**
 * The voice port. Implemented once per provider; injected everywhere as this type.
 */
export interface VoiceProvider {
  /** Stable provider id, e.g. 'sarvam'. Recorded with usage telemetry. */
  readonly id: string;
  /** Open a streaming STT session with built-in VAD endpointing. */
  openStt(opts: SttOptions): Promise<SttStream>;
  /** Synthesize one chunk of text to audio. */
  synthesize(opts: TtsOptions): Promise<TtsAudio>;
  /** Voices available for selection in the persona builder. */
  listVoices(): VoiceDescriptor[];
  /** Supported transcription/synthesis languages (BCP-47). */
  supportedLanguages(): string[];
}
