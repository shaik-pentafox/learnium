import { z } from 'zod';

// Providers are configured either FROM the master catalog (pick a master, supply
// a key) OR as a custom provider (no master — declare adapterType + name). `name`
// defaults to the master's display name; `baseUrl` overrides the master's default
// (self-hosted gateways etc.).
export const CreateProviderDtoSchema = z
  .object({
    // Master-catalog path: pick a seeded provider.
    masterProviderId: z.number().int().positive().optional(),
    // Custom path (no master): declare the adapter + display name yourself.
    adapterType: z.enum(['openai', 'gemini', 'anthropic', 'custom']).optional(),
    name: z.string().min(1).max(100).optional(),
    apiKey: z.string().min(1), // write-only; encrypted into credentialRef, never returned
    baseUrl: z.string().url().optional(),
    isEnabled: z.boolean().default(true),
    monthlyBudgetUsd: z.number().positive().optional(),
  })
  .refine((d) => d.masterProviderId != null || (!!d.adapterType && !!d.name), {
    message: 'Provide masterProviderId, or adapterType + name for a custom provider',
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

// Models are added either FROM the provider's master catalog (metadata copied
// from the master) OR as a custom model (no master — supply the provider-side id
// + kind, plus optional metadata). Custom VOICE models are rejected in the
// service: voice needs a master catalog entry for languages/voices at runtime.
export const CreateModelDtoSchema = z
  .object({
    providerId: z.number().int().positive(),
    // Master-catalog path.
    masterModelId: z.number().int().positive().optional(),
    // Custom path (no master): provider-side model id + kind (+ optional metadata).
    name: z.string().min(1).max(200).optional(),
    kind: z.enum(['chat', 'voice']).optional(),
    capabilities: z.array(z.string()).optional(),
    contextWindowTokens: z.number().int().positive().optional(),
    inputPricePerMillion: z.number().nonnegative().optional(),
    outputPricePerMillion: z.number().nonnegative().optional(),
    isDefault: z.boolean().default(false),
  })
  .refine((d) => d.masterModelId != null || (!!d.name && !!d.kind), {
    message: 'Provide masterModelId, or name + kind for a custom model',
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
