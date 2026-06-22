import { Global, Module } from '@nestjs/common';
import { ModelFactoryService } from './model-factory.service';
import { CheckpointerService } from './checkpointer.service';
import { ScoringService } from './scoring.service';
import { UsageService } from './usage.service';
import { LlmFlowLogger } from './llm-flow.logger';

@Global()
@Module({
  providers: [
    ModelFactoryService,
    CheckpointerService,
    ScoringService,
    UsageService,
    LlmFlowLogger,
  ],
  exports: [
    ModelFactoryService,
    CheckpointerService,
    ScoringService,
    UsageService,
    LlmFlowLogger,
  ],
})
export class LlmModule {}
