import { z } from 'zod';

export const LoginDtoSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export type LoginDto = z.infer<typeof LoginDtoSchema>;

export const RefreshDtoSchema = z.object({
  refreshToken: z.string().min(1),
});

export type RefreshDto = z.infer<typeof RefreshDtoSchema>;
