import { z } from 'zod';

// Providers are configured FROM the master catalog: pick a master, supply a key.
// `name` defaults to the master's display name; `baseUrl` overrides the master's
// default (self-hosted gateways etc.).
export const CreateProviderDtoSchema = z.object({
  masterProviderId: z.number().int().positive(),
  apiKey: z.string().min(1), // write-only; encrypted into credentialRef, never returned
  name: z.string().min(1).max(100).optional(),
  baseUrl: z.string().url().optional(),
  isEnabled: z.boolean().default(true),
  monthlyBudgetUsd: z.number().positive().optional(),
});

// No master/type change after creation — delete and re-add instead. `apiKey`
// present = key rotation (re-encrypt + refresh the masked hint).
export const UpdateProviderDtoSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  baseUrl: z.string().url().nullable().optional(),
  apiKey: z.string().min(1).optional(),
  isEnabled: z.boolean().optional(),
  monthlyBudgetUsd: z.number().positive().nullable().optional(),
});

// Models are picked from the configured provider's master catalog. Metadata
// (kind, pricing, context) is copied from the master; voice metadata (pipeline,
// languages, voices) is always read from the master at runtime.
export const CreateModelDtoSchema = z.object({
  providerId: z.number().int().positive(),
  masterModelId: z.number().int().positive(),
  isDefault: z.boolean().default(false),
});

// Legacy rows (masterModelId null) remain editable; master-linked rows normally
// only toggle isDefault via promote.
export const UpdateModelDtoSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  capabilities: z.array(z.string()).optional(),
  contextWindowTokens: z.number().int().positive().nullable().optional(),
  inputPricePerMillion: z.number().nonnegative().nullable().optional(),
  outputPricePerMillion: z.number().nonnegative().nullable().optional(),
  isDefault: z.boolean().optional(),
});

export const ModelQueryDtoSchema = z.object({
  providerId: z.coerce.number().int().positive().optional(),
  capability: z.string().optional(),
  kind: z.enum(['chat', 'voice']).optional(),
});

export const MasterModelQueryDtoSchema = z.object({
  // Configured provider id — the endpoint resolves its master and lists that
  // master's models (what the admin may add for this provider).
  providerId: z.coerce.number().int().positive(),
  kind: z.enum(['chat', 'voice']).optional(),
});

/** Comma-separated list → string[] (drops blanks); single value also works. */
const csvList = z
  .string()
  .optional()
  .transform((v) =>
    v
      ? v
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [],
  );

export const UsageCallsQueryDtoSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  kind: csvList,
  model: csvList,
});

export type UsageCallsQueryDto = z.infer<typeof UsageCallsQueryDtoSchema>;

export type CreateProviderDto = z.infer<typeof CreateProviderDtoSchema>;
export type UpdateProviderDto = z.infer<typeof UpdateProviderDtoSchema>;
export type CreateModelDto = z.infer<typeof CreateModelDtoSchema>;
export type UpdateModelDto = z.infer<typeof UpdateModelDtoSchema>;
export type ModelQueryDto = z.infer<typeof ModelQueryDtoSchema>;
export type MasterModelQueryDto = z.infer<typeof MasterModelQueryDtoSchema>;
