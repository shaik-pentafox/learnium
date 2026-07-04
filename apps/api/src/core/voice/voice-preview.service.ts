import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { GoogleGenAI } from '@google/genai';
import { DomainException } from '../errors/domain.errors';
import { ErrorCode } from '@traineon/contracts';
import { SarvamVoiceProvider } from './providers/sarvam.provider';
import { pcm16WavHeader } from './managers/pcm-util';
import type { ResolvedVoiceModel } from './voice-model-factory.service';

export interface PreviewAudio {
  bytes: Buffer;
  mime: string;
}

/** Short localized sample line per BCP-47 code; en-IN is the fallback. */
const SAMPLE_TEXT: Record<string, string> = {
  'en-IN': 'Hello! This is how I will sound during your practice session.',
  'hi-IN': 'नमस्ते! आपके अभ्यास सत्र में मेरी आवाज़ ऐसी सुनाई देगी।',
  'bn-IN': 'নমস্কার! আপনার অনুশীলনে আমার কণ্ঠস্বর এমন শোনাবে।',
  'ta-IN': 'வணக்கம்! உங்கள் பயிற்சியில் என் குரல் இப்படித்தான் ஒலிக்கும்.',
  'te-IN': 'నమస్తే! మీ ప్రాక్టీస్ సెషన్‌లో నా వాయిస్ ఇలా వినిపిస్తుంది.',
  'mr-IN': 'नमस्कार! तुमच्या सराव सत्रात माझा आवाज असा ऐकू येईल.',
  'gu-IN': 'નમસ્તે! તમારા અભ્યાસ સત્રમાં મારો અવાજ આવો સંભળાશે.',
  'kn-IN': 'ನಮಸ್ಕಾರ! ನಿಮ್ಮ ಅಭ್ಯಾಸದಲ್ಲಿ ನನ್ನ ಧ್ವನಿ ಹೀಗೆ ಕೇಳಿಸುತ್ತದೆ.',
  'ml-IN': 'നമസ്കാരം! നിങ്ങളുടെ പരിശീലനത്തിൽ എന്റെ ശബ്ദം ഇങ്ങനെയാകും.',
  'pa-IN': 'ਸਤ ਸ੍ਰੀ ਅਕਾਲ! ਤੁਹਾਡੇ ਅਭਿਆਸ ਵਿੱਚ ਮੇਰੀ ਆਵਾਜ਼ ਇਸ ਤਰ੍ਹਾਂ ਸੁਣਾਈ ਦੇਵੇਗੀ।',
  'od-IN': 'ନମସ୍କାର! ଆପଣଙ୍କ ଅଭ୍ୟାସରେ ମୋର ସ୍ୱର ଏମିତି ଶୁଣାଯିବ।',
};

/**
 * Generates short "hear this voice" samples for the persona builder, via each
 * provider's plain TTS API (cheap one-shot calls — no realtime session).
 * Results are cached in-memory per (adapter, voice, language); samples are
 * static content, so the cache never needs invalidation.
 */
@Injectable()
export class VoicePreviewService {
  private readonly logger = new Logger(VoicePreviewService.name);
  private readonly cache = new Map<string, PreviewAudio>();

  constructor(private readonly sarvam: SarvamVoiceProvider) {}

  async preview(
    resolved: ResolvedVoiceModel,
    voiceId: string,
    languageCode: string,
  ): Promise<PreviewAudio> {
    if (resolved.voices.length > 0 && !resolved.voices.includes(voiceId)) {
      throw new DomainException(
        ErrorCode.VALIDATION_ERROR,
        `Voice '${voiceId}' is not in this model's catalog`,
        HttpStatus.BAD_REQUEST,
      );
    }
    const lang = SAMPLE_TEXT[languageCode] ? languageCode : 'en-IN';
    const key = `${resolved.adapterType}:${voiceId}:${lang}`;
    const hit = this.cache.get(key);
    if (hit) return hit;

    const text = SAMPLE_TEXT[lang]!;
    let audio: PreviewAudio;
    switch (resolved.adapterType) {
      case 'openai':
        audio = await this.openaiTts(resolved, voiceId, text);
        break;
      case 'gemini':
        audio = await this.geminiTts(resolved, voiceId, text);
        break;
      case 'sarvam': {
        if (resolved.apiKey) this.sarvam.setApiKey(resolved.apiKey);
        const out = await this.sarvam.synthesize({ text, languageCode: lang, voiceId });
        audio = { bytes: out.bytes, mime: out.mime };
        break;
      }
      default:
        throw new DomainException(
          ErrorCode.PROVIDER_UNAVAILABLE,
          `No preview support for provider '${resolved.adapterType}'`,
          HttpStatus.SERVICE_UNAVAILABLE,
        );
    }
    this.cache.set(key, audio);
    return audio;
  }

  /** One-shot OpenAI TTS. gpt-4o-mini-tts covers the realtime voice set
   *  (except marin/cedar, which 400 — surfaced as "preview unavailable"). */
  private async openaiTts(
    resolved: ResolvedVoiceModel,
    voiceId: string,
    text: string,
  ): Promise<PreviewAudio> {
    const res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resolved.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini-tts',
        voice: voiceId,
        input: text,
        response_format: 'mp3',
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      this.logger.warn(`OpenAI TTS preview failed (${res.status}): ${detail.slice(0, 200)}`);
      throw new DomainException(
        ErrorCode.PROVIDER_UNAVAILABLE,
        `Preview unavailable for voice '${voiceId}'`,
        HttpStatus.BAD_GATEWAY,
      );
    }
    return { bytes: Buffer.from(await res.arrayBuffer()), mime: 'audio/mpeg' };
  }

  /** One-shot Gemini TTS (returns 24kHz pcm16 — wrapped in WAV for the browser). */
  private async geminiTts(
    resolved: ResolvedVoiceModel,
    voiceId: string,
    text: string,
  ): Promise<PreviewAudio> {
    try {
      const ai = new GoogleGenAI({ apiKey: resolved.apiKey ?? '' });
      const res = await ai.models.generateContent({
        model: 'gemini-2.5-flash-preview-tts',
        contents: [{ parts: [{ text }] }],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceId } } },
        },
      });
      const b64 =
        res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData?.data;
      if (!b64) throw new Error('no audio in response');
      const pcm = Buffer.from(b64, 'base64');
      return {
        bytes: Buffer.concat([pcm16WavHeader(pcm.length, 24000), pcm]),
        mime: 'audio/wav',
      };
    } catch (err) {
      this.logger.warn(`Gemini TTS preview failed: ${String(err)}`);
      throw new DomainException(
        ErrorCode.PROVIDER_UNAVAILABLE,
        `Preview unavailable for voice '${voiceId}'`,
        HttpStatus.BAD_GATEWAY,
      );
    }
  }
}
