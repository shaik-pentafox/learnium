import { Global, Module } from '@nestjs/common';
import { ModelFactoryService } from './model-factory.service';
import { CheckpointerService } from './checkpointer.service';
import { ScoringService } from './scoring.service';

@Global()
@Module({
  providers: [ModelFactoryService, CheckpointerService, ScoringService],
  exports: [ModelFactoryService, CheckpointerService, ScoringService],
})
export class LlmModule {}
