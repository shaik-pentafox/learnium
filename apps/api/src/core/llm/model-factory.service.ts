import { Inject, Injectable, Logger, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { ChatOpenAI } from '@langchain/openai';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { Runnable } from '@langchain/core/runnables';
import type { BaseLanguageModelInput } from '@langchain/core/language_models/base';
import type { AIMessageChunk } from '@langchain/core/messages';
import { PrismaService } from '../database/prisma.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import { decryptSecret } from '../crypto/crypto.util';
import { DomainException } from '../errors/domain.errors';
import { ErrorCode } from '@learnium/contracts';
import type { Env } from '../config/env.schema';
import { LlmFlowLogger } from './llm-flow.logger';

/** Replicas publish here when the registry changes so every node drops its model cache. */
export const MODEL_CACHE_CHANNEL = 'llm:model-cache:invalidate';

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
const MAX_FALLBACKS = 3;

interface ProviderRecord {
  type: string;
  baseUrl: string | null;
  credentialRef: string | null;
  isEnabled: boolean;
  priority: number;
}

interface ModelRecord {
  id: number;
  name: string;
  provider: ProviderRecord;
}

export type ChatRunnable = Runnable<BaseLanguageModelInput, AIMessageChunk>;

export interface ResolvedModel {
  id: number;
  name: string;
  /** Provider type (e.g. "gemini", "openai") — recorded with usage telemetry. */
  providerType: string;
  /** Raw primary model — use for `.withStructuredOutput()`. */
  model: BaseChatModel;
  /** Primary + ordered fallbacks — use for streaming chat. */
  chat: ChatRunnable;
}

/**
 * Builds LangChain chat models from the DB registry + decrypted BYOK credentials.
 * Providers (OpenAI / Gemini / Azure OpenAI / OpenRouter / OpenAI-compatible custom)
 * are configuration, not code. No gateway — models are constructed in-process and
 * cached by model id; the cache is cleared on a Redis pub/sub invalidation signal.
 */
@Injectable()
export class ModelFactoryService {
  private readonly logger = new Logger(ModelFactoryService.name);
  private readonly cache = new Map<number, BaseChatModel>();
  private readonly sub: Redis;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly flowLog: LlmFlowLogger,
  ) {
    this.sub = this.redis.duplicate();
    void this.sub.subscribe(MODEL_CACHE_CHANNEL).then(() => {
      this.sub.on('message', () => {
        this.cache.clear();
        this.logger.log('LLM model cache invalidated');
      });
    });
  }

  /** Resolve a logical model id (or the default) to a usable chat model + fallbacks. */
  async resolve(modelId: number | null | undefined): Promise<ResolvedModel> {
    const span = this.flowLog.start('model_resolve', {
      requestedModelId: modelId ?? null,
    });
    try {
      const record = await this.loadModel(modelId);
      const cacheHit = this.cache.has(record.id);
      const model = this.getOrBuild(record);
      const fallbacks = await this.buildFallbacks(record.id);
      const chat: ChatRunnable = fallbacks.length
        ? model.withFallbacks({ fallbacks })
        : model;
      span.complete({
        resolvedModelId: record.id,
        modelName: record.name,
        providerType: record.provider.type,
        fallbackCount: fallbacks.length,
        cacheHit,
      });
      return {
        id: record.id,
        name: record.name,
        providerType: record.provider.type,
        model,
        chat,
      };
    } catch (err) {
      span.fail(err);
      throw err;
    }
  }

  private async loadModel(
    modelId: number | null | undefined,
  ): Promise<ModelRecord> {
    const where = modelId
      ? { id: modelId, provider: { isEnabled: true } }
      : { isDefault: true, provider: { isEnabled: true } };
    const model = await this.prisma.llmModel.findFirst({
      where,
      include: { provider: true },
    });
    if (!model) {
      throw new DomainException(
        ErrorCode.PROVIDER_UNAVAILABLE,
        'No usable LLM model configured. Admin must register a provider key and promote a model via /llm.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return model as ModelRecord;
  }

  /** Other enabled-provider models, highest provider priority first, as a fallback chain. */
  private async buildFallbacks(primaryId: number): Promise<BaseChatModel[]> {
    const others = await this.prisma.llmModel.findMany({
      where: { id: { not: primaryId }, provider: { isEnabled: true } },
      include: { provider: true },
      orderBy: { provider: { priority: 'desc' } },
      take: MAX_FALLBACKS,
    });
    return others.map((m) => this.getOrBuild(m as ModelRecord));
  }

  private getOrBuild(record: ModelRecord): BaseChatModel {
    const cached = this.cache.get(record.id);
    if (cached) return cached;
    const built = this.construct(record);
    this.cache.set(record.id, built);
    return built;
  }

  private construct(record: ModelRecord): BaseChatModel {
    const { provider } = record;
    const apiKey = provider.credentialRef
      ? decryptSecret(
          provider.credentialRef,
          this.config.get('CREDENTIAL_ENCRYPTION_KEY', { infer: true }),
        )
      : undefined;
    const type = provider.type.toLowerCase();

    if (type === 'gemini') {
      return new ChatGoogleGenerativeAI({
        model: record.name,
        streaming: true,
        ...(apiKey ? { apiKey } : {}),
      });
    }

    // openai | openrouter | azure_openai | custom → OpenAI-compatible endpoint
    const baseURL =
      provider.baseUrl ?? (type === 'openrouter' ? OPENROUTER_BASE : undefined);
    return new ChatOpenAI({
      model: record.name,
      // Local/self-hosted OpenAI-compatible servers (vLLM/Ollama) often need no key.
      apiKey: apiKey ?? 'sk-noauth',
      streaming: true,
      ...(baseURL ? { configuration: { baseURL } } : {}),
    });
  }
}
