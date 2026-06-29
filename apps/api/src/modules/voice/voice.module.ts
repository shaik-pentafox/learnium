import { Module } from '@nestjs/common';
import { VoiceController } from './voice.controller';

/** Voice catalog endpoints (voices + languages) for the persona builder. */
@Module({
  controllers: [VoiceController],
})
export class VoiceModule {}
