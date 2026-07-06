import { Global, Module } from '@nestjs/common';
import { VoiceModelFactory } from './voice-model-factory.service';
import { VoicePreviewService } from './voice-preview.service';

/**
 * Voice runtime wiring.
 *
 * {@link VoiceModelFactory} is the registry-driven entrypoint: it resolves the
 * persona's voice model (or the primary) and constructs the right native
 * speech-to-speech manager (OpenAI Realtime / Gemini Live).
 */
@Global()
@Module({
  providers: [VoiceModelFactory, VoicePreviewService],
  exports: [VoiceModelFactory, VoicePreviewService],
})
export class VoiceProviderModule {}
