import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import type { Env } from '../config/env.schema';

/**
 * Durable LangGraph checkpointer. One PostgresSaver for the whole process; every
 * per-session roleplay graph shares it. `thread_id = session.uid` keys the
 * conversation state, so any replica can resume a session from Postgres
 * (replaces the legacy in-memory MemorySaver that lost state on restart).
 */
@Injectable()
export class CheckpointerService implements OnModuleInit {
  private readonly logger = new Logger(CheckpointerService.name);
  readonly saver: PostgresSaver;

  constructor(config: ConfigService<Env, true>) {
    this.saver = PostgresSaver.fromConnString(
      config.get('DATABASE_URL', { infer: true }),
    );
  }

  async onModuleInit(): Promise<void> {
    // Idempotent — creates the checkpoint tables if absent.
    await this.saver.setup();
    this.logger.log('LangGraph PostgresSaver ready');
  }
}
