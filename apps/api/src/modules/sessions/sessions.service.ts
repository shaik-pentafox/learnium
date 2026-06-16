import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { NotFoundException, ForbiddenException } from '../../core/errors/domain.errors';
import type { StartSessionDto, SessionQueryDto, MessageQueryDto } from './dto/session.dto';

export const SCORE_SESSION_QUEUE = 'score-session';

@Injectable()
export class SessionsService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(SCORE_SESSION_QUEUE) private readonly scoreQueue: Queue,
  ) {}

  async start(dto: StartSessionDto, userId: number) {
    const persona = await this.prisma.persona.findUnique({
      where: { id: dto.personaId, isDeleted: false },
    });
    if (!persona) throw new NotFoundException('Persona', dto.personaId);

    const session = await this.prisma.session.create({
      data: { userId, personaId: dto.personaId },
      select: { id: true, uid: true, startedAt: true, personaId: true, status: true },
    });

    return { sessionId: session.id, uid: session.uid, startedAt: session.startedAt };
  }

  async list(query: SessionQueryDto, actorId: number, role: string) {
    const { page, limit, personaId, userId, status, from, to } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.SessionWhereInput = {
      ...(role === 'USER' ? { userId: actorId } : {}),
      ...(userId !== undefined ? { userId } : {}),
      ...(personaId !== undefined ? { personaId } : {}),
      ...(status !== undefined ? { status } : {}),
      ...(from !== undefined || to !== undefined
        ? {
            startedAt: {
              ...(from !== undefined ? { gte: new Date(from) } : {}),
              ...(to !== undefined ? { lte: new Date(to) } : {}),
            },
          }
        : {}),
    };

    const [sessions, total] = await Promise.all([
      this.prisma.session.findMany({
        where,
        skip,
        take: limit,
        include: {
          persona: { select: { id: true, name: true } },
          user: { select: { id: true, firstName: true, lastName: true, employeeId: true } },
          scores: true,
        },
        orderBy: { startedAt: 'desc' },
      }),
      this.prisma.session.count({ where }),
    ]);

    return { sessions, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findByUid(uid: string, actorId: number, role: string) {
    const session = await this.prisma.session.findUnique({
      where: { uid },
      include: {
        persona: { select: { id: true, name: true, scoreCriteria: true } },
        user: { select: { id: true, firstName: true, lastName: true, employeeId: true } },
        scores: { include: { criterion: true } },
      },
    });
    if (!session) throw new NotFoundException('Session', uid);
    if (role === 'USER' && session.userId !== actorId) throw new ForbiddenException();
    return session;
  }

  async getMessages(uid: string, query: MessageQueryDto, actorId: number, role: string) {
    const session = await this.prisma.session.findUnique({ where: { uid }, select: { id: true, userId: true } });
    if (!session) throw new NotFoundException('Session', uid);
    if (role === 'USER' && session.userId !== actorId) throw new ForbiddenException();

    const { page, limit } = query;
    const skip = (page - 1) * limit;
    const [messages, total] = await Promise.all([
      this.prisma.chatMessage.findMany({
        where: { sessionId: session.id },
        skip,
        take: limit,
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.chatMessage.count({ where: { sessionId: session.id } }),
    ]);
    return { messages, total, page, limit };
  }

  async end(uid: string, actorId: number, role: string) {
    const session = await this.prisma.session.findUnique({ where: { uid } });
    if (!session) throw new NotFoundException('Session', uid);
    if (role === 'USER' && session.userId !== actorId) throw new ForbiddenException();
    if (session.status !== 'ACTIVE') return { uid, status: session.status, message: 'Already ended' };

    await this.prisma.session.update({
      where: { uid },
      data: { status: 'COMPLETED', endedAt: new Date() },
    });

    await this.scoreQueue.add('score', { sessionId: session.id, uid });

    return { uid, status: 'COMPLETED', scoringQueued: true };
  }
}
