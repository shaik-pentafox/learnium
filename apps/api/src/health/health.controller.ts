import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Public } from '../core/auth/decorators/public.decorator';
import type { Env } from '../core/config/env.schema';

interface ProbeResult {
  status: 'ok' | 'fail';
  latencyMs?: number;
  error?: string;
}

interface ReadyResponse {
  status: 'ok' | 'degraded';
  probes: Record<string, ProbeResult>;
}

@Controller()
export class HealthController {
  constructor(private readonly config: ConfigService<Env, true>) {}

  @Public()
  @Get('health')
  liveness(): { status: string; timestamp: string } {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Public()
  @Get('ready')
  async readiness(): Promise<ReadyResponse> {
    const results = await Promise.allSettled([
      this.probePostgres(),
      this.probeRedis(),
      this.probeClickHouse(),
    ]);

    const probes: Record<string, ProbeResult> = {
      postgres: results[0]?.status === 'fulfilled' ? results[0].value : { status: 'fail', error: String((results[0] as PromiseRejectedResult).reason) },
      redis: results[1]?.status === 'fulfilled' ? results[1].value : { status: 'fail', error: String((results[1] as PromiseRejectedResult).reason) },
      clickhouse: results[2]?.status === 'fulfilled' ? results[2].value : { status: 'fail', error: String((results[2] as PromiseRejectedResult).reason) },
    };

    const allOk = Object.values(probes).every((p) => p.status === 'ok');
    return { status: allOk ? 'ok' : 'degraded', probes };
  }

  private async probePostgres(): Promise<ProbeResult> {
    const start = Date.now();
    try {
      // Prisma client is not available yet in scaffold; raw pg check
      const { Client } = await import('pg');
      const client = new Client({ connectionString: this.config.get('DATABASE_URL', { infer: true }) });
      await client.connect();
      await client.query('SELECT 1');
      await client.end();
      return { status: 'ok', latencyMs: Date.now() - start };
    } catch (err) {
      return { status: 'fail', error: (err as Error).message };
    }
  }

  private async probeRedis(): Promise<ProbeResult> {
    const start = Date.now();
    let client: import('ioredis').Redis | undefined;
    try {
      const { default: Redis } = await import('ioredis');
      client = new Redis(this.config.get('REDIS_URL', { infer: true }), {
        maxRetriesPerRequest: 1,
        connectTimeout: 3000,
        retryStrategy: () => null,
      });
      await new Promise<void>((resolve, reject) => {
        client!.once('ready', resolve);
        client!.once('error', reject);
      });
      await client.ping();
      return { status: 'ok', latencyMs: Date.now() - start };
    } catch (err) {
      return { status: 'fail', error: (err as Error).message };
    } finally {
      if (client) client.disconnect();
    }
  }

  private async probeClickHouse(): Promise<ProbeResult> {
    const start = Date.now();
    try {
      const { createClient } = await import('@clickhouse/client');
      const client = createClient({
        url: this.config.get('CLICKHOUSE_URL', { infer: true }),
        database: this.config.get('CLICKHOUSE_DATABASE', { infer: true }),
        username: this.config.get('CLICKHOUSE_USERNAME', { infer: true }),
        password: this.config.get('CLICKHOUSE_PASSWORD', { infer: true }),
        request_timeout: 3000,
      });
      await client.ping();
      await client.close();
      return { status: 'ok', latencyMs: Date.now() - start };
    } catch (err) {
      return { status: 'fail', error: (err as Error).message };
    }
  }
}
