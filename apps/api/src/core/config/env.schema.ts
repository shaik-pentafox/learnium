import { z } from 'zod';

export const EnvSchema = z.object({
  // App
  NODE_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  APP_ROLE: z.enum(['api', 'realtime', 'worker']).default('api'),
  PORT: z.coerce.number().int().positive().default(3000),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),

  // Database
  DATABASE_URL: z.string().url(),
  DATABASE_POOL_SIZE: z.coerce.number().int().positive().default(5),

  // Redis
  REDIS_URL: z.string().url(),

  // Auth
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_REFRESH_TTL_SECONDS: z.coerce.number().int().positive().default(604800),
  WS_TICKET_TTL_SECONDS: z.coerce.number().int().positive().default(30),

  // Provider credential encryption (AES-256-GCM key source)
  CREDENTIAL_ENCRYPTION_KEY: z.string().min(32),

  // ClickHouse
  CLICKHOUSE_URL: z.string().url(),
  CLICKHOUSE_DATABASE: z.string().default('traineon'),
  CLICKHOUSE_USERNAME: z.string().default('default'),
  CLICKHOUSE_PASSWORD: z.string().default(''),

  // Rate limiting
  THROTTLE_TTL_MS: z.coerce.number().int().positive().default(60000),
  THROTTLE_LIMIT: z.coerce.number().int().positive().default(100),
  THROTTLE_LOGIN_LIMIT: z.coerce.number().int().positive().default(5),

  // Uploads
  UPLOAD_MAX_VIDEO_MB: z.coerce.number().int().positive().default(500),
  UPLOAD_MAX_DOC_MB: z.coerce.number().int().positive().default(50),

  // Worker
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(5),

  // Sessions — idle ACTIVE sessions older than this are reaped → ABANDONED
  SESSION_IDLE_TIMEOUT_MINUTES: z.coerce.number().int().positive().default(30),

  // Observability
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
  SENTRY_DSN: z.string().optional(),

  // Credential verifier
  CREDENTIAL_VERIFIER: z.enum(['local', 'external']).default('local'),
  EXTERNAL_AUTH_URL: z.string().url().optional(),
});

export type Env = z.infer<typeof EnvSchema>;
