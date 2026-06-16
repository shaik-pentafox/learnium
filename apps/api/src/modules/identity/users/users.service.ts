import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/database/prisma.service';
import { ConflictException, NotFoundException } from '../../../core/errors/domain.errors';
import type { CreateUserDto, UpdateUserDto, UserQueryDto } from './dto/user.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: UserQueryDto) {
    const { page, limit, q, roleId } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.UserWhereInput = {
      isDeleted: false,
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

  async create(dto: CreateUserDto, createdById: number) {
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
          roleId: dto.roleId,
          ...(dto.supervisorId !== undefined ? { supervisorId: dto.supervisorId } : {}),
          createdById,
          updatedById: createdById,
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

  async update(id: number, dto: UpdateUserDto, updatedById: number) {
    await this.findById(id);

    if (dto.email) {
      const conflict = await this.prisma.user.findFirst({
        where: { email: dto.email, isDeleted: false, NOT: { id } },
      });
      if (conflict) throw new ConflictException(`email ${dto.email} already exists`);
    }

    const data: Prisma.UserUncheckedUpdateInput = { updatedById };
    if (dto.firstName !== undefined) data.firstName = dto.firstName;
    if (dto.lastName !== undefined) data.lastName = dto.lastName;
    if (dto.email !== undefined) data.email = dto.email;
    if (dto.roleId !== undefined) data.roleId = dto.roleId;
    if ('supervisorId' in dto) data.supervisorId = dto.supervisorId ?? null;

    return this.prisma.user.update({ where: { id }, data, include: { role: true } });
  }

  async softDelete(id: number, deletedById: number) {
    await this.findById(id);
    await this.prisma.user.update({
      where: { id },
      data: { isDeleted: true, updatedById: deletedById },
    });
  }
}
