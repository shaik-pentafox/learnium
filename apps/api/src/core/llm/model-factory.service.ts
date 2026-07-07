import { Inject, Injectable, Logger, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { ChatOpenAI } from '@langchain/openai';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { ChatAnthropic } from '@langchain/anthropic';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { Runnable } from '@langchain/core/runnables';
import type { BaseLanguageModelInput } from '@langchain/core/language_models/base';
import type { AIMessageChunk } from '@langchain/core/messages';
import { PrismaService } from '../database/prisma.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import { decryptSecret } from '../crypto/crypto.util';
import { DomainException } from '../errors/domain.errors';
import { ErrorCode } from '@traineon/contracts';
import type { Env } from '../config/env.schema';
import { LlmFlowLogger } from './llm-flow.logger';
import { ProviderBudgetService } from './provider-budget.service';

/** Replicas publish here when the registry changes so every node drops its model cache. */
export const MODEL_CACHE_CHANNEL = 'llm:model-cache:invalidate';

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

interface ProviderRecord {
  id: number;
  type: string;
  baseUrl: string | null;
  credentialRef: string | null;
  isEnabled: boolean;
  monthlyBudgetUsd: number | null;
  /** Master catalog link — preferred source of the runtime adapter branch. */
  masterProvider: { adapterType: string } | null;
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
  /** Chat runnable for streaming (same as `model`; no fallback chain — the
   *  primary is admin-chosen, and its failure surfaces as PROVIDER_ERROR). */
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
    private readonly budget: ProviderBudgetService,
  ) {
    this.sub = this.redis.duplicate();
    void this.sub.subscribe(MODEL_CACHE_CHANNEL).then(() => {
      this.sub.on('message', () => {
        this.cache.clear();
        this.logger.log('LLM model cache invalidated');
      });
    });
  }

  /** Resolve a logical chat-model id (or the primary chat model) to a usable model. */
  async resolve(modelId: number | null | undefined): Promise<ResolvedModel> {
    const span = this.flowLog.start('model_resolve', {
      requestedModelId: modelId ?? null,
    });
    try {
      const record = await this.loadModel(modelId);
      // Stop resolving models once the provider's monthly budget is spent.
      await this.budget.assertWithinBudget(
        record.provider.id,
        record.provider.monthlyBudgetUsd,
      );
      const cacheHit = this.cache.has(record.id);
      const model = this.getOrBuild(record);
      span.complete({
        resolvedModelId: record.id,
        modelName: record.name,
        providerType: record.provider.type,
        cacheHit,
      });
      return {
        id: record.id,
        name: record.name,
        providerType: record.provider.type,
        model,
        chat: model,
      };
    } catch (err) {
      span.fail(err);
      throw err;
    }
  }

  private async loadModel(
    modelId: number | null | undefined,
  ): Promise<ModelRecord> {
    const include = {
      provider: { include: { masterProvider: { select: { adapterType: true } } } },
    };
    // kind guard: a voice model id must never resolve as the chat engine.
    // A pinned model whose provider was disabled/swapped falls back to the
    // primary instead of hard-failing the turn (registry-churn resilience).
    if (modelId) {
      const pinned = await this.prisma.llmModel.findFirst({
        where: { id: modelId, kind: 'chat', provider: { isEnabled: true } },
        include,
      });
      if (pinned) return pinned as ModelRecord;
      this.logger.warn(
        `Pinned chat model ${modelId} unavailable (disabled/removed) — falling back to primary`,
      );
    }
    const primary = await this.prisma.llmModel.findFirst({
      where: { isDefault: true, kind: 'chat', provider: { isEnabled: true } },
      include,
    });
    if (!primary) {
      throw new DomainException(
        ErrorCode.PROVIDER_UNAVAILABLE,
        'No usable LLM model configured. Admin must register a provider key and promote a model via /llm.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return primary as ModelRecord;
  }

  private getOrBuild(record: ModelRecord): BaseChatModel {
    const cached = this.cache.get(record.id);
    if (cached) return cached;
    const built = this.construct(record);
    this.cache.set(record.id, built);
    return built;
  }

  /** Concrete chat classes (ChatOpenAI/ChatAnthropic/ChatGoogleGenerativeAI)
   *  each bundle their own `@langchain/core`. When a server install resolves more
   *  than one core version, tsc rejects the assignment to our `BaseChatModel`
   *  (protected-member identity mismatch, TS2375) even though they ARE valid chat
   *  models. Funnel construction through this seam so the build is immune to that
   *  duplicate-copy skew. The `overrides` pin in the root package.json is the
   *  real dedupe; this keeps the build green regardless. */
  private asChatModel(model: unknown): BaseChatModel {
    return model as BaseChatModel;
  }

  private construct(record: ModelRecord): BaseChatModel {
    const { provider } = record;
    const apiKey = provider.credentialRef
      ? decryptSecret(
          provider.credentialRef,
          this.config.get('CREDENTIAL_ENCRYPTION_KEY', { infer: true }),
        )
      : undefined;
    // Master-linked providers dispatch on the catalog's adapterType; legacy rows
    // fall back to their free-text `type`.
    const type = (provider.masterProvider?.adapterType ?? provider.type).toLowerCase();

    if (type === 'gemini') {
      return this.asChatModel(
        new ChatGoogleGenerativeAI({
          model: record.name,
          streaming: true,
          ...(apiKey ? { apiKey } : {}),
        }),
      );
    }

    if (type === 'anthropic') {
      return this.asChatModel(
        new ChatAnthropic({
          model: record.name,
          streaming: true,
          ...(apiKey ? { apiKey } : {}),
        }),
      );
    }

    // openai | openrouter | azure_openai | custom → OpenAI-compatible
    const baseURL =
      provider.baseUrl ?? (type === 'openrouter' ? OPENROUTER_BASE : undefined);
    return this.asChatModel(
      new ChatOpenAI({
        model: record.name,
        // Local/self-hosted OpenAI-compatible servers (vLLM/Ollama) often need no key.
        apiKey: apiKey ?? 'sk-noauth',
        streaming: true,
        ...(baseURL ? { configuration: { baseURL } } : {}),
      }),
    );
  }
}
