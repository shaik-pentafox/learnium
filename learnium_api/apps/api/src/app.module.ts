import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import { ConfigModule } from './core/config/config.module';
import { LoggerModule } from './core/logger/logger.module';
import { DatabaseModule } from './core/database/database.module';
import { RedisModule } from './core/redis/redis.module';
import { LlmModule } from './core/llm/llm.module';
import { CoreAuthModule } from './core/auth/core-auth.module';
import { AllExceptionsFilter } from './core/errors/all-exceptions.filter';
import { ResponseInterceptor } from './core/envelope/response.interceptor';
import { HealthModule } from './health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { QueueModule } from './core/queue/queue.module';
import { IdentityModule } from './modules/identity/identity.module';
import { PersonasModule } from './modules/personas/personas.module';
import { SessionsModule } from './modules/sessions/sessions.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import type { Env } from './core/config/env.schema';

@Module({
  imports: [
    ConfigModule,
    LoggerModule,
    DatabaseModule,
    RedisModule,
    LlmModule,
    CoreAuthModule,
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        throttlers: [
          {
            ttl: config.get('THROTTLE_TTL_MS', { infer: true }),
            limit: config.get('THROTTLE_LIMIT', { infer: true }),
          },
        ],
      }),
    }),
    HealthModule,
    AuthModule,
    QueueModule,
    IdentityModule,
    PersonasModule,
    SessionsModule,
    RealtimeModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
  ],
})
export class AppModule {}
