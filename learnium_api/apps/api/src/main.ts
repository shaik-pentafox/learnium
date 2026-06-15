import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import fastifyMultipart from '@fastify/multipart';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import type { Env } from './core/config/env.schema';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false }),
    { bufferLogs: true },
  );

  app.useLogger(app.get(Logger));
  await app.register(fastifyMultipart, { limits: { fileSize: 50 * 1024 * 1024 } });

  const config = app.get(ConfigService<Env, true>);
  const port = config.get('PORT', { infer: true });
  const corsOrigins = config
    .get('CORS_ORIGINS', { infer: true })
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  app.enableCors({ origin: corsOrigins, credentials: true });
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'ready'] });

  await app.listen(port, '0.0.0.0');
}

void bootstrap();
