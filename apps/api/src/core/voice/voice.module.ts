import { Global, Module } from '@nestjs/common';
import { VOICE_PROVIDER } from './voice-provider';
import { SarvamVoiceProvider } from './providers/sarvam.provider';

/**
 * Binds the active voice provider to the {@link VOICE_PROVIDER} port token.
 *
 * Bootstrap decision: single adapter, bound directly — no env switch / registry
 * until a 2nd provider actually exists (adding one then is a one-line change here,
 * swapping `useClass` for a `useFactory` that picks by `VOICE_PROVIDER` config).
 */
@Global()
@Module({
  providers: [{ provide: VOICE_PROVIDER, useClass: SarvamVoiceProvider }],
  exports: [VOICE_PROVIDER],
})
export class VoiceProviderModule {}
