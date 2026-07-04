import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { NotFoundException, ValidationException } from '../../core/errors/domain.errors';
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
  MasterModelQueryDto,
} from './dto/llm-ops.dto';

// Never expose the encrypted API key over the wire on any read/write path.
const PROVIDER_OMIT = { credentialRef: true } satisfies Prisma.LlmProviderOmit;

const MASTER_PROVIDER_SELECT = {
  id: true,
  key: true,
  name: true,
  adapterType: true,
  supports: true,
} satisfies Prisma.MasterProviderSelect;

const MASTER_MODEL_SELECT = {
  id: true,
  key: true,
  name: true,
  kind: true,
  voicePipeline: true,
  languages: true,
  voices: true,
} satisfies Prisma.MasterModelSelect;

/** Masked key for display: "sk-…abc4". Never enough to reconstruct the key. */
function credentialHint(apiKey: string): string {
  if (apiKey.length <= 8) return '…';
  return `${apiKey.slice(0, 3)}…${apiKey.slice(-4)}`;
}

@Injectable()
export class LlmOpsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  // ── Masters (seeded catalog, read-only) ─────────────────────────────────────

  /** Master providers + which are already configured (for the add-provider UI). */
  async listMasterProviders() {
    const masters = await this.prisma.masterProvider.findMany({
      orderBy: { name: 'asc' },
      include: { configured: { select: { id: true } } },
    });
    return masters.map(({ configured, ...m }) => ({
      ...m,
      configuredProviderIds: configured.map((c) => c.id),
    }));
  }

  /** Master models addable for a CONFIGURED provider (resolves its master). */
  async listMasterModels(query: MasterModelQueryDto) {
    const provider = await this.assertProvider(query.providerId);
    if (provider.masterProviderId == null) {
      throw new ValidationException(
        'Provider is not linked to a master catalog entry (legacy provider)',
      );
    }
    return this.prisma.masterModel.findMany({
      where: {
        masterProviderId: provider.masterProviderId,
        ...(query.kind !== undefined ? { kind: query.kind } : {}),
      },
      orderBy: [{ kind: 'asc' }, { name: 'asc' }],
    });
  }

  // ── Providers ───────────────────────────────────────────────────────────────

  listProviders() {
    return this.prisma.llmProvider.findMany({
      orderBy: { name: 'asc' },
      omit: PROVIDER_OMIT,
      include: { masterProvider: { select: MASTER_PROVIDER_SELECT } },
    });
  }

  async createProvider(dto: CreateProviderDto) {
    const master = await this.prisma.masterProvider.findUnique({
      where: { id: dto.masterProviderId },
    });
    if (!master) throw new NotFoundException('MasterProvider', dto.masterProviderId);

    const provider = await this.prisma.llmProvider.create({
      data: {
        name: dto.name ?? master.name,
        type: master.adapterType,
        masterProviderId: master.id,
        isEnabled: dto.isEnabled,
        baseUrl: dto.baseUrl ?? master.defaultBaseUrl,
        credentialRef: this.encrypt(dto.apiKey),
        credentialHint: credentialHint(dto.apiKey),
        monthlyBudgetUsd: dto.monthlyBudgetUsd ?? null,
      },
      omit: PROVIDER_OMIT,
      include: { masterProvider: { select: MASTER_PROVIDER_SELECT } },
    });
    await this.invalidateModelCache();
    return provider;
  }

  async updateProvider(id: number, dto: UpdateProviderDto) {
    await this.assertProvider(id);
    const data: Prisma.LlmProviderUncheckedUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.isEnabled !== undefined) data.isEnabled = dto.isEnabled;
    if ('baseUrl' in dto) data.baseUrl = dto.baseUrl ?? null;
    if ('monthlyBudgetUsd' in dto) data.monthlyBudgetUsd = dto.monthlyBudgetUsd ?? null;
    // Key rotation: re-encrypt + refresh the masked hint.
    if (dto.apiKey !== undefined && dto.apiKey !== '') {
      data.credentialRef = this.encrypt(dto.apiKey);
      data.credentialHint = credentialHint(dto.apiKey);
    }

    const provider = await this.prisma.llmProvider.update({
      where: { id },
      data,
      omit: PROVIDER_OMIT,
      include: { masterProvider: { select: MASTER_PROVIDER_SELECT } },
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

  // ── Models ──────────────────────────────────────────────────────────────────

  listModels(query: ModelQueryDto) {
    return this.prisma.llmModel.findMany({
      where: {
        ...(query.providerId !== undefined ? { providerId: query.providerId } : {}),
        ...(query.capability !== undefined ? { capabilities: { has: query.capability } } : {}),
        ...(query.kind !== undefined ? { kind: query.kind } : {}),
      },
      include: {
        provider: { select: { id: true, name: true, type: true } },
        masterModel: { select: MASTER_MODEL_SELECT },
      },
      orderBy: [{ kind: 'asc' }, { name: 'asc' }],
    });
  }

  /** Register a model by picking from the provider's master catalog. Metadata is
   *  copied from the master; the first enabled model of a kind auto-primaries. */
  async createModel(dto: CreateModelDto) {
    const provider = await this.assertProvider(dto.providerId);
    const master = await this.prisma.masterModel.findUnique({
      where: { id: dto.masterModelId },
    });
    if (!master) throw new NotFoundException('MasterModel', dto.masterModelId);
    if (provider.masterProviderId !== master.masterProviderId) {
      throw new ValidationException(
        'Selected model does not belong to this provider’s catalog',
      );
    }

    // Auto-primary: first model of its kind claims the default slot.
    const sameKindCount = await this.prisma.llmModel.count({
      where: { kind: master.kind },
    });
    const isDefault = dto.isDefault || sameKindCount === 0;

    const create = this.prisma.llmModel.create({
      data: {
        name: master.key,
        providerId: provider.id,
        masterModelId: master.id,
        kind: master.kind,
        capabilities: master.kind === 'voice' ? ['voice'] : ['conversation', 'scoring'],
        isDefault,
        contextWindowTokens: master.contextWindowTokens,
        inputPricePerMillion: master.inputPricePerMillion,
        outputPricePerMillion: master.outputPricePerMillion,
      },
      include: { masterModel: { select: MASTER_MODEL_SELECT } },
    });
    // Exactly one default per kind: clear same-kind rows when this one claims it.
    const [, model] = isDefault
      ? await this.prisma.$transaction([this.clearDefaults(master.kind), create])
      : [null, await create];
    await this.invalidateModelCache();
    return model;
  }

  async updateModel(id: number, dto: UpdateModelDto) {
    const existing = await this.assertModel(id);
    const data: Prisma.LlmModelUncheckedUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.capabilities !== undefined) data.capabilities = dto.capabilities;
    if (dto.isDefault !== undefined) data.isDefault = dto.isDefault;
    if ('contextWindowTokens' in dto) data.contextWindowTokens = dto.contextWindowTokens ?? null;
    if ('inputPricePerMillion' in dto) data.inputPricePerMillion = dto.inputPricePerMillion ?? null;
    if ('outputPricePerMillion' in dto) data.outputPricePerMillion = dto.outputPricePerMillion ?? null;

    const update = this.prisma.llmModel.update({ where: { id }, data });
    // Promoting via edit must demote the other same-kind rows (excluding this one).
    const [, model] = dto.isDefault === true
      ? await this.prisma.$transaction([this.clearDefaults(existing.kind, id), update])
      : [null, await update];
    await this.invalidateModelCache();
    return model;
  }

  /** Demote every default model OF A KIND, optionally excluding one id. */
  private clearDefaults(kind: string, exceptId?: number) {
    return this.prisma.llmModel.updateMany({
      where: {
        isDefault: true,
        kind,
        ...(exceptId !== undefined ? { id: { not: exceptId } } : {}),
      },
      data: { isDefault: false },
    });
  }

  /** Make this model the primary of ITS kind (chat and voice primaries coexist). */
  async promoteModel(id: number) {
    const model = await this.assertModel(id);
    await this.prisma.$transaction([
      this.prisma.llmModel.updateMany({
        where: { kind: model.kind },
        data: { isDefault: false },
      }),
      this.prisma.llmModel.update({ where: { id }, data: { isDefault: true } }),
    ]);
    await this.invalidateModelCache();
    return { id, promoted: true, kind: model.kind };
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
