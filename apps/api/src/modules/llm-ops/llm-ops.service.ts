import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { NotFoundException, ValidationException } from '../../core/errors/domain.errors';
import { REDIS_CLIENT } from '../../core/redis/redis.module';
import { MODEL_CACHE_CHANNEL } from '../../core/llm/model-factory.service';
import { encryptSecret, decryptSecret } from '../../core/crypto/crypto.util';
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
  contextWindowTokens: true,
  pricingUnit: true,
  inputPricePerMillion: true,
  outputPricePerMillion: true,
  inputPricePerMinute: true,
  outputPricePerMinute: true,
  voicePipeline: true,
  languages: true,
  voices: true,
} satisfies Prisma.MasterModelSelect;

/** Effective pricing/context for a configured model = its own override, else the
 *  linked master's value (voice metadata already resolves this way). Keeps API
 *  responses stable now that master-linked rows store NULL for inherited fields. */
function resolveModel<
  T extends {
    contextWindowTokens: number | null;
    pricingUnit: string | null;
    inputPricePerMillion: number | null;
    outputPricePerMillion: number | null;
    inputPricePerMinute: number | null;
    outputPricePerMinute: number | null;
    masterModel?: {
      contextWindowTokens: number | null;
      pricingUnit: string | null;
      inputPricePerMillion: number | null;
      outputPricePerMillion: number | null;
      inputPricePerMinute: number | null;
      outputPricePerMinute: number | null;
    } | null;
  },
>(row: T): T {
  const m = row.masterModel ?? null;
  return {
    ...row,
    contextWindowTokens: row.contextWindowTokens ?? m?.contextWindowTokens ?? null,
    pricingUnit: row.pricingUnit ?? m?.pricingUnit ?? 'token',
    inputPricePerMillion: row.inputPricePerMillion ?? m?.inputPricePerMillion ?? null,
    outputPricePerMillion: row.outputPricePerMillion ?? m?.outputPricePerMillion ?? null,
    inputPricePerMinute: row.inputPricePerMinute ?? m?.inputPricePerMinute ?? null,
    outputPricePerMinute: row.outputPricePerMinute ?? m?.outputPricePerMinute ?? null,
  };
}

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
    // Two paths: pick a seeded master, or declare a custom provider (no master).
    let name: string;
    let type: string;
    let masterProviderId: number | null;
    let baseUrl: string | null;
    if (dto.masterProviderId != null) {
      const master = await this.prisma.masterProvider.findUnique({
        where: { id: dto.masterProviderId },
      });
      if (!master) throw new NotFoundException('MasterProvider', dto.masterProviderId);
      name = dto.name ?? master.name;
      type = master.adapterType;
      masterProviderId = master.id;
      baseUrl = dto.baseUrl ?? master.defaultBaseUrl;
    } else {
      // Custom provider — the DTO refine guarantees adapterType + name are set.
      name = dto.name!;
      type = dto.adapterType!;
      masterProviderId = null;
      baseUrl = dto.baseUrl ?? null;
    }

    const provider = await this.prisma.llmProvider.create({
      data: {
        name,
        type,
        masterProviderId,
        isEnabled: dto.isEnabled,
        baseUrl,
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
    // Disabling a provider can orphan a primary model — heal before invalidating.
    if (dto.isEnabled === false) await this.reconcileDefaults();
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
    await this.reconcileDefaults();
    await this.invalidateModelCache();
    return provider;
  }

  /** Live key/connectivity probe for a configured provider. Hits the provider's
   *  model-list endpoint with the stored key (no token spend), per adapter, so a
   *  bad key surfaces here instead of at first chat. */
  async testProvider(
    id: number,
  ): Promise<{ ok: boolean; status?: number; message: string }> {
    const provider = await this.assertProvider(id);
    const apiKey = provider.credentialRef
      ? decryptSecret(
          provider.credentialRef,
          this.config.get('CREDENTIAL_ENCRYPTION_KEY', { infer: true }),
        )
      : null;
    const { url, headers } = this.buildProviderProbe(
      provider.type.toLowerCase(),
      provider.baseUrl,
      apiKey,
    );
    try {
      const res = await fetch(url, { method: 'GET', headers });
      if (res.ok) return { ok: true, status: res.status, message: 'Connection OK' };
      const body = await res.text().catch(() => '');
      return {
        ok: false,
        status: res.status,
        message: `Provider rejected the request (HTTP ${res.status})${body ? `: ${body.slice(0, 200)}` : ''}`,
      };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : 'Connection failed',
      };
    }
  }

  /** Per-adapter model-list probe URL + auth headers (no request body). */
  private buildProviderProbe(
    adapter: string,
    baseUrl: string | null,
    apiKey: string | null,
  ): { url: string; headers: Record<string, string> } {
    if (adapter === 'gemini') {
      const base = baseUrl ?? 'https://generativelanguage.googleapis.com';
      return { url: `${base.replace(/\/$/, '')}/v1beta/models?key=${apiKey ?? ''}`, headers: {} };
    }
    if (adapter === 'anthropic') {
      const base = baseUrl ?? 'https://api.anthropic.com';
      return {
        url: `${base.replace(/\/$/, '')}/v1/models`,
        headers: { 'x-api-key': apiKey ?? '', 'anthropic-version': '2023-06-01' },
      };
    }
    // openai | openrouter | azure_openai | custom → OpenAI-compatible /models
    const base = baseUrl ?? 'https://api.openai.com/v1';
    return {
      url: `${base.replace(/\/$/, '')}/models`,
      headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
    };
  }

  /** After a provider becomes unavailable, ensure each kind still has a primary
   *  model on an ENABLED provider — promote a replacement if the old default was
   *  orphaned. Keeps model/voice resolution working after a disable/swap. */
  private async reconcileDefaults(): Promise<void> {
    for (const kind of ['chat', 'voice'] as const) {
      const healthy = await this.prisma.llmModel.findFirst({
        where: { kind, isDefault: true, provider: { isEnabled: true } },
      });
      if (healthy) continue;
      const replacement = await this.prisma.llmModel.findFirst({
        where: { kind, provider: { isEnabled: true } },
        orderBy: { id: 'asc' },
      });
      if (!replacement) continue; // no enabled model of this kind — nothing to promote
      await this.prisma.$transaction([
        this.clearDefaults(kind),
        this.prisma.llmModel.update({
          where: { id: replacement.id },
          data: { isDefault: true },
        }),
      ]);
    }
  }

  // ── Models ──────────────────────────────────────────────────────────────────

  async listModels(query: ModelQueryDto) {
    const rows = await this.prisma.llmModel.findMany({
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
    return rows.map(resolveModel);
  }

  /** Register a model by picking from the provider's master catalog. Metadata is
   *  copied from the master; the first enabled model of a kind auto-primaries. */
  async createModel(dto: CreateModelDto) {
    const provider = await this.assertProvider(dto.providerId);

    // Resolve the row's metadata from either the master catalog or the custom
    // fields on the DTO (refine guarantees name + kind when no master).
    let name: string;
    let kind: string;
    let capabilities: string[];
    let masterModelId: number | null;
    // Pricing/context are OVERRIDES: null on a master-linked row inherits from
    // the catalog at read/cost time. Only custom rows populate them.
    let contextWindowTokens: number | null;
    let pricingUnit: string | null;
    let inputPricePerMillion: number | null;
    let outputPricePerMillion: number | null;
    let inputPricePerMinute: number | null;
    let outputPricePerMinute: number | null;

    if (dto.masterModelId != null) {
      const master = await this.prisma.masterModel.findUnique({
        where: { id: dto.masterModelId },
      });
      if (!master) throw new NotFoundException('MasterModel', dto.masterModelId);
      if (provider.masterProviderId !== master.masterProviderId) {
        throw new ValidationException(
          'Selected model does not belong to this provider’s catalog',
        );
      }
      name = master.key;
      kind = master.kind;
      capabilities = master.kind === 'voice' ? ['voice'] : ['conversation', 'scoring'];
      masterModelId = master.id;
      // Inherit from the master — store nothing to drift.
      contextWindowTokens = null;
      pricingUnit = null;
      inputPricePerMillion = null;
      outputPricePerMillion = null;
      inputPricePerMinute = null;
      outputPricePerMinute = null;
    } else {
      // Custom model — voice is unsupported: the voice factory reads languages +
      // voices from the master catalog, which a custom row has none of.
      if (dto.kind === 'voice') {
        throw new ValidationException(
          'Custom voice models are not supported — add the voice model to the master catalog first',
        );
      }
      name = dto.name!;
      kind = dto.kind!;
      capabilities = dto.capabilities ?? ['conversation', 'scoring'];
      masterModelId = null;
      contextWindowTokens = dto.contextWindowTokens ?? null;
      pricingUnit = 'token'; // custom models are chat-only → token-billed
      inputPricePerMillion = dto.inputPricePerMillion ?? null;
      outputPricePerMillion = dto.outputPricePerMillion ?? null;
      inputPricePerMinute = null;
      outputPricePerMinute = null;
    }

    // Auto-primary: first model of its kind claims the default slot.
    const sameKindCount = await this.prisma.llmModel.count({ where: { kind } });
    const wantsDefault = dto.isDefault || sameKindCount === 0;

    const doCreate = (asDefault: boolean) =>
      this.prisma.llmModel.create({
        data: {
          name,
          providerId: provider.id,
          masterModelId,
          kind,
          capabilities,
          isDefault: asDefault,
          contextWindowTokens,
          pricingUnit,
          inputPricePerMillion,
          outputPricePerMillion,
          inputPricePerMinute,
          outputPricePerMinute,
        },
        include: { masterModel: { select: MASTER_MODEL_SELECT } },
      });

    let model;
    try {
      // Exactly one default per kind: clear same-kind rows when this one claims it.
      [, model] = wantsDefault
        ? await this.prisma.$transaction([this.clearDefaults(kind), doCreate(true)])
        : [null, await doCreate(false)];
    } catch (err) {
      // The partial unique index (one default per kind) rejected a concurrent
      // race for the primary slot — still add the model, just not as primary.
      if (
        wantsDefault &&
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        model = await doCreate(false);
      } else {
        throw err;
      }
    }
    await this.invalidateModelCache();
    return resolveModel(model);
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

    const update = this.prisma.llmModel.update({
      where: { id },
      data,
      include: {
        provider: { select: { id: true, name: true, type: true } },
        masterModel: { select: MASTER_MODEL_SELECT },
      },
    });
    // Promoting via edit must demote the other same-kind rows (excluding this one).
    const [, model] = dto.isDefault === true
      ? await this.prisma.$transaction([this.clearDefaults(existing.kind, id), update])
      : [null, await update];
    await this.invalidateModelCache();
    return resolveModel(model);
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

  /** Remove a model. Persona references to it are nulled first (so those personas
   *  fall back to the primary of that kind — the same graceful path as a disabled
   *  provider); if the removed model was a primary, a replacement is promoted. */
  async deleteModel(id: number) {
    const model = await this.assertModel(id);
    await this.prisma.$transaction([
      this.prisma.persona.updateMany({
        where: { conversationModelId: id },
        data: { conversationModelId: null },
      }),
      this.prisma.persona.updateMany({
        where: { scoringModelId: id },
        data: { scoringModelId: null },
      }),
      this.prisma.persona.updateMany({
        where: { voiceModelId: id },
        data: { voiceModelId: null },
      }),
      this.prisma.llmModel.delete({ where: { id } }),
    ]);
    if (model.isDefault) await this.reconcileDefaults();
    await this.invalidateModelCache();
    return { id, deleted: true, kind: model.kind };
  }

  /** Make this model the primary of ITS kind (chat and voice primaries coexist). */
  async promoteModel(id: number) {
    const model = await this.prisma.llmModel.findUnique({
      where: { id },
      include: { provider: { select: { isEnabled: true } } },
    });
    if (!model) throw new NotFoundException('LlmModel', id);
    // A primary on a disabled provider can't be resolved — refuse to promote it.
    if (!model.provider.isEnabled) {
      throw new ValidationException(
        'Cannot set a model on a disabled provider as primary — enable the provider first',
      );
    }
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
