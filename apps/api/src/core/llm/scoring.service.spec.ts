import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { ScoringService } from './scoring.service';
import type { PrismaService } from '../database/prisma.service';
import type { ModelFactoryService } from './model-factory.service';
import type { UsageService } from './usage.service';
import type { LlmFlowLogger } from './llm-flow.logger';

interface FakeMessage {
  role: string;
  content: string;
}

function makeSession(messages: FakeMessage[]) {
  return {
    id: 1,
    uid: 'sess-1',
    isSimulation: false,
    feedback: null,
    messages,
    persona: {
      id: 7,
      scoringModelId: 3,
      scoreCriteria: [
        { id: 10, name: 'Empathy', maxScore: 5, description: '', order: 0 },
        { id: 11, name: 'Resolution', maxScore: 10, description: '', order: 1 },
      ],
    },
  };
}

function buildService(session: unknown, structuredResult?: unknown) {
  const createMany = jest.fn();
  const update = jest.fn();
  const prisma = {
    session: {
      findUnique: jest.fn(async () => session),
      update: update as unknown,
    },
    scoreResult: { createMany: createMany as unknown },
    $transaction: jest.fn(async (ops: unknown[]) => ops),
  } as unknown as PrismaService;

  const invoke = jest.fn(async () => structuredResult);
  const models = {
    resolve: jest.fn(async () => ({
      id: 3,
      name: 'gpt',
      providerType: 'openai',
      model: { withStructuredOutput: () => ({ invoke }) },
    })),
  } as unknown as ModelFactoryService;

  const usage = {
    record: jest.fn(),
    estimateTokens: jest.fn(() => 1),
  } as unknown as UsageService;

  const flowLog = {
    step: jest.fn(),
    start: jest.fn(() => ({ complete: jest.fn() })),
  } as unknown as LlmFlowLogger;

  const service = new ScoringService(prisma, models, usage, flowLog);
  return { service, models, prisma, createMany };
}

describe('ScoringService.scoreSession', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('gives 0 on every criterion and skips the LLM when the trainee never responded', async () => {
    // Only the persona (assistant) spoke — trainee ended without responding.
    const session = makeSession([
      { role: 'assistant', content: 'Hi, I was double charged!' },
    ]);
    const { service, models, createMany } = buildService(session);

    const result = await service.scoreSession(1);

    expect(models.resolve).not.toHaveBeenCalled();
    expect(result.scores.map((s) => s.score)).toEqual([0, 0]);
    expect(result.feedback).toMatch(/without responding/i);
    // Persisted, so the poor score is durable.
    expect(createMany).toHaveBeenCalledTimes(1);
  });

  it('clamps an LLM score above the rubric max down to maxScore', async () => {
    const session = makeSession([
      { role: 'assistant', content: 'I was double charged!' },
      { role: 'user', content: 'Let me check your account and refund it.' },
    ]);
    const { service } = buildService(session, {
      scores: [
        { criterionId: 10, score: 99, feedback: 'good' },
        { criterionId: 11, score: 4, feedback: 'ok' },
      ],
      overallFeedback: 'fine',
    });

    const result = await service.scoreSession(1);

    // Empathy max 5 → clamped from 99; Resolution 4 within range.
    expect(result.scores.find((s) => s.criterionId === 10)?.score).toBe(5);
    expect(result.scores.find((s) => s.criterionId === 11)?.score).toBe(4);
  });
});
