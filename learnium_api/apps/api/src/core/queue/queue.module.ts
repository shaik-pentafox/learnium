import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema';

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const url = new URL(config.get('REDIS_URL', { infer: true }));
        return {
          connection: {
            host: url.hostname,
            port: parseInt(url.port) || 6379,
            ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
          },
        };
      },
    }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
