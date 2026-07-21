/**
 * Demo data for the leaderboard: completed, scored practice sessions spread
 * across the last 30 days for every trainee.
 *
 *   npm run seed:demo --workspace=apps/api            # insert
 *   npm run seed:demo --workspace=apps/api -- --clean # remove
 *
 * Every row it creates carries a `demo-` uid prefix, so `--clean` removes
 * exactly what this script added and nothing else. Deterministic — re-running
 * replaces the same set rather than piling on duplicates.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const UID_PREFIX = 'demo-';
const WINDOW_DAYS = 28;

/** Deterministic PRNG (mulberry32) — same board on every run. */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Per-trainee shape: how much they practise and how well they score, so the
 *  board shows a real spread instead of four near-identical rows. */
const PROFILES = [
  { sessions: 11, skill: 0.86 },
  { sessions: 8, skill: 0.78 },
  { sessions: 6, skill: 0.69 },
  { sessions: 4, skill: 0.72 },
];

async function clean(): Promise<void> {
  const sessions = await prisma.session.findMany({
    where: { uid: { startsWith: UID_PREFIX } },
    select: { id: true },
  });
  const ids = sessions.map((s) => s.id);
  if (ids.length === 0) {
    console.log('No demo sessions to remove.');
    return;
  }
  await prisma.$transaction([
    prisma.scoreResult.deleteMany({ where: { sessionId: { in: ids } } }),
    prisma.chatMessage.deleteMany({ where: { sessionId: { in: ids } } }),
    prisma.session.deleteMany({ where: { id: { in: ids } } }),
  ]);
  console.log(`Removed ${ids.length} demo sessions.`);
}

async function seed(): Promise<void> {
  const trainees = await prisma.user.findMany({
    where: { isDeleted: false, role: { name: 'USER' } },
    select: { id: true, firstName: true, lastName: true },
    orderBy: { id: 'asc' },
  });
  const personas = await prisma.persona.findMany({
    where: { isDeleted: false, isPublished: true },
    select: { id: true, scoreCriteria: { select: { id: true, maxScore: true } } },
  });

  const usable = personas.filter((p) => p.scoreCriteria.length > 0);
  if (trainees.length === 0 || usable.length === 0) {
    console.error(
      `Need trainees and published personas with score criteria (found ${trainees.length} trainees, ${usable.length} usable personas). Run the main seed first.`,
    );
    process.exit(1);
  }

  await clean();

  const random = rng(20260721);
  let created = 0;

  for (const [i, trainee] of trainees.entries()) {
    const profile = PROFILES[i % PROFILES.length]!;

    for (let n = 0; n < profile.sessions; n++) {
      const persona = usable[Math.floor(random() * usable.length)]!;
      const daysAgo = Math.floor(random() * WINDOW_DAYS);
      const startedAt = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
      const endedAt = new Date(startedAt.getTime() + 8 * 60 * 1000);

      // Skill drifts upward over the window so trainees visibly improve.
      const progress = 1 - daysAgo / WINDOW_DAYS;
      const accuracy = Math.min(
        1,
        Math.max(0.35, profile.skill + progress * 0.12 + (random() - 0.5) * 0.16),
      );

      await prisma.session.create({
        data: {
          uid: `${UID_PREFIX}${trainee.id}-${n}`,
          userId: trainee.id,
          personaId: persona.id,
          status: 'COMPLETED',
          isSimulation: false,
          startedAt,
          endedAt,
          scores: {
            create: persona.scoreCriteria.map((c) => ({
              criterionId: c.id,
              maxScore: c.maxScore,
              score: Math.round(c.maxScore * accuracy * 10) / 10,
            })),
          },
        },
      });
      created++;
    }
    console.log(
      `${trainee.firstName} ${trainee.lastName}: ${profile.sessions} sessions`,
    );
  }

  console.log(`\nSeeded ${created} demo sessions across ${trainees.length} trainees.`);
}

const run = process.argv.includes('--clean') ? clean : seed;

run()
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
