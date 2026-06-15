import { z } from 'zod';

export const PageQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().optional(),
});

export type PageQuery = z.infer<typeof PageQuerySchema>;
