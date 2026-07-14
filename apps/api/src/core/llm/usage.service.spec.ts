import { describe, it, expect } from '@jest/globals';
import { UsageService, type RecordUsageInput } from './usage.service';

/** Minimal prisma double: one model row + a capture of the written usage row. */
function makePrisma(model: Record<string, unknown> | null) {
  const created: Array<Record<string, unknown>> = [];
  return {
    created,
    prisma: {
      llmModel: {
        findUnique: async () => model,
      },
      llmUsage: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          return data;
        },
      },
    },
  };
}

const base: RecordUsageInput = {
  kind: 'voice',
  modelId: 1,
  modelName: 'test',
  inputTokens: 0,
  outputTokens: 0,
  estimated: false,
};

describe('UsageService.computeCost (via record)', () => {
  it('prices token-billed models per 1M tokens', async () => {
    const { prisma, created } = makePrisma({
      pricingUnit: 'token',
      inputPricePerMillion: 2,
      outputPricePerMillion: 8,
      inputPricePerMinute: null,
      outputPricePerMinute: null,
    });
    const svc = new UsageService(prisma as never);

    await svc.record({ ...base, inputTokens: 1_000_000, outputTokens: 500_000 });

    // 2 (1M @ $2) + 4 (0.5M @ $8)
    expect(created[0]!.costUsd).toBe(6);
  });

  it('ignores audio seconds for token-billed models', async () => {
    const { prisma, created } = makePrisma({
      pricingUnit: 'token',
      inputPricePerMillion: 32,
      outputPricePerMillion: 64,
      inputPricePerMinute: null,
      outputPricePerMinute: null,
    });
    const svc = new UsageService(prisma as never);

    await svc.record({
      ...base,
      inputTokens: 1000,
      outputTokens: 2000,
      inputAudioSeconds: 600,
      outputAudioSeconds: 600,
    });

    // 32*1000/1e6 + 64*2000/1e6 = 0.032 + 0.128 = 0.16 (audio seconds ignored)
    expect(created[0]!.costUsd).toBe(0.16);
  });

  it('prices per-minute voice models by audio duration', async () => {
    const { prisma, created } = makePrisma({
      pricingUnit: 'minute',
      inputPricePerMillion: null,
      outputPricePerMillion: null,
      inputPricePerMinute: 0.006, // Whisper-style STT
      outputPricePerMinute: 0.5, // per-minute TTS
    });
    const svc = new UsageService(prisma as never);

    await svc.record({
      ...base,
      inputTokens: 9999, // must NOT be billed on a minute model
      outputTokens: 9999,
      inputAudioSeconds: 120, // 2 min → 0.012
      outputAudioSeconds: 60, // 1 min → 0.5
    });

    expect(created[0]!.costUsd).toBe(0.512);
  });

  it('costs a per-minute model at 0 when no audio duration is reported', async () => {
    const { prisma, created } = makePrisma({
      pricingUnit: 'minute',
      inputPricePerMillion: null,
      outputPricePerMillion: null,
      inputPricePerMinute: 0.006,
      outputPricePerMinute: 0.5,
    });
    const svc = new UsageService(prisma as never);

    await svc.record({ ...base, inputTokens: 1000, outputTokens: 1000 });

    expect(created[0]!.costUsd).toBe(0);
  });

  it('costs 0 when no model id is given', async () => {
    const { prisma, created } = makePrisma(null);
    const svc = new UsageService(prisma as never);

    await svc.record({ ...base, modelId: null, inputTokens: 100, outputTokens: 100 });

    expect(created[0]!.costUsd).toBe(0);
  });

  it('inherits pricing from the master when own fields are null', async () => {
    // Master-linked row: own pricing NULL → resolve from masterModel.
    const { prisma, created } = makePrisma({
      pricingUnit: null,
      inputPricePerMillion: null,
      outputPricePerMillion: null,
      inputPricePerMinute: null,
      outputPricePerMinute: null,
      masterModel: {
        pricingUnit: 'token',
        inputPricePerMillion: 2,
        outputPricePerMillion: 8,
        inputPricePerMinute: null,
        outputPricePerMinute: null,
      },
    });
    const svc = new UsageService(prisma as never);

    await svc.record({ ...base, inputTokens: 1_000_000, outputTokens: 500_000 });

    expect(created[0]!.costUsd).toBe(6);
  });

  it('prefers the row override over the master value', async () => {
    const { prisma, created } = makePrisma({
      pricingUnit: 'token',
      inputPricePerMillion: 1, // override
      outputPricePerMillion: 1, // override
      inputPricePerMinute: null,
      outputPricePerMinute: null,
      masterModel: {
        pricingUnit: 'token',
        inputPricePerMillion: 99,
        outputPricePerMillion: 99,
        inputPricePerMinute: null,
        outputPricePerMinute: null,
      },
    });
    const svc = new UsageService(prisma as never);

    await svc.record({ ...base, inputTokens: 1_000_000, outputTokens: 1_000_000 });

    // Override wins: 1 + 1, not 99 + 99.
    expect(created[0]!.costUsd).toBe(2);
  });
});
