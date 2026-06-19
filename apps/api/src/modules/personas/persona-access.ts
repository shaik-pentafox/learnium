import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';

/** Ids of all SUPER_ADMIN users — their published personas are visible to every trainee. */
export async function superAdminUserIds(prisma: PrismaService): Promise<number[]> {
  const rows = await prisma.user.findMany({
    where: { role: { name: 'SUPER_ADMIN' }, isDeleted: false },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/** Owner ids a trainee may see published personas from: their supervisor + all super admins. */
function visibleOwnerIds(supervisorId: number | null, superAdminIds: number[]): number[] {
  const ids = new Set<number>(superAdminIds);
  if (supervisorId != null) ids.add(supervisorId);
  return [...ids];
}

/** Prisma `where` for the published personas a trainee may list. */
export function traineeVisibleWhere(
  supervisorId: number | null,
  superAdminIds: number[],
): Prisma.PersonaWhereInput {
  return {
    isDeleted: false,
    isPublished: true,
    createdById: { in: visibleOwnerIds(supervisorId, superAdminIds) },
  };
}

/** Single-object form of the same predicate (detail / session-start checks). */
export function canTraineeAccess(
  persona: { isPublished: boolean; isDeleted: boolean; createdById: number | null },
  supervisorId: number | null,
  superAdminIds: number[],
): boolean {
  if (!persona.isPublished || persona.isDeleted || persona.createdById == null) return false;
  return visibleOwnerIds(supervisorId, superAdminIds).includes(persona.createdById);
}
