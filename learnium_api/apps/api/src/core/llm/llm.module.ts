import { Global, Module } from '@nestjs/common';
import { LlmClientService } from './llm-client.service';
import { ScoringService } from './scoring.service';

@Global()
@Module({
  providers: [LlmClientService, ScoringService],
  exports: [LlmClientService, ScoringService],
})
export class LlmModule {}
