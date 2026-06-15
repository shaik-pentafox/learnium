import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { LlmOpsService } from './llm-ops.service';
import { PrismaService } from '../../core/database/prisma.service';

/**
 * LiteLLM is stateless across restarts — its in-memory model registry is lost.
 * On boot, re-enqueue a sync for every model whose provider is enabled so the
 * registry (and decrypted API keys) are repopulated. Runs async via BullMQ;
 * the app starts immediately and sync completes in the background.
 */
@Injectable()
export class StartupSyncService implements OnApplicationBootstrap {
  private readonly logger = new Logger(StartupSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llmOps: LlmOpsService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const providers = await this.prisma.llmProvider.findMany({
      where: { isEnabled: true },
      select: { id: true },
    });

    if (providers.length === 0) {
      this.logger.log('No enabled LLM providers — skipping startup sync');
      return;
    }

    await Promise.all(providers.map((p) => this.llmOps.resyncProviderModels(p.id)));
    this.logger.log(`Startup sync enqueued for ${providers.length} provider(s)`);
  }
}
