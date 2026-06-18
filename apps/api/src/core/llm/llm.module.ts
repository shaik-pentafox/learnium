import { Global, Module } from '@nestjs/common';
import { ModelFactoryService } from './model-factory.service';
import { CheckpointerService } from './checkpointer.service';
import { ScoringService } from './scoring.service';
import { UsageService } from './usage.service';

@Global()
@Module({
  providers: [
    ModelFactoryService,
    CheckpointerService,
    ScoringService,
    UsageService,
  ],
  exports: [
    ModelFactoryService,
    CheckpointerService,
    ScoringService,
    UsageService,
  ],
})
export class LlmModule {}
