import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { SessionsController } from './sessions.controller';
import { SessionsService, SCORE_SESSION_QUEUE } from './sessions.service';
import { ScoringProcessor } from './scoring/scoring.processor';

@Module({
  imports: [BullModule.registerQueue({ name: SCORE_SESSION_QUEUE })],
  controllers: [SessionsController],
  providers: [SessionsService, ScoringProcessor],
  exports: [SessionsService],
})
export class SessionsModule {}
