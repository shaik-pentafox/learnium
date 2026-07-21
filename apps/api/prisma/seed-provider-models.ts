/**
 * Attach master-catalog models to a CONFIGURED provider, so a freshly added
 * BYOK provider has usable chat/voice models without clicking through the UI.
 *
 *   npm run seed:models --workspace=apps/api -- --provider 1
 *   npm run seed:models --workspace=apps/api -- --provider Shaik --keys gemini-2.5-flash,gemini-2.0-flash
 *   npm run seed:models --workspace=apps/api -- --provider 1 --kind chat
 *
 * Pricing, context window and voice metadata come from the master row — the
 * catalog stays the single source of truth. Upserts by model name, so
 * re-running refreshes rather than duplicating.
 *
 * Sets a primary (`isDefault`) per kind only when that kind has none yet;
 * an existing primary is never silently reassigned.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main(): Promise<void> {
  const providerArg = arg('--provider');
  if (!providerArg) {
    console.error('Missing --provider <id|name>');
    process.exit(1);
  }
  const kindFilter = arg('--kind');
  const keyFilter = arg('--keys')?.split(',').map((k) => k.trim()).filter(Boolean);

  const id = Number(providerArg);
  const provider = await prisma.llmProvider.findFirst({
    where: Number.isFinite(id) && id > 0 ? { id } : { name: providerArg },
    include: { masterProvider: { include: { models: true } } },
  });

  if (!provider) {
    console.error(`No configured provider matching "${providerArg}".`);
    process.exit(1);
  }
  if (!provider.masterProvider) {
    console.error(
      `Provider "${provider.name}" is a legacy/custom row with no master link — nothing to copy from.`,
    );
    process.exit(1);
  }

  const candidates = provider.masterProvider.models
    .filter((m) => !kindFilter || m.kind === kindFilter)
    .filter((m) => !keyFilter || keyFilter.includes(m.key));

  if (candidates.length === 0) {
    console.error('No master models matched the given filters.');
    process.exit(1);
  }

  for (const m of candidates) {
    const data = {
      providerId: provider.id,
      kind: m.kind,
      masterModelId: m.id,
      capabilities: m.kind === 'voice' ? ['voice'] : ['chat'],
      contextWindowTokens: m.contextWindowTokens,
      inputPricePerMillion: m.inputPricePerMillion,
      outputPricePerMillion: m.outputPricePerMillion,
    };
    await prisma.llmModel.upsert({
      where: { name: m.key },
      update: data,
      create: { name: m.key, ...data },
    });
    console.log(`  ${m.kind.padEnd(5)} ${m.key}`);
  }

  // Explicit promotion — `--primary <model-key>` repoints the primary for that
  // model's kind, needed when the current primary is one the provider has since
  // withdrawn (listed by the API but 404/429 on use).
  const primaryKey = arg('--primary');
  if (primaryKey) {
    const target = await prisma.llmModel.findUnique({ where: { name: primaryKey } });
    if (!target) {
      console.error(`--primary "${primaryKey}" is not a configured model.`);
      process.exit(1);
    }
    await prisma.$transaction([
      prisma.llmModel.updateMany({
        where: { kind: target.kind, isDefault: true },
        data: { isDefault: false },
      }),
      prisma.llmModel.update({ where: { id: target.id }, data: { isDefault: true } }),
    ]);
    console.log(`primary ${target.kind}: ${target.name} (explicit)`);
  }

  // Promote a primary per kind when the registry has none — the chat engine and
  // voice factory both fall back to the primary when a persona pins nothing.
  for (const kind of ['chat', 'voice']) {
    const existing = await prisma.llmModel.findFirst({
      where: { kind, isDefault: true, provider: { isEnabled: true } },
    });
    if (existing) {
      console.log(`primary ${kind}: unchanged (${existing.name})`);
      continue;
    }
    const first = await prisma.llmModel.findFirst({
      where: { kind, providerId: provider.id },
      orderBy: { id: 'asc' },
    });
    if (!first) continue;
    await prisma.llmModel.update({ where: { id: first.id }, data: { isDefault: true } });
    console.log(`primary ${kind}: ${first.name}`);
  }

  console.log(`\nAttached ${candidates.length} model(s) to "${provider.name}".`);
}

main()
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
