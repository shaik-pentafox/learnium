import { Controller, Get, Inject, Query, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { PrismaService } from '../../core/database/prisma.service';
import { ValidationException } from '../../core/errors/domain.errors';
import { VOICE_PROVIDER, type VoiceProvider } from '../../core/voice/voice-provider';
import { VoiceModelFactory } from '../../core/voice/voice-model-factory.service';
import { VoicePreviewService } from '../../core/voice/voice-preview.service';

/**
 * Read-only catalog the persona builder uses for its voice section. Registry-
 * driven: languages/voices come from the resolved voice model's master entry
 * (a pinned `voiceModelId` or the primary voice model). Trainers hit this —
 * it needs no llmops permission. Legacy fallbacks keep pre-registry setups
 * working (env-configured Sarvam, `voice_styles` rows).
 */
@Controller('voice')
export class VoiceController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly voiceFactory: VoiceModelFactory,
    private readonly previews: VoicePreviewService,
    @Inject(VOICE_PROVIDER) private readonly voice: VoiceProvider,
  ) {}

  /** GET /voice/voices — selectable voices for the resolved voice model. */
  @Get('voices')
  async voices(@Query('voiceModelId') voiceModelId?: string) {
    try {
      const resolved = await this.voiceFactory.resolve(
        voiceModelId ? parseInt(voiceModelId, 10) : null,
      );
      return {
        voices: resolved.voices.map((v, i) => ({
          id: i + 1,
          name: v,
          voiceId: v,
          provider: resolved.providerType,
        })),
      };
    } catch {
      // Legacy fallback: DB voice_styles rows (pre-registry personas).
      const rows = await this.prisma.voiceStyle.findMany({
        orderBy: { name: 'asc' },
        select: { id: true, name: true, voiceId: true, provider: true },
      });
      return { voices: rows };
    }
  }

  /** GET /voice/languages — BCP-47 codes of the resolved voice model. */
  @Get('languages')
  async languages(@Query('voiceModelId') voiceModelId?: string) {
    try {
      const resolved = await this.voiceFactory.resolve(
        voiceModelId ? parseInt(voiceModelId, 10) : null,
      );
      return { languages: resolved.languages };
    } catch {
      // Legacy fallback: env-configured provider's static catalog.
      return { languages: this.voice.supportedLanguages() };
    }
  }

  /** GET /voice/preview — short "hear this voice" audio sample for the builder.
   *  Generated once per (voice, language) via the provider's TTS, then cached. */
  @Get('preview')
  async preview(
    @Res() reply: FastifyReply,
    @Query('voiceId') voiceId?: string,
    @Query('languageCode') languageCode?: string,
    @Query('voiceModelId') voiceModelId?: string,
  ) {
    if (!voiceId) throw new ValidationException('voiceId is required');
    const resolved = await this.voiceFactory.resolve(
      voiceModelId ? parseInt(voiceModelId, 10) : null,
    );
    const audio = await this.previews.preview(resolved, voiceId, languageCode ?? 'en-IN');
    return reply
      .header('content-type', audio.mime)
      .header('cache-control', 'private, max-age=86400')
      .send(audio.bytes);
  }
}
