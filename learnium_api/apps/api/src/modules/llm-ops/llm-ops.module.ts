import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { LlmOpsController } from './llm-ops.controller';
import { LlmOpsService, SYNC_REGISTRY_QUEUE } from './llm-ops.service';
import { SyncRegistryProcessor } from './sync-registry.processor';
import { StartupSyncService } from './startup-sync.service';

@Module({
  imports: [BullModule.registerQueue({ name: SYNC_REGISTRY_QUEUE })],
  controllers: [LlmOpsController],
  providers: [LlmOpsService, SyncRegistryProcessor, StartupSyncService],
  exports: [LlmOpsService],
})
export class LlmOpsModule {}
