import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { NotFoundException } from '../../core/errors/domain.errors';
import type { CreatePersonaDto, UpdatePersonaDto, PersonaQueryDto } from './dto/persona.dto';

const PERSONA_INCLUDE = {
  voiceStyle: true,
  scoreCriteria: { orderBy: { order: 'asc' as const } },
  conversationModel: { select: { id: true, name: true } },
  scoringModel: { select: { id: true, name: true } },
} satisfies Prisma.PersonaInclude;

@Injectable()
export class PersonasService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: PersonaQueryDto) {
    const { page, limit, q } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.PersonaWhereInput = {
      isDeleted: false,
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: Prisma.QueryMode.insensitive } },
              { description: { contains: q, mode: Prisma.QueryMode.insensitive } },
            ],
          }
        : {}),
    };

    const [personas, total] = await Promise.all([
      this.prisma.persona.findMany({
        where,
        skip,
        take: limit,
        include: PERSONA_INCLUDE,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.persona.count({ where }),
    ]);

    return { personas, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findById(id: number) {
    const persona = await this.prisma.persona.findUnique({
      where: { id, isDeleted: false },
      include: PERSONA_INCLUDE,
    });
    if (!persona) throw new NotFoundException('Persona', id);
    return persona;
  }

  async myPersonas(userId: number, role: string) {
    if (role !== 'USER') {
      return this.list({ page: 1, limit: 100 });
    }
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { assignedPersona: { include: PERSONA_INCLUDE } },
    });
    return { personas: user?.assignedPersona ? [user.assignedPersona] : [], total: user?.assignedPersona ? 1 : 0 };
  }

  async create(dto: CreatePersonaDto, createdById: number) {
    const { scoreCriteria, ...personaData } = dto;

    return this.prisma.$transaction(async (tx) => {
      const persona = await tx.persona.create({
        data: {
          name: dto.name,
          systemPrompt: dto.systemPrompt,
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(dto.customInstructions !== undefined ? { customInstructions: dto.customInstructions } : {}),
          ...(dto.voiceStyleId !== undefined ? { voiceStyleId: dto.voiceStyleId } : {}),
          ...(dto.conversationModelId !== undefined ? { conversationModelId: dto.conversationModelId } : {}),
          ...(dto.scoringModelId !== undefined ? { scoringModelId: dto.scoringModelId } : {}),
          createdById,
          updatedById: createdById,
        },
        include: PERSONA_INCLUDE,
      });
      if (scoreCriteria?.length) {
        await tx.scoreCriterion.createMany({
          data: scoreCriteria.map((c) => ({
            personaId: persona.id,
            name: c.name,
            maxScore: c.maxScore,
            weight: c.weight,
            order: c.order,
            ...(c.description !== undefined ? { description: c.description } : {}),
          })),
        });
      }
      return tx.persona.findUniqueOrThrow({ where: { id: persona.id }, include: PERSONA_INCLUDE });
    });
  }

  async update(id: number, dto: UpdatePersonaDto, updatedById: number) {
    const existing = await this.findById(id);

    const nextVersion = await this.prisma.personaVersion.count({ where: { personaId: id } }) + 1;

    await this.prisma.personaVersion.create({
      data: {
        personaId: id,
        version: nextVersion,
        systemPrompt: existing.systemPrompt,
        customInstructions: existing.customInstructions,
        snapshotData: existing as unknown as Prisma.InputJsonValue,
        createdById: updatedById,
      },
    });

    const { scoreCriteria, ...personaData } = dto;

    const data: Prisma.PersonaUncheckedUpdateInput = { updatedById };
    if (personaData.name !== undefined) data.name = personaData.name;
    if (personaData.description !== undefined) data.description = personaData.description;
    if (personaData.systemPrompt !== undefined) data.systemPrompt = personaData.systemPrompt;
    if (personaData.customInstructions !== undefined) data.customInstructions = personaData.customInstructions;
    if ('voiceStyleId' in personaData) data.voiceStyleId = personaData.voiceStyleId ?? null;
    if ('conversationModelId' in personaData) data.conversationModelId = personaData.conversationModelId ?? null;
    if ('scoringModelId' in personaData) data.scoringModelId = personaData.scoringModelId ?? null;

    const persona = await this.prisma.persona.update({
      where: { id },
      data,
      include: PERSONA_INCLUDE,
    });

    if (scoreCriteria !== undefined) {
      await this.prisma.scoreCriterion.deleteMany({ where: { personaId: id } });
      if (scoreCriteria.length > 0) {
        await this.prisma.scoreCriterion.createMany({
          data: scoreCriteria.map((c) => ({
            personaId: id,
            name: c.name,
            maxScore: c.maxScore,
            weight: c.weight,
            order: c.order,
            ...(c.description !== undefined ? { description: c.description } : {}),
          })),
        });
      }
    }

    return this.findById(id);
  }

  async softDelete(id: number, deletedById: number) {
    await this.findById(id);
    await this.prisma.persona.update({
      where: { id },
      data: { isDeleted: true, updatedById: deletedById },
    });
  }

  async getVersions(personaId: number) {
    await this.findById(personaId);
    return this.prisma.personaVersion.findMany({
      where: { personaId },
      orderBy: { version: 'desc' },
      select: { id: true, version: true, systemPrompt: true, customInstructions: true, createdAt: true, createdById: true },
    });
  }

  async getVersion(personaId: number, version: number) {
    await this.findById(personaId);
    const v = await this.prisma.personaVersion.findUnique({
      where: { personaId_version: { personaId, version } },
    });
    if (!v) throw new NotFoundException('PersonaVersion', `${personaId}/v${version}`);
    return v;
  }
}
