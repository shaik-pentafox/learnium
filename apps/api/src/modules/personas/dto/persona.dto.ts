import { z } from 'zod';
import { PersonaTemplateSchema } from '../../../core/llm/persona-prompt.template';

export const ScoreCriterionSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  maxScore: z.number().int().min(1).max(100).default(10),
  weight: z.number().min(0.1).max(10).default(1.0),
  order: z.number().int().min(0).default(0),
});

export const CreatePersonaDtoSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  // Trainers supply structured template fields; the runtime systemPrompt is
  // rendered from these (see core/llm/persona-prompt.template). No raw prompt.
  template: PersonaTemplateSchema,
  voiceStyleId: z.number().int().positive().optional(),
  conversationModelId: z.number().int().positive().optional(),
  scoringModelId: z.number().int().positive().optional(),
  scoreCriteria: z.array(ScoreCriterionSchema).optional(),
});

export const UpdatePersonaDtoSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().optional(),
  template: PersonaTemplateSchema.optional(),
  voiceStyleId: z.number().int().positive().nullable().optional(),
  conversationModelId: z.number().int().positive().nullable().optional(),
  scoringModelId: z.number().int().positive().nullable().optional(),
  scoreCriteria: z.array(ScoreCriterionSchema).optional(),
});

export const PersonaQueryDtoSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().optional(),
});

export const EnhanceDtoSchema = z.object({
  field: z.enum(['systemPrompt', 'customInstructions']).default('systemPrompt'),
  instruction: z.string().optional(),
});

export type CreatePersonaDto = z.infer<typeof CreatePersonaDtoSchema>;
export type UpdatePersonaDto = z.infer<typeof UpdatePersonaDtoSchema>;
export type PersonaQueryDto = z.infer<typeof PersonaQueryDtoSchema>;
export type EnhanceDto = z.infer<typeof EnhanceDtoSchema>;
