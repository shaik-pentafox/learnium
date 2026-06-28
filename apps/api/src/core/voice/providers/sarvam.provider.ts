import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import WebSocket from 'ws';
import type { Env } from '../../config/env.schema';
import type {
  SttOptions,
  SttResult,
  SttStream,
  TtsOptions,
  TtsAudio,
  VoiceDescriptor,
  VoiceProvider,
} from '../voice-provider';

/** bulbul:v3 + supported TTS languages, per Sarvam docs (build-time catalog). */
const SARVAM_LANGUAGES = [
  'bn-IN', 'en-IN', 'gu-IN', 'hi-IN', 'kn-IN', 'ml-IN',
  'mr-IN', 'od-IN', 'pa-IN', 'ta-IN', 'te-IN',
];

const SARVAM_VOICES: VoiceDescriptor[] = [
  { voiceId: 'shubh', name: 'Shubh', languages: [] },
  { voiceId: 'priya', name: 'Priya', languages: [] },
  { voiceId: 'neha', name: 'Neha', languages: [] },
  { voiceId: 'rahul', name: 'Rahul', languages: [] },
  { voiceId: 'pooja', name: 'Pooja', languages: [] },
  { voiceId: 'rohan', name: 'Rohan', languages: [] },
  { voiceId: 'kavya', name: 'Kavya', languages: [] },
  { voiceId: 'amit', name: 'Amit', languages: [] },
];

/**
 * Sarvam adapter for the {@link VoiceProvider} port — the SOLE owner of Sarvam's
 * wire formats, endpoints, and credentials. STT uses the Saarika streaming
 * WebSocket (built-in VAD endpointing); TTS uses the Bulbul REST endpoint.
 *
 * Header: `api-subscription-key`. Base: https://api.sarvam.ai.
 *
 * NOTE: the streaming-STT frame shapes below follow the public docs; the exact
 * handshake (query params vs first config message) may need tuning against a live
 * key. By design that tuning is contained to THIS file.
 */
@Injectable()
export class SarvamVoiceProvider implements VoiceProvider {
  readonly id = 'sarvam';
  private readonly logger = new Logger(SarvamVoiceProvider.name);

  constructor(private readonly config: ConfigService<Env, true>) {}

  private apiKey(): string {
    const key = this.config.get('SARVAM_API_KEY', { infer: true });
    if (!key) {
      throw new Error('SARVAM_API_KEY is not configured — voice is unavailable');
    }
    return key;
  }

  async openStt(opts: SttOptions): Promise<SttStream> {
    const sampleRate = opts.sampleRate ?? 16000;
    const base = this.config.get('SARVAM_STT_WS_URL', { infer: true });
    const model = this.config.get('SARVAM_STT_MODEL', { infer: true });
    // Per Sarvam STT-WS docs: query param is `language-code` (hyphen), config is in
    // the query string, and the audio codec is declared once here.
    const url =
      `${base}?model=${encodeURIComponent(model)}` +
      `&language-code=${encodeURIComponent(opts.languageCode)}` +
      `&input_audio_codec=pcm_s16le&sample_rate=${sampleRate}&vad_signals=true`;

    const ws = new WebSocket(url, {
      headers: { 'Api-Subscription-Key': this.apiKey() },
    });

    return new SarvamSttStream(ws, sampleRate, this.logger);
  }

  async synthesize(opts: TtsOptions): Promise<TtsAudio> {
    const base = this.config.get('SARVAM_BASE_URL', { infer: true });
    const model = this.config.get('SARVAM_TTS_MODEL', { infer: true });
    const sampleRate = opts.sampleRate ?? 24000;

    const res = await fetch(`${base}/text-to-speech`, {
      method: 'POST',
      headers: {
        'api-subscription-key': this.apiKey(),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        text: opts.text,
        target_language_code: opts.languageCode,
        speaker: opts.voiceId,
        model,
        speech_sample_rate: sampleRate,
        output_audio_codec: 'wav',
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Sarvam TTS failed (${res.status}): ${detail.slice(0, 200)}`);
    }

    const json = (await res.json()) as { audios?: string[] };
    const b64 = json.audios?.[0];
    if (!b64) throw new Error('Sarvam TTS returned no audio');

    return {
      bytes: Buffer.from(b64, 'base64'),
      mime: 'audio/wav',
      sampleRate,
    };
  }

  listVoices(): VoiceDescriptor[] {
    return SARVAM_VOICES;
  }

  supportedLanguages(): string[] {
    return SARVAM_LANGUAGES;
  }
}

/**
 * Wraps a Sarvam streaming-STT WebSocket as a neutral {@link SttStream}.
 * Translates Sarvam frames → {@link SttResult}: `data` messages carry transcript
 * text; an `END_SPEECH` VAD event marks the utterance final (endpoint).
 */
class SarvamSttStream implements SttStream {
  private partialCb: (r: SttResult) => void = () => {};
  private finalCb: (r: SttResult) => void = () => {};
  private errorCb: (e: Error) => void = () => {};
  private latest = '';
  private ready: Promise<void>;

  constructor(
    private readonly ws: WebSocket,
    private readonly sampleRate: number,
    private readonly logger: Logger,
  ) {
    this.ready = new Promise((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
    ws.on('message', (raw: WebSocket.RawData) => this.handleMessage(raw));
    ws.on('error', (err) => this.errorCb(err instanceof Error ? err : new Error(String(err))));
  }

  private handleMessage(raw: WebSocket.RawData): void {
    let msg: SarvamSttMessage;
    try {
      msg = JSON.parse(raw.toString()) as SarvamSttMessage;
    } catch {
      return; // ignore non-JSON keepalive frames
    }

    if (msg.type === 'error') {
      this.errorCb(new Error(msg.data?.message ?? msg.data?.error ?? 'Sarvam STT error'));
      return;
    }

    // VAD markers. Verified order: START_SPEECH → END_SPEECH → data{transcript}.
    // We surface END_SPEECH as a partial "user stopped" hint; the settled transcript
    // arrives in the following `data` message (below) and drives the LLM turn.
    if (msg.type === 'events') {
      if (msg.data?.signal_type === 'END_SPEECH' && this.latest) {
        this.partialCb({ text: this.latest, isFinal: false });
      }
      return;
    }

    // type === 'data' = the settled utterance for saarika:v2.5 (one per turn) → final.
    const text = msg.data?.transcript;
    if (typeof text === 'string' && text.length > 0) {
      this.latest = text;
      this.finalCb({ text, isFinal: true });
    }
  }

  push(pcmChunk: Buffer): void {
    if (this.ws.readyState !== WebSocket.OPEN) return;
    // Verified live: nested `audio` object, base64 `data`, `sample_rate` as a string,
    // and `encoding` MUST be the literal 'audio/wav' enum (the real codec is declared
    // once via the `input_audio_codec=pcm_s16le` query param). Sample rate must be 16k/8k.
    this.ws.send(
      JSON.stringify({
        audio: {
          data: pcmChunk.toString('base64'),
          sample_rate: String(this.sampleRate),
          encoding: 'audio/wav',
        },
      }),
    );
  }

  onPartial(cb: (r: SttResult) => void): void {
    this.partialCb = cb;
  }
  onFinal(cb: (r: SttResult) => void): void {
    this.finalCb = cb;
  }
  onError(cb: (e: Error) => void): void {
    this.errorCb = cb;
  }

  async close(): Promise<void> {
    try {
      await this.ready.catch(() => undefined);
      this.ws.close();
    } catch (err) {
      this.logger.warn(`STT close error: ${String(err)}`);
    }
  }
}

interface SarvamSttMessage {
  type?: 'data' | 'events' | 'error';
  data?: {
    transcript?: string;
    language_code?: string;
    signal_type?: 'START_SPEECH' | 'END_SPEECH';
    message?: string;
    error?: string;
    code?: string;
  };
}
