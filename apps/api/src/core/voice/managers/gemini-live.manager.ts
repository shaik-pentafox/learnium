import { Logger } from '@nestjs/common';
import { GoogleGenAI, Modality } from '@google/genai';
import type { IVoiceManager, S2SManagerOptions } from '../voice-manager';
import { pcm16WavHeader } from './pcm-util';

/** Gemini Live emits PCM16 mono at 24kHz; accepts client PCM16 at any declared rate. */
const GEMINI_OUTPUT_RATE = 24000;
const CLIENT_SAMPLE_RATE = 16000;
/** Batch outbound audio to ~500ms per WAV frame. */
const AUDIO_FLUSH_BYTES = GEMINI_OUTPUT_RATE; // 24000 bytes = 0.5s pcm16 mono

const END_SENTINEL = '[CONVERSATION_ENDED]';

/** Minimal structural view of the SDK live session (avoids version-tight types). */
interface LiveSession {
  sendRealtimeInput(input: { audio: { data: string; mimeType: string } }): void;
  close(): void;
}

/** The subset of LiveServerMessage fields this manager consumes. */
interface LiveMessage {
  serverContent?: {
    modelTurn?: { parts?: { inlineData?: { data?: string } }[] };
    inputTranscription?: { text?: string };
    outputTranscription?: { text?: string };
    turnComplete?: boolean;
    interrupted?: boolean;
  };
  usageMetadata?: { promptTokenCount?: number; responseTokenCount?: number };
}

/**
 * Native speech-to-speech via the Gemini Live API (`@google/genai`).
 *
 * Mirrors {@link OpenAIRealtimeManager}: one upstream session does VAD + STT +
 * LLM + TTS; client mic PCM16/16kHz goes up as realtime input, 24kHz output
 * audio comes down batched into WAV frames the client AudioPlayer decodes.
 * Transcripts route through the S2S callbacks for persistence + scoring.
 */
export class GeminiLiveManager implements IVoiceManager {
  readonly pipeline = 's2s' as const;

  private readonly logger = new Logger(GeminiLiveManager.name);
  private session: LiveSession | null = null;
  private destroyed = false;

  private audioChunks: Buffer[] = [];
  private audioBuffered = 0;
  private ttsSeq = 0;

  private userText = '';
  private assistantText = '';
  private responseStartedAt = 0;
  /** Barge-in flag: drop model audio until the interrupted turn completes. */
  private cancelling = false;

  constructor(private readonly opts: S2SManagerOptions) {}

  async start(): Promise<void> {
    const ai = new GoogleGenAI({ apiKey: this.opts.apiKey });
    const session = await ai.live.connect({
      model: this.opts.modelId,
      config: {
        responseModalities: [Modality.AUDIO],
        systemInstruction: this.opts.instructions,
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: this.opts.voiceId } },
          languageCode: this.opts.languageCode,
        },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
      },
      callbacks: {
        onmessage: (msg) => this.handleMessage(msg as LiveMessage),
        onerror: (e) => {
          this.logger.error({ err: e }, 'Gemini Live error');
          this.opts.callbacks.onError('VOICE_UPSTREAM_ERROR', 'Voice model connection failed');
        },
        onclose: () => {
          if (!this.destroyed) {
            this.logger.warn('Gemini Live closed unexpectedly');
            this.opts.callbacks.onError('VOICE_UPSTREAM_CLOSED', 'Voice model connection closed');
          }
        },
      },
    });
    this.session = session as unknown as LiveSession;
  }

  pushAudio(buf: Buffer): void {
    this.session?.sendRealtimeInput({
      audio: {
        data: buf.toString('base64'),
        mimeType: `audio/pcm;rate=${CLIENT_SAMPLE_RATE}`,
      },
    });
  }

  /** Barge-in. Gemini Live has no explicit cancel — drop audio until turn end;
   *  its own VAD also interrupts generation once the user speaks again. */
  cancel(): void {
    this.cancelling = true;
    this.audioChunks = [];
    this.audioBuffered = 0;
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
    try {
      this.session?.close();
    } catch {
      // already closed
    }
    this.session = null;
  }

  // ── Upstream message handling ────────────────────────────────────────────────

  private handleMessage(msg: LiveMessage): void {
    const sc = msg.serverContent;
    if (!sc) return;

    // Gemini's own VAD interrupted the model (user barged in) — drop the rest
    // and stop whatever the client has buffered.
    if (sc.interrupted) {
      this.cancelling = true;
      this.audioChunks = [];
      this.audioBuffered = 0;
      this.opts.callbacks.sendJson({ type: 'tts_stop' });
    }

    // User transcript arrives incrementally; accumulate until the model turn starts.
    const inText = sc.inputTranscription?.text;
    if (inText) {
      this.userText += inText;
      this.opts.callbacks.sendJson({ type: 'stt_partial', text: this.userText });
      if (!this.responseStartedAt) this.responseStartedAt = Date.now();
    }

    const outText = sc.outputTranscription?.text;
    if (outText) {
      // First assistant output = the user's utterance is settled.
      if (this.userText && this.assistantText === '') this.settleUserTranscript();
      this.assistantText += outText;
    }

    const parts = sc.modelTurn?.parts ?? [];
    for (const part of parts) {
      const b64 = part.inlineData?.data;
      if (!b64 || this.cancelling) continue;
      if (this.userText && this.assistantText === '' && parts.length > 0) {
        // Audio can precede transcription — settle the user turn either way.
        this.settleUserTranscript();
      }
      const chunk = Buffer.from(b64, 'base64');
      this.audioChunks.push(chunk);
      this.audioBuffered += chunk.length;
      if (this.audioBuffered >= AUDIO_FLUSH_BYTES) this.flushAudio();
    }

    if (sc.turnComplete) {
      this.flushAudio();
      let text = this.assistantText.trim();
      let ended = false;
      if (text.includes(END_SENTINEL)) {
        ended = true;
        text = text.replace(END_SENTINEL, '').trim();
      }
      const latencyMs = this.responseStartedAt ? Date.now() - this.responseStartedAt : 0;
      if (text && !this.cancelling) {
        this.opts.callbacks.onAssistantTranscript(text, latencyMs);
      }
      const usage = msg.usageMetadata;
      if (usage) {
        this.opts.callbacks.onUsage({
          inputTokens: usage.promptTokenCount ?? 0,
          outputTokens: usage.responseTokenCount ?? 0,
          latencyMs,
        });
      }
      this.userText = '';
      this.assistantText = '';
      this.responseStartedAt = 0;
      this.cancelling = false;
      if (ended) this.opts.callbacks.onConversationEnded();
    }
  }

  private settleUserTranscript(): void {
    const text = this.userText.trim();
    if (!text) return;
    this.opts.callbacks.sendJson({ type: 'stt_final', text });
    this.opts.callbacks.onUserTranscript(text);
  }

  private flushAudio(): void {
    if (this.audioBuffered === 0) return;
    const pcm = Buffer.concat(this.audioChunks);
    this.audioChunks = [];
    this.audioBuffered = 0;
    const wav = Buffer.concat([pcm16WavHeader(pcm.length, GEMINI_OUTPUT_RATE), pcm]);
    this.opts.callbacks.sendJson({
      type: 'tts_meta',
      seq: this.ttsSeq++,
      mime: 'audio/wav',
      sampleRate: GEMINI_OUTPUT_RATE,
    });
    this.opts.callbacks.sendBinary(wav);
  }
}
