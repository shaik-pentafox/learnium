import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../core/database/prisma.service';
import { SYNC_REGISTRY_QUEUE } from './llm-ops.service';
import { decryptSecret } from './crypto.util';
import type { Env } from '../../core/config/env.schema';

interface SyncJobData {
  modelId: number;
  modelName: string;
}

@Processor(SYNC_REGISTRY_QUEUE)
export class SyncRegistryProcessor extends WorkerHost {
  private readonly logger = new Logger(SyncRegistryProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {
    super();
  }

  override async process(job: Job<SyncJobData>): Promise<void> {
    // Dedicated query that intentionally reads credentialRef (omitted everywhere else).
    const model = await this.prisma.llmModel.findUnique({
      where: { id: job.data.modelId },
      include: { provider: true },
    });

    if (!model) return;
    if (!model.provider.isEnabled) {
      this.logger.warn(`Provider "${model.provider.name}" disabled — skipping sync of "${model.name}"`);
      return;
    }

    const baseUrl = this.config.get('LITELLM_BASE_URL', { infer: true });
    const masterKey = this.config.get('LITELLM_API_KEY', { infer: true });
    const encKey = this.config.get('CREDENTIAL_ENCRYPTION_KEY', { infer: true });

    // Decrypt the provider's API key (stored encrypted at rest).
    let apiKey: string | undefined;
    if (model.provider.credentialRef) {
      try {
        apiKey = decryptSecret(model.provider.credentialRef, encKey);
      } catch (err) {
        this.logger.error({ err }, `Failed to decrypt credential for provider "${model.provider.name}"`);
        return;
      }
    }

    // LiteLLM alias the app requests stays the bare name; upstream gets "<provider>/<name>".
    const upstreamModel = model.name.includes('/')
      ? model.name
      : `${model.provider.type}/${model.name}`;

    // Deterministic id (our DB model id) makes re-sync idempotent: delete-then-create
    // replaces the stale entry instead of accumulating duplicates / stale keys.
    const litellmId = `learnium-${model.id}`;
    await this.deleteModel(baseUrl, masterKey, litellmId);

    const body = {
      model_name: model.name,
      litellm_params: {
        model: upstreamModel,
        ...(apiKey ? { api_key: apiKey } : {}),
        ...(model.provider.baseUrl ? { api_base: model.provider.baseUrl } : {}),
      },
      model_info: { id: litellmId },
    };

    try {
      const resp = await fetch(`${baseUrl}/model/new`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${masterKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        const text = await resp.text();
        this.logger.error(`LiteLLM sync failed: ${resp.status} ${text}`);
      } else {
        this.logger.log(`Model "${model.name}" synced to LiteLLM (upstream: ${upstreamModel})`);
      }
    } catch (err) {
      this.logger.error({ err }, 'LiteLLM sync error');
    }
  }

  /** Best-effort delete of an existing registry entry; 404 is expected on first sync. */
  private async deleteModel(baseUrl: string, masterKey: string, id: string): Promise<void> {
    try {
      await fetch(`${baseUrl}/model/delete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${masterKey}`,
        },
        body: JSON.stringify({ id }),
      });
    } catch (err) {
      this.logger.debug({ err }, `model/delete (${id}) ignored`);
    }
  }
}
