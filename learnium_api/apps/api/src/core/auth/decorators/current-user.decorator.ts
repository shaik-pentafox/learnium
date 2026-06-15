import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

export interface JwtPayload {
  sub: number;
  role: string;
  iat: number;
  exp: number;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtPayload => {
    const request = ctx.switchToHttp().getRequest<FastifyRequest & { user: JwtPayload }>();
    return request.user;
  },
);
