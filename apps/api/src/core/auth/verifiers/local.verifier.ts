import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { PrismaService } from '../../database/prisma.service';
import type { CredentialVerifier } from './credential-verifier.interface';

@Injectable()
export class LocalVerifier implements CredentialVerifier {
  constructor(private readonly prisma: PrismaService) {}

  async verify(username: string, password: string): Promise<number | null> {
    const cred = await this.prisma.defaultCredential.findUnique({
      where: { username },
      select: { passwordHash: true, userId: true },
    });
    if (!cred) return null;

    const valid = await argon2.verify(cred.passwordHash, password);
    return valid ? cred.userId : null;
  }
}
