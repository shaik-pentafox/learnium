import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { NotFoundException } from '../../core/errors/domain.errors';
import { REDIS_CLIENT } from '../../core/redis/redis.module';
import { MODEL_CACHE_CHANNEL } from '../../core/llm/model-factory.service';
import { encryptSecret } from '../../core/crypto/crypto.util';
import type { Env } from '../../core/config/env.schema';
import type {
  CreateProviderDto,
  UpdateProviderDto,
  CreateModelDto,
  UpdateModelDto,
  ModelQueryDto,
} from './dto/llm-ops.dto';

// Never expose the encrypted API key over the wire on any read/write path.
const PROVIDER_OMIT = { credentialRef: true } satisfies Prisma.LlmProviderOmit;

@Injectable()
export class LlmOpsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  listProviders() {
    return this.prisma.llmProvider.findMany({
      orderBy: { priority: 'desc' },
      omit: PROVIDER_OMIT,
    });
  }

  async createProvider(dto: CreateProviderDto) {
    const provider = await this.prisma.llmProvider.create({
      data: {
        name: dto.name,
        type: dto.type,
        isEnabled: dto.isEnabled,
        priority: dto.priority,
        baseUrl: dto.baseUrl ?? null,
        credentialRef: dto.apiKey ? this.encrypt(dto.apiKey) : null,
        monthlyBudgetUsd: dto.monthlyBudgetUsd ?? null,
      },
      omit: PROVIDER_OMIT,
    });
    await this.invalidateModelCache();
    return provider;
  }

  async updateProvider(id: number, dto: UpdateProviderDto) {
    await this.assertProvider(id);
    const data: Prisma.LlmProviderUncheckedUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.type !== undefined) data.type = dto.type;
    if (dto.isEnabled !== undefined) data.isEnabled = dto.isEnabled;
    if (dto.priority !== undefined) data.priority = dto.priority;
    if ('baseUrl' in dto) data.baseUrl = dto.baseUrl ?? null;
    if ('monthlyBudgetUsd' in dto) data.monthlyBudgetUsd = dto.monthlyBudgetUsd ?? null;
    if (dto.apiKey !== undefined && dto.apiKey !== '') {
      data.credentialRef = this.encrypt(dto.apiKey);
    }

    const provider = await this.prisma.llmProvider.update({
      where: { id },
      data,
      omit: PROVIDER_OMIT,
    });
    await this.invalidateModelCache();
    return provider;
  }

  async disableProvider(id: number) {
    await this.assertProvider(id);
    const provider = await this.prisma.llmProvider.update({
      where: { id },
      data: { isEnabled: false },
      omit: PROVIDER_OMIT,
    });
    await this.invalidateModelCache();
    return provider;
  }

  listModels(query: ModelQueryDto) {
    return this.prisma.llmModel.findMany({
      where: {
        ...(query.providerId !== undefined ? { providerId: query.providerId } : {}),
        ...(query.capability !== undefined ? { capabilities: { has: query.capability } } : {}),
      },
      include: { provider: { select: { id: true, name: true, type: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async createModel(dto: CreateModelDto) {
    const create = this.prisma.llmModel.create({
      data: {
        name: dto.name,
        providerId: dto.providerId,
        capabilities: dto.capabilities,
        isDefault: dto.isDefault,
        contextWindowTokens: dto.contextWindowTokens ?? null,
        inputPricePerMillion: dto.inputPricePerMillion ?? null,
        outputPricePerMillion: dto.outputPricePerMillion ?? null,
      },
    });
    // Exactly one default: clear the rest in the same transaction when this one
    // claims it. Same invariant promoteModel enforces.
    const [, model] = dto.isDefault
      ? await this.prisma.$transaction([this.clearDefaults(), create])
      : [null, await create];
    await this.invalidateModelCache();
    return model;
  }

  async updateModel(id: number, dto: UpdateModelDto) {
    await this.assertModel(id);
    const data: Prisma.LlmModelUncheckedUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.providerId !== undefined) data.providerId = dto.providerId;
    if (dto.capabilities !== undefined) data.capabilities = dto.capabilities;
    if (dto.isDefault !== undefined) data.isDefault = dto.isDefault;
    if ('contextWindowTokens' in dto) data.contextWindowTokens = dto.contextWindowTokens ?? null;
    if ('inputPricePerMillion' in dto) data.inputPricePerMillion = dto.inputPricePerMillion ?? null;
    if ('outputPricePerMillion' in dto) data.outputPricePerMillion = dto.outputPricePerMillion ?? null;

    const update = this.prisma.llmModel.update({ where: { id }, data });
    // Promoting via edit must demote the others too (excluding this row).
    const [, model] = dto.isDefault === true
      ? await this.prisma.$transaction([this.clearDefaults(id), update])
      : [null, await update];
    await this.invalidateModelCache();
    return model;
  }

  /** Demote every default model, optionally excluding one id. */
  private clearDefaults(exceptId?: number) {
    return this.prisma.llmModel.updateMany({
      where: { isDefault: true, ...(exceptId !== undefined ? { id: { not: exceptId } } : {}) },
      data: { isDefault: false },
    });
  }

  async promoteModel(id: number) {
    await this.assertModel(id);
    await this.prisma.$transaction([
      this.prisma.llmModel.updateMany({ data: { isDefault: false } }),
      this.prisma.llmModel.update({ where: { id }, data: { isDefault: true } }),
    ]);
    await this.invalidateModelCache();
    return { id, promoted: true };
  }

  /** Tell every replica's ModelFactory to drop its in-memory model cache. */
  private async invalidateModelCache(): Promise<void> {
    await this.redis.publish(MODEL_CACHE_CHANNEL, '1');
  }

  private encrypt(plain: string): string {
    return encryptSecret(plain, this.config.get('CREDENTIAL_ENCRYPTION_KEY', { infer: true }));
  }

  private async assertProvider(id: number) {
    const p = await this.prisma.llmProvider.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('LlmProvider', id);
    return p;
  }

  private async assertModel(id: number) {
    const m = await this.prisma.llmModel.findUnique({ where: { id } });
    if (!m) throw new NotFoundException('LlmModel', id);
    return m;
  }
}
