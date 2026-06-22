import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { ScoringService } from '../../../core/llm/scoring.service';
import { LlmFlowLogger } from '../../../core/llm/llm-flow.logger';
import { SCORE_SESSION_QUEUE } from '../sessions.service';

interface ScoreJobData {
  sessionId: number;
  uid: string;
}

@Processor(SCORE_SESSION_QUEUE)
export class ScoringProcessor extends WorkerHost {
  private readonly logger = new Logger(ScoringProcessor.name);

  constructor(
    private readonly scoringService: ScoringService,
    private readonly flowLog: LlmFlowLogger,
  ) {
    super();
  }

  override async process(job: Job<ScoreJobData>): Promise<void> {
    this.flowLog.step('scoring', 'queue_job_start', {
      sessionId: job.data.sessionId,
      sessionUid: job.data.uid,
      jobId: job.id,
    });
    try {
      await this.scoringService.scoreSession(job.data.sessionId);
    } catch (err) {
      this.logger.error({ err, jobId: job.id }, 'Queued scoring job failed');
      throw err;
    }
  }
}
