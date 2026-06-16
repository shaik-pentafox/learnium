import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { SessionsController } from './sessions.controller';
import { SessionsService, SCORE_SESSION_QUEUE } from './sessions.service';
import { ScoringProcessor } from './scoring/scoring.processor';
import { SessionReaperService } from './session-reaper.service';

@Module({
  imports: [BullModule.registerQueue({ name: SCORE_SESSION_QUEUE })],
  controllers: [SessionsController],
  providers: [SessionsService, ScoringProcessor, SessionReaperService],
  exports: [SessionsService],
})
export class SessionsModule {}
