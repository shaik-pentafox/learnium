import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service';
import { decryptSecret } from '../crypto/crypto.util';
import { DomainException } from '../errors/domain.errors';
import { ErrorCode } from '@traineon/contracts';
import type { Env } from '../config/env.schema';
import type { IVoiceManager, S2SCallbacks } from './voice-manager';
import { OpenAIRealtimeManager } from './managers/openai-realtime.manager';
import { GeminiLiveManager } from './managers/gemini-live.manager';

/** A voice model resolved from the registry, ready for manager construction. */
export interface ResolvedVoiceModel {
  modelId: number;
  /** Provider-side model id (LlmModel.name = master key), e.g. 'gpt-4o-realtime-preview'. */
  modelName: string;
  providerType: string;
  adapterType: string;
  /** BCP-47 codes the model supports (from the master catalog). */
  languages: string[];
  /** Provider voice ids (from the master catalog). */
  voices: string[];
  /** Decrypted provider API key. */
  apiKey: string | null;
  baseUrl: string | null;
}

export interface CreateManagerArgs {
  languageCode: string;
  voiceId: string;
  /** Full system prompt incl. language instruction — S2S managers only. */
  instructions: string;
  /** Side-effect callbacks for S2S managers. */
  s2s: S2SCallbacks;
}

/**
 * Registry-driven voice manager factory: resolves the persona's voice model
 * (or the primary), decrypts the provider key, and constructs the matching
 * pipeline manager. The gateway never sees provider specifics.
 */
@Injectable()
export class VoiceModelFactory {
  private readonly logger = new Logger(VoiceModelFactory.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Pinned voice model (persona.voiceModelId) or the primary voice model.
   *  A pin whose provider was disabled/swapped falls back to the primary voice
   *  model instead of hard-failing (registry-churn resilience). */
  async resolve(voiceModelId: number | null | undefined): Promise<ResolvedVoiceModel> {
    const include = {
      masterModel: true,
      provider: { include: { masterProvider: { select: { adapterType: true } } } },
    };
    let model = voiceModelId
      ? await this.prisma.llmModel.findFirst({
          where: { id: voiceModelId, kind: 'voice', provider: { isEnabled: true } },
          include,
        })
      : null;
    if (voiceModelId && (!model || !model.masterModel)) {
      this.logger.warn(
        `Pinned voice model ${voiceModelId} unavailable (disabled/removed) — falling back to primary`,
      );
      model = null;
    }
    if (!model) {
      model = await this.prisma.llmModel.findFirst({
        where: { isDefault: true, kind: 'voice', provider: { isEnabled: true } },
        include,
      });
    }
    if (!model || !model.masterModel) {
      throw new DomainException(
        ErrorCode.PROVIDER_UNAVAILABLE,
        'No voice model configured. Admin must add a voice provider + model via /llm.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    const apiKey = model.provider.credentialRef
      ? decryptSecret(
          model.provider.credentialRef,
          this.config.get('CREDENTIAL_ENCRYPTION_KEY', { infer: true }),
        )
      : null;
    return {
      modelId: model.id,
      modelName: model.name,
      providerType: model.provider.type,
      adapterType:
        model.provider.masterProvider?.adapterType ?? model.provider.type,
      languages: model.masterModel.languages,
      voices: model.masterModel.voices,
      apiKey,
      baseUrl: model.provider.baseUrl,
    };
  }

  createManager(resolved: ResolvedVoiceModel, args: CreateManagerArgs): IVoiceManager {
    switch (resolved.adapterType) {
      case 'openai':
        return new OpenAIRealtimeManager({
          apiKey: this.requireKey(resolved),
          modelId: resolved.modelName,
          instructions: args.instructions,
          languageCode: args.languageCode,
          voiceId: args.voiceId,
          callbacks: args.s2s,
        });
      case 'gemini':
        return new GeminiLiveManager({
          apiKey: this.requireKey(resolved),
          modelId: resolved.modelName,
          instructions: args.instructions,
          languageCode: args.languageCode,
          voiceId: args.voiceId,
          callbacks: args.s2s,
        });
      default:
        throw new DomainException(
          ErrorCode.PROVIDER_UNAVAILABLE,
          `No voice pipeline for provider type '${resolved.adapterType}'`,
          HttpStatus.SERVICE_UNAVAILABLE,
        );
    }
  }

  private requireKey(resolved: ResolvedVoiceModel): string {
    if (!resolved.apiKey) {
      throw new DomainException(
        ErrorCode.PROVIDER_UNAVAILABLE,
        'Voice provider has no API key configured',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return resolved.apiKey;
  }
}
