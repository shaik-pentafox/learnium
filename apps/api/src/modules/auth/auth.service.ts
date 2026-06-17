import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { PrismaService } from '../../core/database/prisma.service';
import { REDIS_CLIENT } from '../../core/redis/redis.module';
import type Redis from 'ioredis';
import type { Env } from '../../core/config/env.schema';
import { CREDENTIAL_VERIFIER } from '../../core/auth/verifiers/credential-verifier.interface';
import type { CredentialVerifier } from '../../core/auth/verifiers/credential-verifier.interface';
import {
  UnauthorizedException,
  NotFoundException,
} from '../../core/errors/domain.errors';
import type { UpdateProfileDto } from './dto/profile.dto';

// Single projection so GET /me and PATCH /me return an identical shape.
const PROFILE_SELECT = {
  id: true,
  employeeId: true,
  email: true,
  firstName: true,
  lastName: true,
  avatarUrl: true,
  role: { select: { name: true } },
  credential: { select: { username: true } },
} as const;

interface ProfileRow {
  id: number;
  employeeId: string;
  email: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  role: { name: string };
  credential: { username: string } | null;
}

function toProfile(user: ProfileRow) {
  return {
    id: user.id,
    employeeId: user.employeeId,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    avatarUrl: user.avatarUrl,
    role: user.role.name,
    username: user.credential?.username ?? null,
  };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(CREDENTIAL_VERIFIER) private readonly verifier: CredentialVerifier,
  ) {}

  async login(username: string, password: string) {
    const userId = await this.verifier.verify(username, password);
    if (!userId) throw new UnauthorizedException('Invalid credentials', 'INVALID_CREDENTIALS');

    const user = await this.prisma.user.findUnique({
      where: { id: userId, isDeleted: false },
      select: { id: true, role: { select: { name: true } } },
    });
    if (!user) throw new NotFoundException('User', userId);

    const accessToken = this.signAccessToken(user.id, user.role.name);
    const { refreshToken, tokenHash, familyId } = this.createRefreshToken(user.id);

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash,
        familyId,
        expiresAt: new Date(
          Date.now() + this.config.get('JWT_REFRESH_TTL_SECONDS', { infer: true }) * 1000,
        ),
      },
    });

    return { accessToken, refreshToken };
  }

  async refresh(rawToken: string) {
    const tokenHash = this.hashToken(rawToken);

    const stored = await this.prisma.refreshToken.findFirst({
      where: { tokenHash },
      include: { user: { select: { id: true, role: { select: { name: true } } } } },
    });

    if (!stored || stored.isRevoked || stored.expiresAt < new Date()) {
      if (stored && !stored.isRevoked) {
        // Token was valid but expired — just revoke it
        await this.prisma.refreshToken.update({
          where: { id: stored.id },
          data: { isRevoked: true },
        });
      } else if (stored?.isRevoked) {
        // Reuse detected — revoke entire family
        await this.prisma.refreshToken.updateMany({
          where: { familyId: stored.familyId },
          data: { isRevoked: true },
        });
      }
      throw new UnauthorizedException('Invalid or expired refresh token', 'TOKEN_EXPIRED');
    }

    // Rotate: revoke old, issue new in same family
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { isRevoked: true },
    });

    const { refreshToken, tokenHash: newHash } = this.createRefreshToken(stored.userId);

    await this.prisma.refreshToken.create({
      data: {
        userId: stored.userId,
        tokenHash: newHash,
        familyId: stored.familyId,
        expiresAt: new Date(
          Date.now() + this.config.get('JWT_REFRESH_TTL_SECONDS', { infer: true }) * 1000,
        ),
      },
    });

    const accessToken = this.signAccessToken(stored.user.id, stored.user.role.name);
    return { accessToken, refreshToken };
  }

  async logout(rawToken: string) {
    const tokenHash = this.hashToken(rawToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, isRevoked: false },
      data: { isRevoked: true },
    });
  }

  async getProfile(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId, isDeleted: false },
      select: PROFILE_SELECT,
    });
    if (!user) throw new NotFoundException('User', userId);
    return toProfile(user);
  }

  async updateProfile(userId: number, dto: UpdateProfileDto) {
    await this.assertUser(userId);
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.firstName !== undefined ? { firstName: dto.firstName } : {}),
        ...(dto.lastName !== undefined ? { lastName: dto.lastName } : {}),
        ...(dto.email !== undefined ? { email: dto.email } : {}),
      },
      select: PROFILE_SELECT,
    });
    return toProfile(user);
  }

  async changePassword(userId: number, currentPassword: string, newPassword: string) {
    const cred = await this.prisma.defaultCredential.findUnique({
      where: { userId },
      select: { id: true, passwordHash: true },
    });
    if (!cred) throw new NotFoundException('Credential', userId);

    const valid = await argon2.verify(cred.passwordHash, currentPassword);
    if (!valid) {
      throw new UnauthorizedException('Current password is incorrect', 'INVALID_CREDENTIALS');
    }

    await this.prisma.defaultCredential.update({
      where: { id: cred.id },
      data: { passwordHash: await argon2.hash(newPassword) },
    });

    // Force other sessions to re-authenticate; the current access token stays
    // valid until it expires (≤15 min).
    await this.prisma.refreshToken.updateMany({
      where: { userId, isRevoked: false },
      data: { isRevoked: true },
    });

    return { changed: true };
  }

  private async assertUser(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId, isDeleted: false },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('User', userId);
  }

  async issueRealtimeTicket(userId: number): Promise<string> {
    const ticketId = randomUUID();
    const ttl = this.config.get('WS_TICKET_TTL_SECONDS', { infer: true });
    await this.redis.set(`rt_ticket:${ticketId}`, String(userId), 'EX', ttl);
    return ticketId;
  }

  private signAccessToken(userId: number, role: string): string {
    return this.jwt.sign({ sub: userId, role });
  }

  private hashToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  private createRefreshToken(userId: number) {
    const refreshToken = randomUUID();
    const tokenHash = this.hashToken(refreshToken);
    const familyId = randomUUID();
    return { refreshToken, tokenHash, familyId };
  }
}
