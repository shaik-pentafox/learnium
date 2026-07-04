import { Logger } from '@nestjs/common';
import WebSocket from 'ws';
import type { IVoiceManager, S2SManagerOptions } from '../voice-manager';
import { pcm16WavHeader, resamplePcm16 } from './pcm-util';

const OPENAI_REALTIME_URL = 'wss://api.openai.com/v1/realtime';
/** OpenAI Realtime pcm16 is fixed at 24kHz mono little-endian. */
const OPENAI_SAMPLE_RATE = 24000;
/** Client mic worklet captures at 16kHz — upsampled before append. */
const CLIENT_SAMPLE_RATE = 16000;
/** Batch outbound audio to ~500ms per WAV frame so the client isn't decoding confetti. */
const AUDIO_FLUSH_BYTES = OPENAI_SAMPLE_RATE; // 24000 bytes = 0.5s of pcm16 mono

const END_SENTINEL = '[CONVERSATION_ENDED]';

/**
 * Native speech-to-speech via the OpenAI Realtime API (GA shape) over a raw
 * WebSocket. The beta API (`OpenAI-Beta: realtime=v1` + flat session fields)
 * was retired (`beta_api_shape_disabled`) — this speaks the GA protocol:
 * nested `session.audio.input/output`, `output_modalities`, and the
 * `response.output_audio*` event names (legacy names still handled defensively).
 *
 * One upstream socket handles VAD + STT + LLM + TTS in-model, cutting the
 * three-hop STT→LLM→TTS latency to a single round trip. The manager relays
 * client PCM16 up (16k→24k resample) and provider audio down (24kHz pcm16
 * wrapped in WAV frames the existing client AudioPlayer already decodes).
 *
 * Transcripts surface through {@link S2SManagerOptions.callbacks} so the
 * gateway persists ChatMessages and scoring keeps working unchanged.
 */
export class OpenAIRealtimeManager implements IVoiceManager {
  readonly pipeline = 's2s' as const;

  private readonly logger = new Logger(OpenAIRealtimeManager.name);
  private ws: WebSocket | null = null;
  private destroyed = false;

  /** Outbound (to client) audio batch buffer. */
  private audioChunks: Buffer[] = [];
  private audioBuffered = 0;
  private ttsSeq = 0;

  /** Assistant transcript accumulator for the in-flight response. */
  private assistantText = '';
  private responseStartedAt = 0;
  private ended = false;
  /** True while the model is generating/speaking — barge-in only matters then. */
  private responseActive = false;

  constructor(private readonly opts: S2SManagerOptions) {}

  async start(): Promise<void> {
    const url = `${OPENAI_REALTIME_URL}?model=${encodeURIComponent(this.opts.modelId)}`;
    // GA API: no OpenAI-Beta header — sending it triggers beta_api_shape_disabled.
    const ws = new WebSocket(url, {
      headers: { Authorization: `Bearer ${this.opts.apiKey}` },
    });
    this.ws = ws;

    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', (err) => reject(err));
    });

    ws.on('message', (raw: WebSocket.RawData) => this.handleEvent(raw));
    ws.on('error', (err) => {
      this.logger.error({ err }, 'OpenAI Realtime socket error');
      this.opts.callbacks.onError('VOICE_UPSTREAM_ERROR', 'Voice model connection failed');
    });
    ws.on('close', (code) => {
      if (!this.destroyed) {
        this.logger.warn(`OpenAI Realtime closed unexpectedly (${code})`);
        this.opts.callbacks.onError('VOICE_UPSTREAM_CLOSED', 'Voice model connection closed');
      }
    });

    // GA session shape (verified live against wss://api.openai.com/v1/realtime).
    // `transcription.language` (ISO-639-1) steers Whisper toward the session language.
    const lang2 = this.opts.languageCode.split('-')[0];
    this.send({
      type: 'session.update',
      session: {
        type: 'realtime',
        output_modalities: ['audio'],
        instructions: this.opts.instructions,
        audio: {
          input: {
            format: { type: 'audio/pcm', rate: OPENAI_SAMPLE_RATE },
            transcription: { model: 'whisper-1', ...(lang2 ? { language: lang2 } : {}) },
            // interrupt_response: user speech while the model talks cancels the
            // in-flight response upstream (barge-in); we mirror it client-side
            // by dropping buffered audio + sending tts_stop.
            turn_detection: {
              type: 'server_vad',
              silence_duration_ms: 500,
              interrupt_response: true,
              create_response: true,
            },
          },
          output: {
            format: { type: 'audio/pcm', rate: OPENAI_SAMPLE_RATE },
            voice: this.opts.voiceId,
          },
        },
      },
    });
  }

  pushAudio(buf: Buffer): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    const upsampled = resamplePcm16(buf, CLIENT_SAMPLE_RATE, OPENAI_SAMPLE_RATE);
    this.send({
      type: 'input_audio_buffer.append',
      audio: upsampled.toString('base64'),
    });
  }

  /** Barge-in: abort the in-flight response and clear any queued input audio. */
  cancel(): void {
    this.send({ type: 'response.cancel' });
    this.send({ type: 'input_audio_buffer.clear' });
    this.resetResponseState();
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
    try {
      this.ws?.close();
    } catch {
      // already closed
    }
    this.ws = null;
  }

  // ── Upstream event handling ──────────────────────────────────────────────────

  private handleEvent(raw: WebSocket.RawData): void {
    let evt: RealtimeEvent;
    try {
      evt = JSON.parse(raw.toString()) as RealtimeEvent;
    } catch {
      return;
    }

    switch (evt.type) {
      // User speech lifecycle → live captions. If the model is mid-reply this is
      // a barge-in: upstream auto-cancels (interrupt_response), we drop the
      // batched audio and tell the client to stop playback immediately.
      case 'input_audio_buffer.speech_started':
        if (this.responseActive) {
          this.audioChunks = [];
          this.audioBuffered = 0;
          this.opts.callbacks.sendJson({ type: 'tts_stop' });
        }
        this.opts.callbacks.sendJson({ type: 'stt_partial', text: '…' });
        break;

      // Settled user utterance (Whisper transcription of the input buffer).
      case 'conversation.item.input_audio_transcription.completed': {
        const text = (evt.transcript ?? '').trim();
        if (text) {
          this.opts.callbacks.sendJson({ type: 'stt_final', text });
          this.opts.callbacks.onUserTranscript(text);
        }
        this.responseStartedAt = Date.now();
        break;
      }

      // Assistant audio: batch deltas into ~500ms WAV frames for the client.
      // GA name is response.output_audio.delta; legacy name kept defensively.
      case 'response.output_audio.delta':
      case 'response.audio.delta': {
        if (!evt.delta) break;
        this.responseActive = true;
        const chunk = Buffer.from(evt.delta, 'base64');
        this.audioChunks.push(chunk);
        this.audioBuffered += chunk.length;
        if (this.audioBuffered >= AUDIO_FLUSH_BYTES) this.flushAudio();
        break;
      }
      case 'response.output_audio.done':
      case 'response.audio.done':
        this.flushAudio();
        break;

      // Assistant transcript: stream to captions + accumulate for persistence.
      case 'response.output_audio_transcript.delta':
      case 'response.audio_transcript.delta':
        if (evt.delta) this.assistantText += evt.delta;
        break;

      case 'response.done': {
        this.flushAudio();
        let text = this.assistantText.trim();
        if (text.includes(END_SENTINEL)) {
          this.ended = true;
          text = text.replace(END_SENTINEL, '').trim();
        }
        const latencyMs = this.responseStartedAt
          ? Date.now() - this.responseStartedAt
          : 0;
        if (text) this.opts.callbacks.onAssistantTranscript(text, latencyMs);

        const usage = evt.response?.usage;
        if (usage) {
          this.opts.callbacks.onUsage({
            inputTokens: usage.input_tokens ?? 0,
            outputTokens: usage.output_tokens ?? 0,
            latencyMs,
          });
        }
        this.resetResponseState();
        if (this.ended) this.opts.callbacks.onConversationEnded();
        break;
      }

      case 'error': {
        const message = evt.error?.message ?? 'Voice model error';
        this.logger.error(`OpenAI Realtime error: ${message}`);
        this.opts.callbacks.onError('VOICE_UPSTREAM_ERROR', message);
        break;
      }

      default:
        break; // session.created / rate_limits / etc. — no action
    }
  }

  /** Wrap the batched 24kHz pcm16 in a WAV header and ship it to the client. */
  private flushAudio(): void {
    if (this.audioBuffered === 0) return;
    const pcm = Buffer.concat(this.audioChunks);
    this.audioChunks = [];
    this.audioBuffered = 0;
    const wav = Buffer.concat([pcm16WavHeader(pcm.length, OPENAI_SAMPLE_RATE), pcm]);
    this.opts.callbacks.sendJson({
      type: 'tts_meta',
      seq: this.ttsSeq++,
      mime: 'audio/wav',
      sampleRate: OPENAI_SAMPLE_RATE,
    });
    this.opts.callbacks.sendBinary(wav);
  }

  private resetResponseState(): void {
    this.assistantText = '';
    this.audioChunks = [];
    this.audioBuffered = 0;
    this.responseStartedAt = 0;
    this.responseActive = false;
  }

  private send(payload: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }
}

interface RealtimeEvent {
  type?: string;
  delta?: string;
  transcript?: string;
  response?: {
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  error?: { message?: string };
}
