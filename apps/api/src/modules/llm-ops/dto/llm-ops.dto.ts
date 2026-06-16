import { z } from 'zod';

export const CreateProviderDtoSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.string().min(1).max(50),
  baseUrl: z.string().url().optional(),
  apiKey: z.string().min(1).optional(), // write-only; encrypted into credentialRef, never returned
  isEnabled: z.boolean().default(true),
  priority: z.number().int().default(0),
  monthlyBudgetUsd: z.number().positive().optional(),
});

export const UpdateProviderDtoSchema = CreateProviderDtoSchema.partial();

export const CreateModelDtoSchema = z.object({
  name: z.string().min(1).max(200),
  providerId: z.number().int().positive(),
  capabilities: z.array(z.string()).default([]),
  contextWindowTokens: z.number().int().positive().optional(),
  inputPricePerMillion: z.number().nonnegative().optional(),
  outputPricePerMillion: z.number().nonnegative().optional(),
  isDefault: z.boolean().default(false),
});

export const UpdateModelDtoSchema = CreateModelDtoSchema.partial();

export const ModelQueryDtoSchema = z.object({
  providerId: z.coerce.number().int().positive().optional(),
  capability: z.string().optional(),
});

export type CreateProviderDto = z.infer<typeof CreateProviderDtoSchema>;
export type UpdateProviderDto = z.infer<typeof UpdateProviderDtoSchema>;
export type CreateModelDto = z.infer<typeof CreateModelDtoSchema>;
export type UpdateModelDto = z.infer<typeof UpdateModelDtoSchema>;
export type ModelQueryDto = z.infer<typeof ModelQueryDtoSchema>;
