import { z } from 'zod';

export const StartSessionDtoSchema = z.object({
  personaId: z.number().int().positive(),
  simulation: z.boolean().optional(),
});

export const SessionQueryDtoSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  personaId: z.coerce.number().int().positive().optional(),
  userId: z.coerce.number().int().positive().optional(),
  status: z.enum(['ACTIVE', 'COMPLETED', 'ABANDONED']).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export const MessageQueryDtoSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type StartSessionDto = z.infer<typeof StartSessionDtoSchema>;
export type SessionQueryDto = z.infer<typeof SessionQueryDtoSchema>;
export type MessageQueryDto = z.infer<typeof MessageQueryDtoSchema>;
