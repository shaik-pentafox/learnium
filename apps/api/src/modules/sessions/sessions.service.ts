import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { NotFoundException, ForbiddenException } from '../../core/errors/domain.errors';
import type { StartSessionDto, SessionQueryDto, MessageQueryDto } from './dto/session.dto';
import { superAdminUserIds, canTraineeAccess } from '../personas/persona-access';

export const SCORE_SESSION_QUEUE = 'score-session';

@Injectable()
export class SessionsService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(SCORE_SESSION_QUEUE) private readonly scoreQueue: Queue,
  ) {}

  async start(dto: StartSessionDto, actor: { sub: number; role: string }) {
    const persona = await this.prisma.persona.findUnique({
      where: { id: dto.personaId, isDeleted: false },
      select: { id: true, isPublished: true, isDeleted: true, createdById: true },
    });
    if (!persona) throw new NotFoundException('Persona', dto.personaId);

    let isSimulation = false;
    if (actor.role === 'USER') {
      const [supervisorId, superAdminIds] = await Promise.all([
        this.prisma.user
          .findUnique({ where: { id: actor.sub }, select: { supervisorId: true } })
          .then((u) => u?.supervisorId ?? null),
        superAdminUserIds(this.prisma),
      ]);
      if (!canTraineeAccess(persona, supervisorId, superAdminIds)) {
        throw new ForbiddenException('Persona not available');
      }
    } else {
      // TRAINER / SUPER_ADMIN: simulation session. Trainers may test their own
      // personas plus published super-admin personas; admins may test any.
      if (actor.role === 'TRAINER' && persona.createdById !== actor.sub) {
        const superAdminIds = await superAdminUserIds(this.prisma);
        const sharedAdminPersona =
          persona.isPublished &&
          persona.createdById != null &&
          superAdminIds.includes(persona.createdById);
        if (!sharedAdminPersona) {
          throw new ForbiddenException('You can only test your own personas');
        }
      }
      isSimulation = dto.simulation ?? true;
    }

    const session = await this.prisma.session.create({
      data: { userId: actor.sub, personaId: dto.personaId, isSimulation },
      select: { id: true, uid: true, startedAt: true, isSimulation: true },
    });

    return {
      sessionId: session.id,
      uid: session.uid,
      startedAt: session.startedAt,
      isSimulation: session.isSimulation,
    };
  }

  async list(query: SessionQueryDto, actorId: number, role: string) {
    const { page, limit, personaId, userId, status, from, to } = query;
    const skip = (page - 1) * limit;

    // Role scoping: trainees see only their own; trainers see their supervised
    // trainees' sessions; super admins see everything. An explicit `userId`
    // filter narrows further (clamped to the trainer's own trainees).
    const userScope = await this.userScope(actorId, role, userId);

    const where: Prisma.SessionWhereInput = {
      ...(userScope !== undefined ? { userId: userScope } : {}),
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

  /** Resolve the `userId` filter for a session list given the actor's role.
   *  Returns a Prisma scalar/`in` filter, or `undefined` for "no restriction"
   *  (super admin, all users). Trainers are confined to supervised trainees. */
  private async userScope(
    actorId: number,
    role: string,
    requestedUserId?: number,
  ): Promise<number | Prisma.IntFilter | undefined> {
    if (role === 'USER') return actorId;
    if (role === 'TRAINER') {
      const trainees = await this.prisma.user.findMany({
        where: { supervisorId: actorId, isDeleted: false },
        select: { id: true },
      });
      const ids = trainees.map((t) => t.id);
      if (requestedUserId !== undefined) {
        return ids.includes(requestedUserId) ? requestedUserId : { in: [] };
      }
      return { in: ids };
    }
    // SUPER_ADMIN: optional narrowing only.
    return requestedUserId !== undefined ? requestedUserId : undefined;
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
    return { ...session, timing: await this.sessionTiming(session.id, session.startedAt, session.endedAt) };
  }

  /** Derived timing for a session: total duration + avg/turn split by who took
   *  the time (trainee response vs LLM generation). Feeds user + model perf. */
  private async sessionTiming(sessionId: number, startedAt: Date, endedAt: Date | null) {
    const messages = await this.prisma.chatMessage.findMany({
      where: { sessionId },
      select: { role: true, latencyMs: true },
    });
    const avg = (vals: number[]) =>
      vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
    const userMs = messages
      .filter((m) => m.role === 'user' && m.latencyMs != null)
      .map((m) => m.latencyMs as number);
    const llmMs = messages
      .filter((m) => m.role === 'assistant' && m.latencyMs != null)
      .map((m) => m.latencyMs as number);
    return {
      durationMs: endedAt ? endedAt.getTime() - startedAt.getTime() : null,
      turns: messages.length,
      avgUserResponseMs: avg(userMs),
      avgLlmLatencyMs: avg(llmMs),
    };
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

  /** Trainee left mid-conversation: mark ABANDONED, no scoring. An interrupted
   *  run is not a graded attempt. No-op if the session already ended. */
  async abandon(uid: string, actorId: number, role: string) {
    const session = await this.prisma.session.findUnique({ where: { uid } });
    if (!session) throw new NotFoundException('Session', uid);
    if (role === 'USER' && session.userId !== actorId) throw new ForbiddenException();
    if (session.status !== 'ACTIVE') return { uid, status: session.status, message: 'Already ended' };

    await this.prisma.session.update({
      where: { uid },
      data: { status: 'ABANDONED', endedAt: new Date() },
    });

    return { uid, status: 'ABANDONED' };
  }
}
