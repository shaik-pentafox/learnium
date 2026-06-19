import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { NotFoundException, ForbiddenException } from '../../core/errors/domain.errors';
import { renderSystemPrompt } from '../../core/llm/persona-prompt.template';
import type { CreatePersonaDto, UpdatePersonaDto, PersonaQueryDto } from './dto/persona.dto';
import {
  superAdminUserIds,
  traineeVisibleWhere,
  canTraineeAccess,
} from './persona-access';

const PERSONA_INCLUDE = {
  voiceStyle: true,
  scoreCriteria: { orderBy: { order: 'asc' as const } },
  conversationModel: { select: { id: true, name: true } },
  scoringModel: { select: { id: true, name: true } },
} satisfies Prisma.PersonaInclude;

@Injectable()
export class PersonasService {
  constructor(private readonly prisma: PrismaService) {}

  /** Owner (creator) or any super admin may mutate / test a persona. */
  private async assertCanManage(
    personaCreatedById: number | null,
    actor: { sub: number; role: string },
  ) {
    if (actor.role === 'SUPER_ADMIN') return;
    if (personaCreatedById !== actor.sub) {
      throw new ForbiddenException('You can only modify your own personas');
    }
  }

  private async supervisorIdOf(userId: number): Promise<number | null> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { supervisorId: true },
    });
    return u?.supervisorId ?? null;
  }

  /** Unchecked load — for internal, already-authorized service calls. */
  private async loadOrThrow(id: number) {
    const persona = await this.prisma.persona.findUnique({
      where: { id, isDeleted: false },
      include: PERSONA_INCLUDE,
    });
    if (!persona) throw new NotFoundException('Persona', id);
    return persona;
  }

  async list(query: PersonaQueryDto, actor: { sub: number; role: string }) {
    const { page, limit, q } = query;
    const skip = (page - 1) * limit;

    const search: Prisma.PersonaWhereInput = q
      ? {
          OR: [
            { name: { contains: q, mode: Prisma.QueryMode.insensitive } },
            { description: { contains: q, mode: Prisma.QueryMode.insensitive } },
          ],
        }
      : {};

    let scope: Prisma.PersonaWhereInput;
    if (actor.role === 'SUPER_ADMIN') {
      scope = { isDeleted: false };
    } else if (actor.role === 'TRAINER') {
      scope = { isDeleted: false, createdById: actor.sub };
    } else {
      const [supervisorId, superAdminIds] = await Promise.all([
        this.supervisorIdOf(actor.sub),
        superAdminUserIds(this.prisma),
      ]);
      scope = traineeVisibleWhere(supervisorId, superAdminIds);
    }

    const where: Prisma.PersonaWhereInput = { AND: [scope, search] };

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

  async findById(id: number, actor: { sub: number; role: string }) {
    const persona = await this.prisma.persona.findUnique({
      where: { id, isDeleted: false },
      include: PERSONA_INCLUDE,
    });
    if (!persona) throw new NotFoundException('Persona', id);
    if (actor.role === 'SUPER_ADMIN') return persona;
    if (actor.role === 'TRAINER') {
      if (persona.createdById !== actor.sub) throw new NotFoundException('Persona', id);
      return persona;
    }
    const [supervisorId, superAdminIds] = await Promise.all([
      this.supervisorIdOf(actor.sub),
      superAdminUserIds(this.prisma),
    ]);
    if (!canTraineeAccess(persona, supervisorId, superAdminIds)) {
      throw new NotFoundException('Persona', id);
    }
    return persona;
  }

  async myPersonas(user: { sub: number; role: string }) {
    if (user.role === 'SUPER_ADMIN') {
      return this.list({ page: 1, limit: 100 }, user);
    }
    if (user.role === 'TRAINER') {
      const personas = await this.prisma.persona.findMany({
        where: { isDeleted: false, createdById: user.sub },
        include: PERSONA_INCLUDE,
        orderBy: { createdAt: 'desc' },
      });
      return { personas, total: personas.length };
    }
    // Trainee (USER): published personas of own trainer or any super admin.
    const [supervisorId, superAdminIds] = await Promise.all([
      this.supervisorIdOf(user.sub),
      superAdminUserIds(this.prisma),
    ]);
    const personas = await this.prisma.persona.findMany({
      where: traineeVisibleWhere(supervisorId, superAdminIds),
      include: PERSONA_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return { personas, total: personas.length };
  }

  async create(dto: CreatePersonaDto, createdById: number) {
    const { scoreCriteria } = dto;
    // Render the runtime prompt cache from the structured template (source of truth).
    const systemPrompt = renderSystemPrompt(dto.template);

    return this.prisma.$transaction(async (tx) => {
      const persona = await tx.persona.create({
        data: {
          name: dto.name,
          templateData: dto.template as unknown as Prisma.InputJsonValue,
          systemPrompt,
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(dto.color !== undefined ? { color: dto.color } : {}),
          isPublished: dto.isPublished ?? false,
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

  async update(id: number, dto: UpdatePersonaDto, actor: { sub: number; role: string }) {
    const existing = await this.loadOrThrow(id);
    await this.assertCanManage(existing.createdById, actor);

    const nextVersion = await this.prisma.personaVersion.count({ where: { personaId: id } }) + 1;

    await this.prisma.personaVersion.create({
      data: {
        personaId: id,
        version: nextVersion,
        systemPrompt: existing.systemPrompt,
        customInstructions: existing.customInstructions,
        ...(existing.templateData != null
          ? { templateData: existing.templateData as Prisma.InputJsonValue }
          : {}),
        snapshotData: existing as unknown as Prisma.InputJsonValue,
        createdById: actor.sub,
      },
    });

    const { scoreCriteria, ...personaData } = dto;

    const data: Prisma.PersonaUncheckedUpdateInput = { updatedById: actor.sub };
    if (personaData.name !== undefined) data.name = personaData.name;
    if (personaData.description !== undefined) data.description = personaData.description;
    if ('color' in personaData) data.color = personaData.color ?? null;
    // Re-render the prompt cache when the structured template changes.
    if (personaData.template !== undefined) {
      data.templateData = personaData.template as unknown as Prisma.InputJsonValue;
      data.systemPrompt = renderSystemPrompt(personaData.template);
    }
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

    return this.loadOrThrow(id);
  }

  async publish(id: number, actor: { sub: number; role: string }) {
    const persona = await this.loadOrThrow(id);
    await this.assertCanManage(persona.createdById, actor);
    return this.prisma.persona.update({
      where: { id },
      data: { isPublished: true, updatedById: actor.sub },
      include: PERSONA_INCLUDE,
    });
  }

  async unpublish(id: number, actor: { sub: number; role: string }) {
    const persona = await this.loadOrThrow(id);
    await this.assertCanManage(persona.createdById, actor);
    return this.prisma.persona.update({
      where: { id },
      data: { isPublished: false, updatedById: actor.sub },
      include: PERSONA_INCLUDE,
    });
  }

  async softDelete(id: number, actor: { sub: number; role: string }) {
    const persona = await this.loadOrThrow(id);
    await this.assertCanManage(persona.createdById, actor);
    await this.prisma.persona.update({
      where: { id },
      data: { isDeleted: true, updatedById: actor.sub },
    });
  }

  async getVersions(personaId: number) {
    await this.loadOrThrow(personaId);
    return this.prisma.personaVersion.findMany({
      where: { personaId },
      orderBy: { version: 'desc' },
      select: { id: true, version: true, systemPrompt: true, customInstructions: true, createdAt: true, createdById: true },
    });
  }

  async getVersion(personaId: number, version: number) {
    await this.loadOrThrow(personaId);
    const v = await this.prisma.personaVersion.findUnique({
      where: { personaId_version: { personaId, version } },
    });
    if (!v) throw new NotFoundException('PersonaVersion', `${personaId}/v${version}`);
    return v;
  }
}
