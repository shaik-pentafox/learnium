import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema';

/**
 * Wire LangSmith tracing for LangChain.js / LangGraph.js.
 *
 * LangChain reads tracing config from `process.env` at model-construction time
 * (not via Nest DI). Our chat models are built lazily on first resolve, so
 * exporting the `LANGSMITH_*` vars here — during bootstrap, before any request —
 * is early enough for every trace to be captured.
 *
 * We validate them through our own typed env schema first, then re-export them
 * so the tracer (which only reads raw `process.env`) sees the same values.
 *
 * Governance: when enabled, prompts + completions leave our infra for LangSmith.
 * With BYOK keys + roleplay content that is a deliberate call — keep it off in
 * prod unless approved. See docs/LANGSMITH_SETUP.md.
 */
export function configureLangSmith(config: ConfigService<Env, true>): void {
  const logger = new Logger('LangSmith');
  const enabled = config.get('LANGSMITH_TRACING', { infer: true });

  if (!enabled) {
    logger.log('Tracing disabled (LANGSMITH_TRACING=false)');
    return;
  }

  const apiKey = config.get('LANGSMITH_API_KEY', { infer: true });
  if (!apiKey) {
    logger.warn('LANGSMITH_TRACING=true but LANGSMITH_API_KEY is missing — tracing NOT enabled');
    return;
  }

  const project = config.get('LANGSMITH_PROJECT', { infer: true });
  const endpoint = config.get('LANGSMITH_ENDPOINT', { infer: true });

  // Canonical vars the langsmith SDK (>=0.3) / @langchain/core 1.x tracer reads.
  process.env.LANGSMITH_TRACING = 'true';
  process.env.LANGSMITH_API_KEY = apiKey;
  process.env.LANGSMITH_PROJECT = project;
  process.env.LANGSMITH_ENDPOINT = endpoint;

  logger.log(`Tracing enabled → project "${project}" (${endpoint})`);
}
