import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { ErrorCode } from '@learnium/contracts';
import { DomainException } from './domain.errors';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: string = ErrorCode.INTERNAL_ERROR;
    let message = 'Internal server error';
    let details: unknown;

    if (exception instanceof DomainException) {
      status = exception.getStatus();
      code = exception.code;
      message = exception.message;
      details = exception.details;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'object' && body !== null && 'message' in body) {
        const msg = (body as Record<string, unknown>)['message'];
        message = Array.isArray(msg) ? msg.join('; ') : String(msg);
      } else {
        message = String(body);
      }
      code = status === HttpStatus.TOO_MANY_REQUESTS
        ? ErrorCode.TOO_MANY_REQUESTS
        : status === HttpStatus.UNAUTHORIZED
        ? ErrorCode.UNAUTHORIZED
        : status === HttpStatus.FORBIDDEN
        ? ErrorCode.FORBIDDEN
        : ErrorCode.INTERNAL_ERROR;
    } else {
      this.logger.error({ err: exception, path: request.url }, 'Unhandled exception');
    }

    const requestId = (request.headers['x-request-id'] as string | undefined) ?? '';

    void reply.status(status).send({
      status: 'error',
      code,
      message,
      details: details ?? undefined,
      meta: {
        requestId,
        timestamp: new Date().toISOString(),
      },
    });
  }
}
