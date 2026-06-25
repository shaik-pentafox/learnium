/**
 * Standalone LLM registry seed — providers + models only, NO API keys.
 *
 * Keys are added by a Super Admin in the UI (BYOK, encrypted at rest), so this
 * seed deliberately leaves `credentialRef` null. Run it independently of the
 * main seed:
 *
 *   npx ts-node --project tsconfig.json prisma/seed-llm.ts
 *   # or: npm run seed:llm  (from apps/api)
 *
 * Pricing / context windows are real values pulled from provider docs (Jun
 * 2026) and are fully editable in the UI afterwards.
 *   - gpt-4o-mini   : $0.15 / $0.60 per 1M, 128K ctx
 *   - gpt-4o        : $2.50 / $10.00 per 1M, 128K ctx
 *   - gemini-2.5-flash      : $0.30 / $2.50 per 1M, 1M ctx
 *   - gemini-2.5-flash-lite : $0.10 / $0.40 per 1M, 1M ctx
 *   - gemini-2.5-pro        : $1.25 / $10.00 per 1M, 1M ctx
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface SeedProvider {
  name: string;
  /** Factory key: 'openai' → ChatOpenAI, 'gemini' → ChatGoogleGenerativeAI. */
  type: string;
  priority: number;
}

interface SeedModel {
  name: string;
  providerName: string;
  capabilities: string[];
  contextWindowTokens: number;
  inputPricePerMillion: number;
  outputPricePerMillion: number;
  isDefault?: boolean;
}

const PROVIDERS: SeedProvider[] = [
  { name: 'OpenAI', type: 'openai', priority: 10 },
  { name: 'Google Gemini', type: 'gemini', priority: 20 },
];

const MODELS: SeedModel[] = [
  // OpenAI
  {
    name: 'gpt-4o-mini',
    providerName: 'OpenAI',
    capabilities: ['conversation', 'scoring', 'vision'],
    contextWindowTokens: 128_000,
    inputPricePerMillion: 0.15,
    outputPricePerMillion: 0.6,
    isDefault: true, // cheap, capable default
  },
  {
    name: 'gpt-4o',
    providerName: 'OpenAI',
    capabilities: ['conversation', 'scoring', 'vision', 'tools'],
    contextWindowTokens: 128_000,
    inputPricePerMillion: 2.5,
    outputPricePerMillion: 10.0,
  },
  // Google Gemini
  {
    name: 'gemini-2.5-flash',
    providerName: 'Google Gemini',
    capabilities: ['conversation', 'scoring', 'vision'],
    contextWindowTokens: 1_048_576,
    inputPricePerMillion: 0.3,
    outputPricePerMillion: 2.5,
  },
  {
    name: 'gemini-2.5-flash-lite',
    providerName: 'Google Gemini',
    capabilities: ['conversation', 'scoring'],
    contextWindowTokens: 1_048_576,
    inputPricePerMillion: 0.1,
    outputPricePerMillion: 0.4,
  },
  {
    name: 'gemini-2.5-pro',
    providerName: 'Google Gemini',
    capabilities: ['conversation', 'scoring', 'vision', 'tools'],
    contextWindowTokens: 1_048_576,
    inputPricePerMillion: 1.25,
    outputPricePerMillion: 10.0,
  },
];

async function main() {
  const providerIdByName = new Map<string, number>();
  for (const p of PROVIDERS) {
    // No credentialRef — the API key is added later in the UI (BYOK).
    const provider = await prisma.llmProvider.upsert({
      where: { name: p.name },
      update: { type: p.type, priority: p.priority },
      create: { name: p.name, type: p.type, priority: p.priority, isEnabled: true },
    });
    providerIdByName.set(p.name, provider.id);
  }

  for (const m of MODELS) {
    const providerId = providerIdByName.get(m.providerName);
    if (providerId == null) throw new Error(`Unknown provider: ${m.providerName}`);
    await prisma.llmModel.upsert({
      where: { name: m.name },
      update: {
        providerId,
        capabilities: m.capabilities,
        contextWindowTokens: m.contextWindowTokens,
        inputPricePerMillion: m.inputPricePerMillion,
        outputPricePerMillion: m.outputPricePerMillion,
        isDefault: m.isDefault ?? false,
      },
      create: {
        name: m.name,
        providerId,
        capabilities: m.capabilities,
        contextWindowTokens: m.contextWindowTokens,
        inputPricePerMillion: m.inputPricePerMillion,
        outputPricePerMillion: m.outputPricePerMillion,
        isDefault: m.isDefault ?? false,
      },
    });
  }

  // Exactly one default model (last write wins if multiple flagged).
  const defaults = MODELS.filter((m) => m.isDefault).map((m) => m.name);
  if (defaults.length > 0) {
    await prisma.llmModel.updateMany({
      where: { name: { notIn: defaults } },
      data: { isDefault: false },
    });
  }

  console.log('LLM registry seeded (no keys — add them in the UI):');
  console.log(`  Providers : ${PROVIDERS.map((p) => p.name).join(', ')}`);
  console.log(`  Models    : ${MODELS.map((m) => m.name).join(', ')}`);
  console.log(`  Default   : ${defaults.join(', ') || '(none)'}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
