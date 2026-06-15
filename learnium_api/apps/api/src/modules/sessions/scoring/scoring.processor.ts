import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { ScoringService } from '../../../core/llm/scoring.service';
import { SCORE_SESSION_QUEUE } from '../sessions.service';

interface ScoreJobData {
  sessionId: number;
  uid: string;
}

@Processor(SCORE_SESSION_QUEUE)
export class ScoringProcessor extends WorkerHost {
  constructor(private readonly scoringService: ScoringService) {
    super();
  }

  override async process(job: Job<ScoreJobData>): Promise<void> {
    await this.scoringService.scoreSession(job.data.sessionId);
  }
}
