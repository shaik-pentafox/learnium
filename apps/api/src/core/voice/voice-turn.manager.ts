import { Logger } from '@nestjs/common';
import type { VoiceProvider, SttStream } from './voice-provider';
import { SentenceChunker } from './sentence-chunker';

export interface VoiceTurnManagerOptions {
  provider: VoiceProvider;
  languageCode: string;
  voiceId: string;
  sendJson: (payload: unknown) => void;
  sendBinary: (buf: Buffer) => void;
  onFinalTranscript: (text: string) => Promise<void>;
  /** Non-blocking telemetry: chars transcribed + round-trip ms. */
  onSttUsage?: (chars: number, latencyMs: number) => void;
  /** Non-blocking telemetry: chars synthesized + round-trip ms. */
  onTtsUsage?: (chars: number, latencyMs: number) => void;
}

type State = 'idle' | 'listening' | 'thinking' | 'speaking';

/**
 * Per-connection voice state machine: idle → listening (STT) → thinking (LLM) → speaking (TTS) → idle.
 *
 * Instantiated by the gateway on `voice_start`; destroyed on `voice_stop` or disconnect.
 * Never holds a reference to the gateway — communicates via the callbacks in options.
 */
export class VoiceTurnManager {
  private readonly logger = new Logger(VoiceTurnManager.name);

  private state: State = 'idle';
  private sttStream: SttStream | null = null;
  private chunker = new SentenceChunker();
  private abortCtrl = new AbortController();
  private ttsQueue: Promise<void> = Promise.resolve();
  private ttsSeq = 0;
  private sttStartedAt = 0;

  constructor(private readonly opts: VoiceTurnManagerOptions) {}

  async startListening(): Promise<void> {
    if (this.state !== 'idle') return;
    this.state = 'listening';
    this.sttStartedAt = Date.now();
    try {
      this.sttStream = await this.opts.provider.openStt({
        languageCode: this.opts.languageCode,
        sampleRate: 16000,
      });
      this.sttStream.onPartial((r) => {
        this.opts.sendJson({ type: 'stt_partial', text: r.text });
      });
      this.sttStream.onFinal((r) => {
        this.opts.sendJson({ type: 'stt_final', text: r.text });
        void this.handleFinalTranscript(r.text);
      });
      this.sttStream.onError((err) => {
        this.logger.error({ err }, 'STT stream error');
        this.opts.sendJson({ type: 'error', code: 'STT_ERROR', message: err.message });
        this.sttStream = null;
        this.state = 'idle';
      });
    } catch (err) {
      this.logger.error({ err }, 'Failed to open STT stream');
      this.opts.sendJson({ type: 'error', code: 'STT_OPEN_FAILED', message: String(err) });
      this.state = 'idle';
    }
  }

  pushAudio(buf: Buffer): void {
    if (this.state === 'listening') this.sttStream?.push(buf);
  }

  async stopListening(): Promise<void> {
    if (this.sttStream) {
      await this.sttStream.close().catch((e) => this.logger.warn(`STT close: ${String(e)}`));
      this.sttStream = null;
    }
    if (this.state === 'listening') this.state = 'idle';
  }

  /** Abort current LLM+TTS work and reset to idle — barge-in hook. */
  cancel(): void {
    this.abortCtrl.abort();
    this.abortCtrl = new AbortController();
    this.ttsQueue = Promise.resolve();
    this.ttsSeq = 0;
    this.chunker = new SentenceChunker();
    void this.stopListening().then(() => {
      this.state = 'idle';
      void this.startListening();
    });
  }

  /** Called by the gateway for each emitted LLM token delta. */
  onTokenDelta(delta: string): void {
    for (const sentence of this.chunker.push(delta)) {
      this.enqueueTts(sentence);
    }
  }

  /** Called by the gateway once the LLM stream ends. Flushes remaining chunker buffer. */
  onStreamEnd(): void {
    for (const sentence of this.chunker.flush()) {
      this.enqueueTts(sentence);
    }
    // After all TTS drains restart listening for the next utterance.
    void this.ttsQueue.then(() => {
      if (this.state === 'speaking' || this.state === 'thinking') {
        this.state = 'idle';
        void this.startListening();
      }
    });
  }

  async destroy(): Promise<void> {
    this.abortCtrl.abort();
    await this.stopListening();
    await this.ttsQueue.catch(() => undefined);
  }

  private async handleFinalTranscript(text: string): Promise<void> {
    const latencyMs = Date.now() - this.sttStartedAt;
    this.opts.onSttUsage?.(text.length, latencyMs);
    await this.stopListening();
    this.state = 'thinking';
    try {
      await this.opts.onFinalTranscript(text);
    } catch (err) {
      this.logger.error({ err }, 'LLM turn failed during voice session');
      this.state = 'idle';
      void this.startListening();
    }
  }

  private enqueueTts(text: string): void {
    if (!text.trim()) return;
    const seq = this.ttsSeq++;
    const signal = this.abortCtrl.signal;
    this.state = 'speaking';
    this.ttsQueue = this.ttsQueue.then(async () => {
      if (signal.aborted) return;
      const t0 = Date.now();
      try {
        const audio = await this.opts.provider.synthesize({
          text,
          languageCode: this.opts.languageCode,
          voiceId: this.opts.voiceId,
        });
        if (signal.aborted) return;
        this.opts.onTtsUsage?.(text.length, Date.now() - t0);
        this.opts.sendJson({ type: 'tts_meta', seq, mime: audio.mime, sampleRate: audio.sampleRate });
        this.opts.sendBinary(audio.bytes);
      } catch (err) {
        this.logger.error({ err }, `TTS failed seq ${seq}: "${text.slice(0, 60)}"`);
      }
    });
  }
}
