import { Logger } from '@nestjs/common';
import WebSocket from 'ws';
import type { IVoiceManager, S2SManagerOptions } from '../voice-manager';
import { pcm16WavHeader, resamplePcm16 } from './pcm-util';

const OPENAI_REALTIME_URL = 'wss://api.openai.com/v1/realtime';
/** OpenAI Realtime pcm16 is fixed at 24kHz mono little-endian. */
const OPENAI_SAMPLE_RATE = 24000;
/** Client mic worklet captures at 16kHz — upsampled before append. */
const CLIENT_SAMPLE_RATE = 16000;
/** Batch outbound audio to ~250ms per WAV frame — small enough for a fast
 *  first-audio start, big enough that the client isn't decoding confetti. */
const AUDIO_FLUSH_BYTES = OPENAI_SAMPLE_RATE / 2; // 12000 bytes = 0.25s pcm16 mono

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
  /** Drop audio deltas between a barge-in and the NEXT response.created —
   *  leftover in-flight deltas of the cancelled response would otherwise
   *  interleave with the new reply's audio (doubled/garbled voice). */
  private dropAudio = false;
  /** Conversation item of the in-flight assistant reply + audio ms shipped —
   *  needed for conversation.item.truncate on barge-in. Without truncation the
   *  model's context contains audio the user never heard, which is a known
   *  cause of progressive voice degradation (deeper/slower each turn). */
  private currentItemId: string | null = null;
  private sentAudioBytes = 0;
  /** Normalized word sets of the last assistant replies — used to reject
   *  transcripts that are mostly the agent's own voice echoed into the mic
   *  (the "model answers itself as the agent" failure on barge-in). */
  private recentAssistantWords: Set<string>[] = [];
  /** response.create serialization: OpenAI rejects a create while another
   *  response is in progress ("Conversation already has an active response").
   *  Transcriptions land asynchronously, so a second user turn can complete
   *  mid-response — queue it and fire after response.done. */
  private responseInFlight = false;
  private pendingCreate = false;

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
            // Suppress ambient noise before it reaches the VAD — background
            // sound was tripping speech detection and cancelling the agent
            // mid-sentence even on headphones.
            noise_reduction: { type: 'near_field' },
            transcription: { model: 'whisper-1', ...(lang2 ? { language: lang2 } : {}) },
            // interrupt_response: user speech while the model talks cancels the
            // in-flight response upstream (barge-in); we mirror it client-side
            // by dropping buffered audio + sending tts_stop.
            // Client playback is raw WebAudio (media-element AEC route caused
            // time-stretched audio), so speaker echo can reach the mic — the
            // threshold sits high enough that only a real close-mic voice
            // triggers, with 250ms of sustained audio required.
            // create_response: FALSE — auto-response lets the model reply to
            // any VAD-committed audio (breath, noise, echo tail), which is how
            // it "takes the user's turn" and drifts into the agent role. We
            // fire response.create ourselves only after Whisper returns real
            // transcript text for the user's utterance.
            turn_detection: {
              type: 'server_vad',
              threshold: 0.8,
              prefix_padding_ms: 250,
              silence_duration_ms: 500,
              interrupt_response: true,
              create_response: false,
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
      // User speech → barge-in. ALWAYS stop client playback, not just while a
      // response is "active": generation finishes faster than realtime, so the
      // upstream response is usually done while the client still has seconds
      // of queued audio — gating on responseActive leaves that queue playing
      // (agent finishes its old answer before addressing the interruption).
      case 'input_audio_buffer.speech_started':
        this.audioChunks = [];
        this.audioBuffered = 0;
        this.dropAudio = true; // stale deltas of the cancelled response
        // Align the model's memory with reality: it only "said" as much audio
        // as we actually shipped. 24kHz pcm16 mono = 48 bytes per ms.
        if (this.currentItemId && this.sentAudioBytes > 0) {
          this.send({
            type: 'conversation.item.truncate',
            item_id: this.currentItemId,
            content_index: 0,
            audio_end_ms: Math.floor(this.sentAudioBytes / 48),
          });
          this.currentItemId = null;
        }
        this.opts.callbacks.sendJson({ type: 'tts_stop' });
        this.opts.callbacks.sendJson({ type: 'stt_partial', text: '…' });
        break;

      // A fresh response begins — stop dropping, start clean.
      case 'response.created':
        this.responseInFlight = true;
        this.dropAudio = false;
        this.audioChunks = [];
        this.audioBuffered = 0;
        this.assistantText = '';
        this.currentItemId = null;
        this.sentAudioBytes = 0;
        break;

      // Settled user utterance (Whisper transcription of the input buffer).
      // Response creation is gated HERE: only a real transcript triggers a
      // reply (create_response is off), so noise/echo commits can never make
      // the model speak unprompted or take the user's turn.
      case 'conversation.item.input_audio_transcription.completed': {
        const text = (evt.transcript ?? '').trim();
        if (text.length >= 2 && !this.isLikelyEcho(text)) {
          this.opts.callbacks.sendJson({ type: 'stt_final', text });
          this.opts.callbacks.onUserTranscript(text);
          this.responseStartedAt = Date.now();
          this.requestResponse();
        } else {
          // Noise, empty, or the agent's own echoed voice — delete the junk
          // item from the conversation so the model never sees it, and keep
          // listening without responding.
          if (evt.item_id) {
            this.send({ type: 'conversation.item.delete', item_id: evt.item_id });
          }
          this.opts.callbacks.sendJson({ type: 'stt_partial', text: '' });
        }
        break;
      }

      // Assistant audio: batch deltas into ~500ms WAV frames for the client.
      // GA name is response.output_audio.delta; legacy name kept defensively.
      case 'response.output_audio.delta':
      case 'response.audio.delta': {
        if (!evt.delta || this.dropAudio) break;
        this.responseActive = true;
        if (evt.item_id) this.currentItemId = evt.item_id;
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
        this.responseInFlight = false;
        this.flushAudio();
        let text = this.assistantText.trim();
        if (text.includes(END_SENTINEL)) {
          this.ended = true;
          text = text.replace(END_SENTINEL, '').trim();
        }
        const latencyMs = this.responseStartedAt
          ? Date.now() - this.responseStartedAt
          : 0;
        if (text) {
          this.opts.callbacks.onAssistantTranscript(text, latencyMs);
          this.rememberAssistantWords(text);
        }

        const usage = evt.response?.usage;
        if (usage) {
          this.opts.callbacks.onUsage({
            inputTokens: usage.input_tokens ?? 0,
            outputTokens: usage.output_tokens ?? 0,
            latencyMs,
          });
        }
        this.resetResponseState();
        if (this.ended) {
          this.opts.callbacks.onConversationEnded();
        } else if (this.pendingCreate) {
          // A user turn settled while this response was in flight — serve it now.
          this.pendingCreate = false;
          this.requestResponse();
        }
        break;
      }

      // Protocol errors (double-create, cancel-with-nothing-active, ...) are
      // recoverable — log and keep the session alive. Only socket-level
      // failures (ws error/close handlers) tear the session down.
      case 'error': {
        const message = evt.error?.message ?? 'Voice model error';
        this.logger.warn(`OpenAI Realtime protocol error (non-fatal): ${message}`);
        break;
      }

      default:
        break; // session.created / rate_limits / etc. — no action
    }
  }

  /** Serialized response.create — never fires while another response runs. */
  private requestResponse(): void {
    if (this.responseInFlight) {
      // Cancel the running response (user has moved on) and queue the new one;
      // it fires from the response.done handler.
      this.send({ type: 'response.cancel' });
      this.pendingCreate = true;
      return;
    }
    this.responseInFlight = true;
    this.send({ type: 'response.create' });
  }

  /** Normalize to lowercase word tokens (strips punctuation, keeps Unicode letters). */
  private static words(text: string): string[] {
    return text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length > 1);
  }

  private rememberAssistantWords(text: string): void {
    this.recentAssistantWords.push(new Set(OpenAIRealtimeManager.words(text)));
    if (this.recentAssistantWords.length > 2) this.recentAssistantWords.shift();
  }

  /** True when a "user" transcript is mostly the agent's own recent words —
   *  i.e. speaker echo captured by the mic during/around a barge-in. */
  private isLikelyEcho(transcript: string): boolean {
    const tokens = OpenAIRealtimeManager.words(transcript);
    if (tokens.length === 0) return true;
    for (const assistantWords of this.recentAssistantWords) {
      if (assistantWords.size === 0) continue;
      const overlap = tokens.filter((t) => assistantWords.has(t)).length;
      // Short fragments echo cleanly; require a stricter match for long ones.
      const ratio = overlap / tokens.length;
      if (ratio >= 0.7) return true;
    }
    return false;
  }

  /** Wrap the batched 24kHz pcm16 in a WAV header and ship it to the client. */
  private flushAudio(): void {
    if (this.audioBuffered === 0) return;
    const pcm = Buffer.concat(this.audioChunks);
    this.audioChunks = [];
    this.audioBuffered = 0;
    this.sentAudioBytes += pcm.length;
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
  item_id?: string;
  transcript?: string;
  response?: {
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  error?: { message?: string };
}
