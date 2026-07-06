/**
 * Master catalog seed — the provider/model catalog admins configure FROM.
 *
 * Seeds `master_providers` + `master_models` (chat + voice), upserting by key so
 * re-running refreshes the catalog (new models arrive by re-running this seed —
 * no code change). NO API keys and NO configured providers are created here:
 * a Super Admin picks a master provider in the UI and supplies a key (BYOK,
 * encrypted at rest) to create the configured `llm_providers` row.
 *
 * Also backfills legacy rows: pre-masters `llm_providers` / `llm_models` rows
 * are linked to their master by type/name match so existing setups keep working.
 *
 *   npm run seed:llm   (from apps/api)
 *
 * Pricing / context windows pulled from provider docs (Jul 2026); chat prices
 * are per 1M text tokens, voice prices per 1M audio tokens.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface SeedMasterProvider {
  key: string;
  name: string;
  /** Runtime construct branch: 'openai' | 'gemini' | 'anthropic'. */
  adapterType: string;
  defaultBaseUrl?: string;
  supports: string[]; // ['chat'] | ['chat','voice'] | ['voice']
}

interface SeedMasterModel {
  providerKey: string;
  key: string; // provider-side model id
  name: string; // display
  kind: 'chat' | 'voice';
  contextWindowTokens?: number;
  inputPricePerMillion?: number;
  outputPricePerMillion?: number;
  voicePipeline?: 's2s' | 'stt+tts';
  languages?: string[];
  voices?: string[];
}

const MASTER_PROVIDERS: SeedMasterProvider[] = [
  { key: 'openai', name: 'OpenAI', adapterType: 'openai', supports: ['chat', 'voice'] },
  { key: 'google', name: 'Google Gemini', adapterType: 'gemini', supports: ['chat', 'voice'] },
  { key: 'anthropic', name: 'Anthropic', adapterType: 'anthropic', supports: ['chat'] },
];

const MASTER_MODELS: SeedMasterModel[] = [
  // ── OpenAI chat ──
  {
    providerKey: 'openai', key: 'gpt-4o-mini', name: 'GPT-4o Mini', kind: 'chat',
    contextWindowTokens: 128_000, inputPricePerMillion: 0.15, outputPricePerMillion: 0.6,
  },
  {
    providerKey: 'openai', key: 'gpt-4o', name: 'GPT-4o', kind: 'chat',
    contextWindowTokens: 128_000, inputPricePerMillion: 2.5, outputPricePerMillion: 10.0,
  },
  {
    providerKey: 'openai', key: 'gpt-4.1', name: 'GPT-4.1', kind: 'chat',
    contextWindowTokens: 1_047_576, inputPricePerMillion: 2.0, outputPricePerMillion: 8.0,
  },
  {
    providerKey: 'openai', key: 'gpt-4.1-mini', name: 'GPT-4.1 Mini', kind: 'chat',
    contextWindowTokens: 1_047_576, inputPricePerMillion: 0.4, outputPricePerMillion: 1.6,
  },
  {
    providerKey: 'openai', key: 'gpt-4.1-nano', name: 'GPT-4.1 Nano', kind: 'chat',
    contextWindowTokens: 1_047_576, inputPricePerMillion: 0.1, outputPricePerMillion: 0.4,
  },
  // ── OpenAI voice (GA S2S models, prices per 1M audio tokens). The old
  //    gpt-4o-*-realtime-preview models were retired with the beta API. ──
  {
    providerKey: 'openai', key: 'gpt-realtime', name: 'GPT Realtime', kind: 'voice',
    voicePipeline: 's2s',
    inputPricePerMillion: 32.0, outputPricePerMillion: 64.0,
    languages: ['en-IN', 'hi-IN'],
    voices: ['alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse', 'marin', 'cedar'],
  },
  {
    providerKey: 'openai', key: 'gpt-realtime-mini', name: 'GPT Realtime Mini', kind: 'voice',
    voicePipeline: 's2s',
    inputPricePerMillion: 10.0, outputPricePerMillion: 20.0,
    languages: ['en-IN', 'hi-IN'],
    voices: ['alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse', 'marin', 'cedar'],
  },
  // ── Google chat ──
  {
    providerKey: 'google', key: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', kind: 'chat',
    contextWindowTokens: 1_048_576, inputPricePerMillion: 0.3, outputPricePerMillion: 2.5,
  },
  {
    providerKey: 'google', key: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite', kind: 'chat',
    contextWindowTokens: 1_048_576, inputPricePerMillion: 0.1, outputPricePerMillion: 0.4,
  },
  {
    providerKey: 'google', key: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', kind: 'chat',
    contextWindowTokens: 1_048_576, inputPricePerMillion: 1.25, outputPricePerMillion: 10.0,
  },
  {
    providerKey: 'google', key: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', kind: 'chat',
    contextWindowTokens: 1_048_576, inputPricePerMillion: 0.1, outputPricePerMillion: 0.4,
  },
  // ── Google voice (S2S Live API, prices per 1M audio tokens) ──
  {
    providerKey: 'google', key: 'gemini-2.0-flash-live-001', name: 'Gemini 2.0 Flash Live', kind: 'voice',
    voicePipeline: 's2s',
    inputPricePerMillion: 2.1, outputPricePerMillion: 8.5,
    languages: ['en-IN', 'hi-IN', 'bn-IN', 'ta-IN', 'te-IN', 'mr-IN', 'gu-IN', 'kn-IN', 'ml-IN'],
    voices: ['Puck', 'Charon', 'Kore', 'Fenrir', 'Aoede', 'Leda', 'Orus', 'Zephyr'],
  },
  {
    providerKey: 'google', key: 'gemini-2.5-flash-preview-native-audio-dialog', name: 'Gemini 2.5 Flash Native Audio', kind: 'voice',
    voicePipeline: 's2s',
    inputPricePerMillion: 3.0, outputPricePerMillion: 12.0,
    languages: ['en-IN', 'hi-IN', 'bn-IN', 'ta-IN', 'te-IN', 'mr-IN', 'gu-IN', 'kn-IN', 'ml-IN'],
    voices: ['Puck', 'Charon', 'Kore', 'Fenrir', 'Aoede', 'Leda', 'Orus', 'Zephyr'],
  },
  {
    providerKey: 'google', key: 'gemini-3.1-flash-live-preview', name: 'Gemini 3.1 Flash Live (Preview)', kind: 'voice',
    voicePipeline: 's2s',
    inputPricePerMillion: 3.0, outputPricePerMillion: 12.0,
    languages: ['en-IN', 'hi-IN', 'bn-IN', 'ta-IN', 'te-IN', 'mr-IN', 'gu-IN', 'kn-IN', 'ml-IN'],
    voices: ['Puck', 'Charon', 'Kore', 'Fenrir', 'Aoede', 'Leda', 'Orus', 'Zephyr'],
  },
  // ── Anthropic chat ──
  {
    providerKey: 'anthropic', key: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', kind: 'chat',
    contextWindowTokens: 200_000, inputPricePerMillion: 3.0, outputPricePerMillion: 15.0,
  },
  {
    providerKey: 'anthropic', key: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', kind: 'chat',
    contextWindowTokens: 200_000, inputPricePerMillion: 1.0, outputPricePerMillion: 5.0,
  },
];

/** Legacy configured-provider `type` → master provider key. */
const LEGACY_TYPE_TO_MASTER: Record<string, string> = {
  openai: 'openai',
  gemini: 'google',
  anthropic: 'anthropic',
};

/** Retired provider model ids → their replacements. Remapped in place so
 *  existing configured rows (and personas pointing at them) keep working. */
const RETIRED_MODEL_KEYS: Record<string, string> = {
  'gpt-4o-realtime-preview': 'gpt-realtime',
  'gpt-4o-mini-realtime-preview': 'gpt-realtime-mini',
};

async function main() {
  // 0. Remap retired model keys BEFORE upserting, so the upsert updates the
  //    renamed row instead of creating a duplicate. Configured llm_models rows
  //    carry the provider model id in `name` — rename those too.
  for (const [oldKey, newKey] of Object.entries(RETIRED_MODEL_KEYS)) {
    const renamedMasters = await prisma.masterModel.updateMany({
      where: { key: oldKey },
      data: { key: newKey },
    });
    const renamedConfigured = await prisma.llmModel.updateMany({
      where: { name: oldKey },
      data: { name: newKey },
    });
    if (renamedMasters.count > 0 || renamedConfigured.count > 0) {
      console.log(`Remapped retired model ${oldKey} → ${newKey}`);
    }
  }

  // 1. Masters (upsert by key — re-running refreshes the catalog).
  const providerIdByKey = new Map<string, number>();
  for (const p of MASTER_PROVIDERS) {
    const row = await prisma.masterProvider.upsert({
      where: { key: p.key },
      update: {
        name: p.name,
        adapterType: p.adapterType,
        defaultBaseUrl: p.defaultBaseUrl ?? null,
        supports: p.supports,
      },
      create: {
        key: p.key,
        name: p.name,
        adapterType: p.adapterType,
        defaultBaseUrl: p.defaultBaseUrl ?? null,
        supports: p.supports,
      },
    });
    providerIdByKey.set(p.key, row.id);
  }

  const modelIdByKey = new Map<string, number>();
  for (const m of MASTER_MODELS) {
    const masterProviderId = providerIdByKey.get(m.providerKey);
    if (masterProviderId == null) throw new Error(`Unknown master provider: ${m.providerKey}`);
    const data = {
      name: m.name,
      kind: m.kind,
      contextWindowTokens: m.contextWindowTokens ?? null,
      inputPricePerMillion: m.inputPricePerMillion ?? null,
      outputPricePerMillion: m.outputPricePerMillion ?? null,
      voicePipeline: m.voicePipeline ?? null,
      languages: m.languages ?? [],
      voices: m.voices ?? [],
    };
    const row = await prisma.masterModel.upsert({
      where: { masterProviderId_key: { masterProviderId, key: m.key } },
      update: data,
      create: { masterProviderId, key: m.key, ...data },
    });
    modelIdByKey.set(`${m.providerKey}/${m.key}`, row.id);
  }

  // 2. Backfill: link legacy configured rows to their masters (best-effort).
  let linkedProviders = 0;
  let linkedModels = 0;
  const legacyProviders = await prisma.llmProvider.findMany({
    where: { masterProviderId: null },
    include: { models: true },
  });
  for (const lp of legacyProviders) {
    const masterKey = LEGACY_TYPE_TO_MASTER[lp.type];
    const masterProviderId = masterKey ? providerIdByKey.get(masterKey) : undefined;
    if (masterProviderId == null) continue; // custom/unknown type stays legacy
    await prisma.llmProvider.update({
      where: { id: lp.id },
      data: { masterProviderId },
    });
    linkedProviders++;
    for (const lm of lp.models) {
      const masterModelId = modelIdByKey.get(`${masterKey}/${lm.name}`);
      if (masterModelId == null) continue; // unknown model name stays legacy
      await prisma.llmModel.update({
        where: { id: lm.id },
        data: { masterModelId, kind: 'chat' },
      });
      linkedModels++;
    }
  }

  const chatCount = MASTER_MODELS.filter((m) => m.kind === 'chat').length;
  const voiceCount = MASTER_MODELS.filter((m) => m.kind === 'voice').length;
  console.log('Master catalog seeded:');
  console.log(`  Providers    : ${MASTER_PROVIDERS.map((p) => p.name).join(', ')}`);
  console.log(`  Chat models  : ${chatCount}, Voice models: ${voiceCount}`);
  console.log(`  Backfilled   : ${linkedProviders} provider(s), ${linkedModels} model(s) linked to masters`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
