import { Injectable, Logger } from '@nestjs/common';

/** Named LLM pipelines — grep logs with `llm:<name>`. */
export type LlmFlowName =
  | 'model_resolve'
  | 'roleplay_session'
  | 'roleplay_turn'
  | 'roleplay_invoke'
  | 'scoring'
  | 'persona_enhance';

const PREVIEW_LEN = 120;

/** Truncate long text for debug logs without dumping full prompts/transcripts. */
export function previewText(text: string | undefined | null, max = PREVIEW_LEN): string | undefined {
  if (!text) return undefined;
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…(${text.length} chars total)`;
}

export interface FlowSpan {
  complete: (extra?: Record<string, unknown>) => void;
  fail: (err: unknown, extra?: Record<string, unknown>) => void;
}

/**
 * Structured logger for LLM pipelines. Emits consistent `llm:<flow>` events so you
 * can trace model resolution → graph invoke → streaming → scoring end-to-end.
 *
 * Set `LOG_LEVEL=debug` to see per-step data (message counts, previews, chunk stats).
 */
@Injectable()
export class LlmFlowLogger {
  private readonly logger = new Logger('LlmFlow');

  start(flow: LlmFlowName, ctx: Record<string, unknown> = {}): FlowSpan {
    const startedAt = Date.now();
    this.logger.log({ flow, phase: 'start', ...ctx }, `llm:${flow} start`);

    return {
      complete: (extra = {}) => {
        this.logger.log(
          { flow, phase: 'complete', latencyMs: Date.now() - startedAt, ...ctx, ...extra },
          `llm:${flow} complete`,
        );
      },
      fail: (err, extra = {}) => {
        this.logger.warn(
          { flow, phase: 'error', latencyMs: Date.now() - startedAt, err, ...ctx, ...extra },
          `llm:${flow} error`,
        );
      },
    };
  }

  step(flow: LlmFlowName, step: string, ctx: Record<string, unknown> = {}): void {
    this.logger.debug({ flow, phase: 'step', step, ...ctx }, `llm:${flow} → ${step}`);
  }
}
