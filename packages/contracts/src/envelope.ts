import { z } from 'zod';

export const MetaSchema = z.object({
  requestId: z.string().optional(),
  timestamp: z.string().datetime(),
});

export const PaginationMetaSchema = MetaSchema.extend({
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
  totalPages: z.number().int().nonnegative(),
});

export function SuccessEnvelopeSchema<T extends z.ZodTypeAny>(dataSchema: T) {
  return z.object({
    status: z.literal('success'),
    message: z.string(),
    data: dataSchema,
    meta: MetaSchema.optional(),
  });
}

export function PaginatedEnvelopeSchema<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.object({
    status: z.literal('success'),
    message: z.string(),
    data: z.array(itemSchema),
    meta: PaginationMetaSchema,
  });
}

export const ErrorEnvelopeSchema = z.object({
  status: z.literal('error'),
  message: z.string(),
  code: z.string(),
  details: z.unknown().optional(),
  meta: MetaSchema.optional(),
});

export type Meta = z.infer<typeof MetaSchema>;
export type PaginationMeta = z.infer<typeof PaginationMetaSchema>;
export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;
