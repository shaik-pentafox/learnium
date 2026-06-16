import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { PERMISSIONS_KEY, type Permission } from '../decorators/permissions.decorator';
import type { JwtPayload } from '../decorators/current-user.decorator';
import { ForbiddenException, UnauthorizedException } from '../../errors/domain.errors';
import { ROLE_PERMISSIONS } from '../rbac/role-permissions';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest<FastifyRequest & { user: JwtPayload }>();
    const user = req.user;
    if (!user) throw new UnauthorizedException();

    const rolePerms = ROLE_PERMISSIONS[user.role] ?? [];
    if (!required.every(p => rolePerms.includes(p))) throw new ForbiddenException();
    return true;
  }
}
