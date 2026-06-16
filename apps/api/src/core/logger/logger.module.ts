import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import type { Env } from '../config/env.schema';

@Global()
@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        pinoHttp: {
          level: config.get('LOG_LEVEL', { infer: true }),
          ...(config.get('NODE_ENV', { infer: true }) === 'development'
            ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
            : {}),
          genReqId: (req) => {
            const existing = req.headers['x-request-id'];
            if (typeof existing === 'string' && existing) return existing;
            const id = randomUUID();
            req.headers['x-request-id'] = id;
            return id;
          },
          redact: ['req.headers.authorization', 'req.headers.cookie'],
          customSuccessMessage: (req, res) =>
            `${req.method} ${req.url} → ${res.statusCode}`,
          customErrorMessage: (req, res, err) =>
            `${req.method} ${req.url} → ${res.statusCode} [${err.message}]`,
        },
      }),
    }),
  ],
})
export class LoggerModule {}
