import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../core/database/prisma.service';
import type { Env } from '../../core/config/env.schema';

/**
 * Marks abandoned roleplay sessions as ABANDONED. A session is "idle" when its
 * last activity — newest chat message, or `startedAt` if no messages — is older
 * than SESSION_IDLE_TIMEOUT_MINUTES. WS disconnect alone never ends a session
 * (the user may reconnect and resume); this sweep is the only thing that closes
 * sessions the user walked away from. Abandoned sessions are NOT scored.
 */
@Injectable()
export class SessionReaperService {
  private readonly logger = new Logger(SessionReaperService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async reapIdleSessions(): Promise<void> {
    const minutes = this.config.get('SESSION_IDLE_TIMEOUT_MINUTES', { infer: true });
    const cutoff = new Date(Date.now() - minutes * 60_000);

    const reaped = await this.prisma.$executeRaw`
      UPDATE "sessions" AS s
      SET "status" = 'ABANDONED', "endedAt" = NOW(), "updatedAt" = NOW()
      WHERE s."status" = 'ACTIVE'
        AND COALESCE(
          (SELECT MAX(m."createdAt") FROM "chat_messages" AS m WHERE m."sessionId" = s."id"),
          s."startedAt"
        ) < ${cutoff}
    `;

    if (reaped > 0) {
      this.logger.log(`Reaped ${reaped} idle session(s) → ABANDONED (idle > ${minutes}m)`);
    }
  }
}
