import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

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

  console.log('Seed complete. Login: admin / Admin@123');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
