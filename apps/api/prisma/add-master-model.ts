/**
 * Ad-hoc master-model registration — add a chat or voice model to the master
 * catalog without editing seed-llm.ts. Upserts by (provider, key), so re-running
 * with the same key updates the row. Reseeding never deletes rows added here.
 *
 * Usage (from apps/api):
 *
 *   # Voice model (S2S)
 *   npm run model:add -- --provider google --kind voice \
 *     --key gemini-3.1-flash-live-preview --name "Gemini 3.1 Flash Live" \
 *     --pipeline s2s --languages en-IN,hi-IN,ta-IN \
 *     --voices Puck,Charon,Kore --in 3 --out 12
 *
 *   # Chat model
 *   npm run model:add -- --provider openai --kind chat \
 *     --key gpt-5-mini --name "GPT-5 Mini" --ctx 400000 --in 0.25 --out 2
 *
 * --provider is the master provider KEY: openai | google | anthropic.
 * --in/--out are $ per 1M tokens (text tokens for chat, audio tokens for voice).
 * After adding, the model appears in LLM Ops → Add model for any configured
 * provider of that master.
 */
import { parseArgs } from 'node:util';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const { values } = parseArgs({
  options: {
    provider: { type: 'string' },
    kind: { type: 'string' },
    key: { type: 'string' },
    name: { type: 'string' },
    pipeline: { type: 'string' }, // voice: s2s | stt+tts
    languages: { type: 'string' }, // voice: comma-separated BCP-47
    voices: { type: 'string' }, // voice: comma-separated voice ids
    ctx: { type: 'string' }, // chat: context window tokens
    in: { type: 'string' }, // $/1M input
    out: { type: 'string' }, // $/1M output
  },
});

function fail(msg: string): never {
  console.error(`✗ ${msg}`);
  console.error('Run with the usage shown at the top of prisma/add-master-model.ts');
  process.exit(1);
}

const csv = (v: string | undefined) =>
  v ? v.split(',').map((s) => s.trim()).filter(Boolean) : [];

async function main() {
  const providerKey = values.provider ?? fail('--provider is required (openai|google|anthropic)');
  const kind = values.kind ?? fail('--kind is required (chat|voice)');
  const key = values.key ?? fail('--key is required (provider model id)');
  const name = values.name ?? key;
  if (kind !== 'chat' && kind !== 'voice') fail(`--kind must be chat or voice, got '${kind}'`);
  if (kind === 'voice' && !values.pipeline) fail('--pipeline is required for voice (s2s|stt+tts)');

  const master = await prisma.masterProvider.findUnique({ where: { key: providerKey } });
  if (!master) {
    const known = await prisma.masterProvider.findMany({ select: { key: true } });
    fail(`Unknown master provider '${providerKey}'. Known: ${known.map((p) => p.key).join(', ')}`);
  }
  if (!master.supports.includes(kind)) {
    console.warn(`⚠ ${master.name} is not marked as supporting '${kind}' — adding anyway.`);
  }

  const data = {
    name,
    kind,
    contextWindowTokens: values.ctx ? parseInt(values.ctx, 10) : null,
    inputPricePerMillion: values.in ? parseFloat(values.in) : null,
    outputPricePerMillion: values.out ? parseFloat(values.out) : null,
    voicePipeline: kind === 'voice' ? (values.pipeline ?? null) : null,
    languages: csv(values.languages),
    voices: csv(values.voices),
  };

  const row = await prisma.masterModel.upsert({
    where: { masterProviderId_key: { masterProviderId: master.id, key } },
    update: data,
    create: { masterProviderId: master.id, key, ...data },
  });

  console.log(`✓ Master model upserted: [${master.name}] ${row.name} (${row.kind})`);
  console.log(`  key: ${row.key}  id: ${row.id}`);
  if (row.kind === 'voice') {
    console.log(`  pipeline: ${row.voicePipeline}  languages: ${row.languages.join(', ') || '—'}`);
    console.log(`  voices: ${row.voices.join(', ') || '—'}`);
  } else {
    console.log(
      `  ctx: ${row.contextWindowTokens ?? '—'}  $in/out per 1M: ${row.inputPricePerMillion ?? '—'}/${row.outputPricePerMillion ?? '—'}`,
    );
  }
  console.log('Now add it in LLM Ops → Models → Add model.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
