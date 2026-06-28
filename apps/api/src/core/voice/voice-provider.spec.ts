import { describe, it, expect } from '@jest/globals';
import { SentenceChunker } from './sentence-chunker';
import type {
  SttResult,
  SttStream,
  TtsAudio,
  TtsOptions,
  VoiceDescriptor,
  VoiceProvider,
} from './voice-provider';

/**
 * A fully provider-neutral fake implementing the port — proof the {@link VoiceProvider}
 * contract is implementable by a non-Sarvam provider (no Sarvam types required). The
 * real STT→chunk→TTS wiring (VoiceTurnManager) lands in a later step and will be
 * exercised against this fake; here we assert the contract holds and that the chunker
 * drives synthesis in order.
 */
class FakeSttStream implements SttStream {
  private finalCb: (r: SttResult) => void = () => {};
  onPartial(): void {}
  onFinal(cb: (r: SttResult) => void): void {
    this.finalCb = cb;
  }
  onError(): void {}
  push(): void {}
  async close(): Promise<void> {}
  /** Test helper: simulate VAD endpoint with a settled transcript. */
  emitFinal(text: string): void {
    this.finalCb({ text, isFinal: true });
  }
}

class FakeVoiceProvider implements VoiceProvider {
  readonly id = 'fake';
  synthesized: string[] = [];
  async openStt(): Promise<SttStream> {
    return new FakeSttStream();
  }
  async synthesize(opts: TtsOptions): Promise<TtsAudio> {
    this.synthesized.push(opts.text);
    return { bytes: Buffer.from(opts.text), mime: 'audio/wav', sampleRate: 24000 };
  }
  listVoices(): VoiceDescriptor[] {
    return [{ voiceId: 'fake-voice', name: 'Fake', languages: ['en-IN'] }];
  }
  supportedLanguages(): string[] {
    return ['en-IN', 'hi-IN'];
  }
}

describe('VoiceProvider port', () => {
  it('a non-Sarvam fake satisfies the port (no provider coupling)', async () => {
    const provider: VoiceProvider = new FakeVoiceProvider();
    expect(provider.id).toBe('fake');
    expect(provider.supportedLanguages()).toContain('hi-IN');
    const stream = await provider.openStt({ languageCode: 'en-IN' });
    expect(typeof stream.push).toBe('function');
  });

  it('final transcript → sentence chunks → ordered synthesize calls', async () => {
    const provider = new FakeVoiceProvider();
    const chunker = new SentenceChunker();

    // Simulate an LLM reply streamed as deltas after an STT-final turn.
    const reply = 'Sure, I can help. What is your account number?';
    for (const sentence of chunker.push(reply)) {
      await provider.synthesize({
        text: sentence,
        languageCode: 'en-IN',
        voiceId: 'fake-voice',
      });
    }
    for (const tail of chunker.flush()) {
      await provider.synthesize({ text: tail, languageCode: 'en-IN', voiceId: 'fake-voice' });
    }

    expect(provider.synthesized).toEqual([
      'Sure, I can help.',
      'What is your account number?',
    ]);
  });
});
