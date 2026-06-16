import { Module } from '@nestjs/common';
import { LlmOpsController } from './llm-ops.controller';
import { LlmOpsService } from './llm-ops.service';

@Module({
  controllers: [LlmOpsController],
  providers: [LlmOpsService],
  exports: [LlmOpsService],
})
export class LlmOpsModule {}
