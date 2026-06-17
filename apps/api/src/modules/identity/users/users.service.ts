import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/database/prisma.service';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '../../../core/errors/domain.errors';
import type { JwtPayload } from '../../../core/auth/decorators/current-user.decorator';
import type { CreateUserDto, UpdateUserDto, UserQueryDto } from './dto/user.dto';

const TRAINEE_ROLE = 'USER';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  private isTrainer(actor: JwtPayload): boolean {
    return actor.role === 'TRAINER';
  }

  /** Resolve the trainee (USER) role id, used to constrain trainer-created users. */
  private async traineeRoleId(): Promise<number> {
    const role = await this.prisma.roleDef.findUniqueOrThrow({
      where: { name: TRAINEE_ROLE },
      select: { id: true },
    });
    return role.id;
  }

  async list(query: UserQueryDto, actor: JwtPayload) {
    const { page, limit, q, roleId } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.UserWhereInput = {
      isDeleted: false,
      // Trainers only ever see their own trainees.
      ...(this.isTrainer(actor) ? { supervisorId: actor.sub } : {}),
      ...(roleId !== undefined ? { roleId } : {}),
      ...(q
        ? {
            OR: [
              { firstName: { contains: q, mode: Prisma.QueryMode.insensitive } },
              { lastName: { contains: q, mode: Prisma.QueryMode.insensitive } },
              { email: { contains: q, mode: Prisma.QueryMode.insensitive } },
              { employeeId: { contains: q, mode: Prisma.QueryMode.insensitive } },
            ],
          }
        : {}),
    };

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        include: { role: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.user.count({ where }),
    ]);

    return { users, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findById(id: number) {
    const user = await this.prisma.user.findUnique({
      where: { id, isDeleted: false },
      include: {
        role: true,
        supervisor: { select: { id: true, firstName: true, lastName: true, employeeId: true } },
      },
    });
    if (!user) throw new NotFoundException('User', id);
    return user;
  }

  /** Controller-facing read: trainers may only view their own trainees. */
  async findOne(id: number, actor: JwtPayload) {
    const user = await this.findById(id);
    if (this.isTrainer(actor) && user.supervisorId !== actor.sub) {
      throw new ForbiddenException('You can only view your own trainees');
    }
    return user;
  }

  async create(dto: CreateUserDto, actor: JwtPayload) {
    // Trainers may only create trainees (role=USER) under themselves.
    let { roleId, supervisorId } = dto;
    if (this.isTrainer(actor)) {
      const traineeRoleId = await this.traineeRoleId();
      if (roleId !== traineeRoleId) {
        throw new ForbiddenException('Trainers can only create trainees');
      }
      supervisorId = actor.sub; // force self as supervisor, ignore any override
    }

    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ employeeId: dto.employeeId }, { email: dto.email }], isDeleted: false },
    });
    if (existing) {
      throw new ConflictException(
        existing.employeeId === dto.employeeId
          ? `employeeId ${dto.employeeId} already exists`
          : `email ${dto.email} already exists`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          employeeId: dto.employeeId,
          firstName: dto.firstName,
          lastName: dto.lastName,
          email: dto.email,
          roleId,
          ...(supervisorId !== undefined ? { supervisorId } : {}),
          createdById: actor.sub,
          updatedById: actor.sub,
        },
        include: { role: true },
      });

      const username = dto.username ?? dto.employeeId;
      const rawPass = dto.password ?? dto.employeeId;
      await tx.defaultCredential.create({
        data: { username, passwordHash: await argon2.hash(rawPass), userId: user.id },
      });

      return user;
    });
  }

  async update(id: number, dto: UpdateUserDto, actor: JwtPayload) {
    const target = await this.findById(id);

    if (this.isTrainer(actor)) {
      if (target.supervisorId !== actor.sub) {
        throw new ForbiddenException('You can only manage your own trainees');
      }
      const traineeRoleId = await this.traineeRoleId();
      if (dto.roleId !== undefined && dto.roleId !== traineeRoleId) {
        throw new ForbiddenException('Trainers cannot change a trainee’s role');
      }
      if (dto.supervisorId !== undefined && dto.supervisorId !== actor.sub) {
        throw new ForbiddenException('Trainers cannot reassign trainees');
      }
    }

    if (dto.email) {
      const conflict = await this.prisma.user.findFirst({
        where: { email: dto.email, isDeleted: false, NOT: { id } },
      });
      if (conflict) throw new ConflictException(`email ${dto.email} already exists`);
    }

    const data: Prisma.UserUncheckedUpdateInput = { updatedById: actor.sub };
    if (dto.firstName !== undefined) data.firstName = dto.firstName;
    if (dto.lastName !== undefined) data.lastName = dto.lastName;
    if (dto.email !== undefined) data.email = dto.email;
    if (dto.roleId !== undefined) data.roleId = dto.roleId;
    if ('supervisorId' in dto) data.supervisorId = dto.supervisorId ?? null;

    return this.prisma.user.update({ where: { id }, data, include: { role: true } });
  }

  async softDelete(id: number, actor: JwtPayload) {
    const target = await this.findById(id);
    if (this.isTrainer(actor) && target.supervisorId !== actor.sub) {
      throw new ForbiddenException('You can only delete your own trainees');
    }
    await this.prisma.user.update({
      where: { id },
      data: { isDeleted: true, updatedById: actor.sub },
    });
  }
}
