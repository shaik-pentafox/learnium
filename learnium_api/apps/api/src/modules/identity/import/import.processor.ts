import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import * as argon2 from 'argon2';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/database/prisma.service';
import { USER_IMPORT_QUEUE, type ImportRow, type ImportError } from './import.service';

interface ImportJobData {
  reportId: string;
  rows: ImportRow[];
  initiatorId: number;
}

@Processor(USER_IMPORT_QUEUE)
export class ImportProcessor extends WorkerHost {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  override async process(job: Job<ImportJobData>): Promise<void> {
    const { reportId, rows, initiatorId } = job.data;

    await this.prisma.importReport.update({
      where: { id: reportId },
      data: { status: 'PROCESSING' },
    });

    const errors: ImportError[] = [];
    let successRows = 0;

    const allRoles = await this.prisma.roleDef.findMany();
    const roleCache = new Map(allRoles.map((r) => [r.name, r.id]));

    for (const row of rows) {
      try {
        if (!row.employeeId) throw new Error('employeeId is required');
        if (!row.firstName) throw new Error('firstName is required');
        if (!row.lastName) throw new Error('lastName is required');
        if (!row.email) throw new Error('email is required');
        if (!row.role) throw new Error('role is required');

        const roleId = roleCache.get(row.role.toUpperCase());
        if (!roleId) throw new Error(`unknown role "${row.role}"`);

        let supervisorId: number | undefined;
        if (row.supervisorEmployeeId) {
          const sup = await this.prisma.user.findUnique({
            where: { employeeId: row.supervisorEmployeeId },
          });
          if (!sup) throw new Error(`supervisor "${row.supervisorEmployeeId}" not found`);
          supervisorId = sup.id;
        }

        await this.prisma.$transaction(async (tx) => {
          const createData: Prisma.UserUncheckedCreateInput = {
            employeeId: row.employeeId,
            firstName: row.firstName,
            lastName: row.lastName,
            email: row.email,
            roleId,
            createdById: initiatorId,
            updatedById: initiatorId,
            ...(supervisorId !== undefined ? { supervisorId } : {}),
          };

          const updateData: Prisma.UserUncheckedUpdateInput = {
            firstName: row.firstName,
            lastName: row.lastName,
            email: row.email,
            roleId,
            updatedById: initiatorId,
            ...(supervisorId !== undefined ? { supervisorId } : {}),
          };

          const user = await tx.user.upsert({
            where: { employeeId: row.employeeId },
            create: createData,
            update: updateData,
          });

          const existing = await tx.defaultCredential.findUnique({ where: { userId: user.id } });
          if (!existing) {
            const username = row.username ?? row.employeeId;
            const rawPass = row.password ?? row.employeeId;
            await tx.defaultCredential.create({
              data: {
                username,
                passwordHash: await argon2.hash(rawPass),
                userId: user.id,
              },
            });
          }
        });

        successRows++;
      } catch (err) {
        errors.push({
          rowNum: row.rowNum,
          employeeId: row.employeeId ?? '',
          field: 'general',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    await this.prisma.importReport.update({
      where: { id: reportId },
      data: {
        status: 'DONE',
        successRows,
        errorRows: errors.length,
        errorData: errors as unknown as Prisma.InputJsonValue,
      },
    });
  }
}
