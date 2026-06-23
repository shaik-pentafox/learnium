import { PrismaClient, Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import {
  renderSystemPrompt,
  type PersonaTemplate,
} from '../src/core/llm/persona-prompt.template';

const prisma = new PrismaClient();

interface SeedCriterion {
  name: string;
  description?: string;
  maxScore: number;
  weight: number;
  order: number;
}

interface SeedPersona {
  name: string;
  description: string;
  template: PersonaTemplate;
  criteria: SeedCriterion[];
}

// Sample customer-care training personas (the simulated customer the trainee
// support agent practises against). Varied emotion / channel / difficulty.
const SEED_PERSONAS: SeedPersona[] = [
  {
    name: 'Double-charged Dana',
    description: 'Frustrated premium customer disputing a duplicate charge.',
    template: {
      customerName: 'Dana',
      customerProfile: 'Premium subscriber for 3 years, pays by auto-debit.',
      company: 'Nimbus Telecom',
      productContext: 'Unlimited plan, billed monthly.',
      issue: 'Charged twice for this month’s bill.',
      channel: 'chat',
      emotion: 'frustrated',
      intensity: 4,
      desiredOutcome: 'A refund of the duplicate charge.',
      hiddenDetails:
        'You switched plans mid-cycle, which you suspect may be related — mention only if asked.',
      resolutionCriteria:
        'the agent confirms the duplicate charge will be refunded and gives a timeframe',
    },
    criteria: [
      { name: 'Empathy', description: 'Acknowledges the frustration sincerely.', maxScore: 10, weight: 2, order: 0 },
      { name: 'Problem resolution', description: 'Confirms the refund and a timeframe.', maxScore: 20, weight: 2, order: 1 },
      { name: 'Active listening', description: 'Surfaces the mid-cycle plan switch.', maxScore: 10, weight: 1, order: 2 },
    ],
  },
  {
    name: 'Angry Alex',
    description: 'Irate customer whose order arrived damaged; threatens to cancel.',
    template: {
      customerName: 'Alex',
      customerProfile: 'New customer, first order with the company.',
      company: 'Vertex Appliances',
      productContext: 'Ordered a coffee machine, arrived with a cracked casing.',
      issue: 'The product arrived damaged and you want it sorted now.',
      channel: 'audio',
      emotion: 'angry',
      intensity: 5,
      desiredOutcome: 'A replacement shipped immediately at no cost.',
      behaviorNotes:
        'You interrupt, raise your voice, and threaten to cancel and post a bad review if not helped quickly.',
      resolutionCriteria:
        'the agent commits to a free replacement and an expedited shipping date',
    },
    criteria: [
      { name: 'De-escalation', description: 'Calms the customer without conceding everything blindly.', maxScore: 10, weight: 3, order: 0 },
      { name: 'Ownership', description: 'Takes responsibility for the damaged delivery.', maxScore: 10, weight: 2, order: 1 },
      { name: 'Problem resolution', description: 'Arranges a free, expedited replacement.', maxScore: 20, weight: 2, order: 2 },
    ],
  },
  {
    name: 'Confused Carol',
    description: 'Non-technical customer who cannot set up a new device. Patient, low difficulty.',
    template: {
      customerName: 'Carol',
      customerProfile: 'Retired, not comfortable with technology.',
      company: 'BrightHome Security',
      productContext: 'A new smart doorbell that will not connect to Wi-Fi.',
      issue: 'You cannot get the doorbell to come online and do not know why.',
      channel: 'chat',
      emotion: 'confused',
      intensity: 2,
      desiredOutcome: 'A working doorbell, explained in simple steps.',
      hiddenDetails:
        'Your Wi-Fi is a 5GHz-only network and the device needs 2.4GHz — you do not know this; reveal router details only when asked.',
      behaviorNotes:
        'You misuse technical terms and need patient, step-by-step guidance.',
      resolutionCriteria:
        'the agent guides you to connect the device or arranges clear follow-up help',
    },
    criteria: [
      { name: 'Clarity', description: 'Explains steps simply, no jargon.', maxScore: 10, weight: 2, order: 0 },
      { name: 'Patience', description: 'Stays patient and checks understanding.', maxScore: 10, weight: 2, order: 1 },
      { name: 'Diagnosis', description: 'Uncovers the 2.4GHz vs 5GHz issue.', maxScore: 10, weight: 2, order: 2 },
    ],
  },
  {
    name: 'Anxious Sam',
    description: 'Worried customer who fears their account was hacked. Security-sensitive.',
    template: {
      customerName: 'Sam',
      customerProfile: 'Long-time customer, careful about security.',
      company: 'Meridian Bank',
      issue: 'You saw a login alert from an unfamiliar device and you are scared your account is compromised.',
      channel: 'chat',
      emotion: 'anxious',
      intensity: 3,
      desiredOutcome: 'Reassurance and your account secured immediately.',
      hiddenDetails:
        'You recently logged in from a new phone while travelling — reveal this only if the agent asks about recent activity.',
      resolutionCriteria:
        'the agent verifies your identity, explains the alert, and confirms the account is secure',
    },
    criteria: [
      { name: 'Reassurance', description: 'Calms the customer while taking the concern seriously.', maxScore: 10, weight: 2, order: 0 },
      { name: 'Verification', description: 'Verifies identity before acting.', maxScore: 10, weight: 3, order: 1 },
      { name: 'Active listening', description: 'Surfaces the recent travel login.', maxScore: 10, weight: 1, order: 2 },
    ],
  },
];

async function seedPersonas(
  personas: SeedPersona[],
  createdById: number,
  publish: boolean,
): Promise<void> {
  for (const p of personas) {
    const existing = await prisma.persona.findFirst({ where: { name: p.name } });
    if (existing) {
      // Re-seed only flips publish state; content is left as-is.
      if (publish && !existing.isPublished) {
        await prisma.persona.update({ where: { id: existing.id }, data: { isPublished: true } });
      }
      continue;
    }
    await prisma.persona.create({
      data: {
        name: p.name,
        description: p.description,
        templateData: p.template as unknown as Prisma.InputJsonValue,
        systemPrompt: renderSystemPrompt(p.template),
        isPublished: publish,
        createdById,
        updatedById: createdById,
        scoreCriteria: { create: p.criteria },
      },
    });
  }
}

interface SeedTrainee {
  employeeId: string;
  email: string;
  firstName: string;
  lastName: string;
  username: string;
  password: string;
}

interface SeedTrainer extends SeedTrainee {
  persona: SeedPersona;
  trainees: SeedTrainee[];
}

// Two test trainers, each owning one published persona and supervising two
// trainees. Lets the publish + supervisor-visibility rule be exercised end to
// end: a trainee sees super-admin published personas plus their own trainer's.
const SEED_TRAINERS: SeedTrainer[] = [
  {
    employeeId: 'TRN001',
    email: 'trainer1@learnium.local',
    firstName: 'Tina',
    lastName: 'Trainer',
    username: 'trainer1',
    password: 'Trainer@123',
    persona: {
      name: 'Refund Rita (Team Nimbus)',
      description: "Trainer Tina's own persona: customer chasing a late refund.",
      template: {
        customerName: 'Rita',
        customerProfile: 'Customer for 1 year, paid by card.',
        company: 'Nimbus Telecom',
        issue: 'You were promised a refund two weeks ago and it has not arrived.',
        channel: 'chat',
        emotion: 'frustrated',
        intensity: 3,
        desiredOutcome: 'A firm date for the refund or escalation.',
        resolutionCriteria:
          'the agent gives a concrete refund date or escalates with a reference number',
      },
      criteria: [
        { name: 'Empathy', maxScore: 10, weight: 2, order: 0 },
        { name: 'Problem resolution', maxScore: 20, weight: 2, order: 1 },
      ],
    },
    trainees: [
      { employeeId: 'USR001', email: 'trainee1@learnium.local', firstName: 'Tariq', lastName: 'Trainee', username: 'trainee1', password: 'Trainee@123' },
      { employeeId: 'USR002', email: 'trainee2@learnium.local', firstName: 'Tara', lastName: 'Trainee', username: 'trainee2', password: 'Trainee@123' },
    ],
  },
  {
    employeeId: 'TRN002',
    email: 'trainer2@learnium.local',
    firstName: 'Theo',
    lastName: 'Trainer',
    username: 'trainer2',
    password: 'Trainer@123',
    persona: {
      name: 'Upgrade Uma (Team Vertex)',
      description: "Trainer Theo's own persona: customer unsure about an upgrade.",
      template: {
        customerName: 'Uma',
        customerProfile: 'Long-time customer weighing a plan upgrade.',
        company: 'Vertex Appliances',
        issue: 'You want to know if upgrading is worth it before committing.',
        channel: 'chat',
        emotion: 'calm',
        intensity: 2,
        desiredOutcome: 'A clear comparison so you can decide.',
        resolutionCriteria:
          'the agent explains the upgrade trade-offs clearly and lets the customer decide',
      },
      criteria: [
        { name: 'Clarity', maxScore: 10, weight: 2, order: 0 },
        { name: 'Needs analysis', maxScore: 10, weight: 2, order: 1 },
      ],
    },
    trainees: [
      { employeeId: 'USR003', email: 'trainee3@learnium.local', firstName: 'Ravi', lastName: 'Learner', username: 'trainee3', password: 'Trainee@123' },
      { employeeId: 'USR004', email: 'trainee4@learnium.local', firstName: 'Mei', lastName: 'Learner', username: 'trainee4', password: 'Trainee@123' },
    ],
  },
];

async function seedUser(
  person: SeedTrainee,
  roleId: number,
  supervisorId: number | null,
  createdById: number,
): Promise<number> {
  const user = await prisma.user.upsert({
    where: { employeeId: person.employeeId },
    update: { supervisorId: supervisorId ?? null },
    create: {
      employeeId: person.employeeId,
      email: person.email,
      firstName: person.firstName,
      lastName: person.lastName,
      roleId,
      supervisorId: supervisorId ?? null,
      createdById,
      updatedById: createdById,
    },
  });
  await prisma.defaultCredential.upsert({
    where: { username: person.username },
    update: {},
    create: {
      username: person.username,
      passwordHash: await argon2.hash(person.password),
      userId: user.id,
    },
  });
  return user.id;
}

async function seedTrainersAndTrainees(adminId: number): Promise<void> {
  const trainerRole = await prisma.roleDef.findUniqueOrThrow({ where: { name: 'TRAINER' } });
  const userRole = await prisma.roleDef.findUniqueOrThrow({ where: { name: 'USER' } });

  for (const trainer of SEED_TRAINERS) {
    const trainerId = await seedUser(trainer, trainerRole.id, null, adminId);
    // Trainer's own persona, published so their trainees can see it.
    await seedPersonas([trainer.persona], trainerId, true);
    for (const trainee of trainer.trainees) {
      await seedUser(trainee, userRole.id, trainerId, adminId);
    }
  }
}

async function main() {
  // Roles
  const roles = ['SUPER_ADMIN', 'TRAINER', 'USER'];
  for (const name of roles) {
    await prisma.roleDef.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }

  const superAdminRole = await prisma.roleDef.findUniqueOrThrow({ where: { name: 'SUPER_ADMIN' } });

  // Default superadmin user
  const adminUser = await prisma.user.upsert({
    where: { employeeId: 'ADMIN001' },
    update: {},
    create: {
      employeeId: 'ADMIN001',
      email: 'admin@learnium.local',
      firstName: 'Super',
      lastName: 'Admin',
      roleId: superAdminRole.id,
    },
  });

  // Credential for local login
  await prisma.defaultCredential.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      username: 'admin',
      passwordHash: await argon2.hash('Admin@123'),
      userId: adminUser.id,
    },
  });

  // Super-admin personas: published → visible to every trainee.
  await seedPersonas(SEED_PERSONAS, adminUser.id, true);

  // Test trainers (each with an own published persona) + their trainees.
  await seedTrainersAndTrainees(adminUser.id);

  const personaCount = await prisma.persona.count({ where: { isDeleted: false } });
  const publishedCount = await prisma.persona.count({ where: { isDeleted: false, isPublished: true } });
  console.log('Seed complete.');
  console.log('  Super admin : admin / Admin@123');
  console.log('  Trainers    : trainer1 / Trainer@123 , trainer2 / Trainer@123');
  console.log('  Trainees    : trainee1..trainee4 / Trainee@123 (1-2 under trainer1, 3-4 under trainer2)');
  console.log(`  Personas    : ${personaCount} total, ${publishedCount} published`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
