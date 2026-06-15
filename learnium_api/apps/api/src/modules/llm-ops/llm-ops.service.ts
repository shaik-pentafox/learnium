import { Injectable, HttpStatus } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { NotFoundException, DomainException } from '../../core/errors/domain.errors';
import { ErrorCode } from '@learnium/contracts';
import { encryptSecret } from './crypto.util';
import type { Env } from '../../core/config/env.schema';
import type {
  CreateProviderDto,
  UpdateProviderDto,
  CreateModelDto,
  UpdateModelDto,
  ModelQueryDto,
} from './dto/llm-ops.dto';

export const SYNC_REGISTRY_QUEUE = 'sync-llm-registry';

// Never expose the encrypted API key over the wire on any read/write path.
const PROVIDER_OMIT = { credentialRef: true } satisfies Prisma.LlmProviderOmit;

@Injectable()
export class LlmOpsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    @InjectQueue(SYNC_REGISTRY_QUEUE) private readonly syncQueue: Queue,
  ) {}

  listProviders() {
    return this.prisma.llmProvider.findMany({
      orderBy: { priority: 'desc' },
      omit: PROVIDER_OMIT,
    });
  }

  createProvider(dto: CreateProviderDto) {
    return this.prisma.llmProvider.create({
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

    const keyRotated = dto.apiKey !== undefined && dto.apiKey !== '';
    if (keyRotated) data.credentialRef = this.encrypt(dto.apiKey!);

    const provider = await this.prisma.llmProvider.update({
      where: { id },
      data,
      omit: PROVIDER_OMIT,
    });

    // New key → LiteLLM still holds the old one. Re-register every model of this provider.
    if (keyRotated) await this.resyncProviderModels(id);

    return provider;
  }

  async disableProvider(id: number) {
    await this.assertProvider(id);
    return this.prisma.llmProvider.update({
      where: { id },
      data: { isEnabled: false },
      omit: PROVIDER_OMIT,
    });
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

  createModel(dto: CreateModelDto) {
    return this.prisma.llmModel.create({
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
    return this.prisma.llmModel.update({ where: { id }, data });
  }

  async promoteModel(id: number) {
    const model = await this.assertModel(id);
    await this.prisma.$transaction([
      this.prisma.llmModel.updateMany({ data: { isDefault: false } }),
      this.prisma.llmModel.update({ where: { id }, data: { isDefault: true } }),
    ]);
    await this.syncQueue.add('sync', { modelId: id, modelName: model.name });
    return { id, promoted: true };
  }

  async resolveModel(modelId: number | null | undefined, fallback: string): Promise<string> {
    if (!modelId) return fallback;
    const model = await this.prisma.llmModel.findUnique({ where: { id: modelId } });
    return model?.name ?? fallback;
  }

  async getDefaultModelName(): Promise<string> {
    const model = await this.prisma.llmModel.findFirst({ where: { isDefault: true } });
    if (!model) {
      throw new DomainException(
        ErrorCode.PROVIDER_UNAVAILABLE,
        'No LLM model configured. Admin must register and promote a model via /llm/models.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return model.name;
  }

  /** Enqueue a LiteLLM re-register for every model belonging to a provider. */
  async resyncProviderModels(providerId: number) {
    const models = await this.prisma.llmModel.findMany({
      where: { providerId },
      select: { id: true, name: true },
    });
    await Promise.all(
      models.map((m) => this.syncQueue.add('sync', { modelId: m.id, modelName: m.name })),
    );
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
