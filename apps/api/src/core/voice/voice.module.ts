import { Global, Module } from '@nestjs/common';
import { VOICE_PROVIDER } from './voice-provider';
import { SarvamVoiceProvider } from './providers/sarvam.provider';
import { VoiceModelFactory } from './voice-model-factory.service';
import { VoicePreviewService } from './voice-preview.service';

/**
 * Voice runtime wiring.
 *
 * {@link VoiceModelFactory} is the registry-driven entrypoint: it resolves the
 * persona's voice model (or the primary) and constructs the right pipeline
 * manager (OpenAI Realtime / Gemini Live S2S, or the Sarvam STT+TTS turn loop).
 *
 * {@link VOICE_PROVIDER} still binds the Sarvam adapter directly for the legacy
 * /voice catalog endpoints; the factory injects the concrete class.
 */
@Global()
@Module({
  providers: [
    SarvamVoiceProvider,
    { provide: VOICE_PROVIDER, useExisting: SarvamVoiceProvider },
    VoiceModelFactory,
    VoicePreviewService,
  ],
  exports: [VOICE_PROVIDER, SarvamVoiceProvider, VoiceModelFactory, VoicePreviewService],
})
export class VoiceProviderModule {}
