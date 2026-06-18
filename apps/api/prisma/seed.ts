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

async function seedPersonas(createdById: number): Promise<void> {
  for (const p of SEED_PERSONAS) {
    const existing = await prisma.persona.findFirst({ where: { name: p.name } });
    if (existing) continue;
    await prisma.persona.create({
      data: {
        name: p.name,
        description: p.description,
        templateData: p.template as unknown as Prisma.InputJsonValue,
        systemPrompt: renderSystemPrompt(p.template),
        createdById,
        updatedById: createdById,
        scoreCriteria: { create: p.criteria },
      },
    });
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

  await seedPersonas(adminUser.id);

  const personaCount = await prisma.persona.count({ where: { isDeleted: false } });
  console.log(`Seed complete. Login: admin / Admin@123. Personas: ${personaCount}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
