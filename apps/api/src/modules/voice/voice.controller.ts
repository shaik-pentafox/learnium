import { Controller, Get, Inject } from '@nestjs/common';
import { PrismaService } from '../../core/database/prisma.service';
import { VOICE_PROVIDER, type VoiceProvider } from '../../core/voice/voice-provider';

/**
 * Read-only catalog the persona builder uses to populate the voice picker and the
 * language multi-select. Voices come from the DB (`voice_styles`) so a persona can
 * store a stable `voiceStyleId`; languages come from the active provider port.
 */
@Controller('voice')
export class VoiceController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(VOICE_PROVIDER) private readonly voice: VoiceProvider,
  ) {}

  /** GET /voice/voices — selectable voices (provider-neutral shape). */
  @Get('voices')
  async voices() {
    const rows = await this.prisma.voiceStyle.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, voiceId: true, provider: true },
    });
    return { voices: rows };
  }

  /** GET /voice/languages — BCP-47 codes the active provider supports. */
  @Get('languages')
  languages() {
    return { languages: this.voice.supportedLanguages() };
  }
}
