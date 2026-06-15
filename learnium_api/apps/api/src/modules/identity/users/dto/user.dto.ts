import { z } from 'zod';

export const CreateUserDtoSchema = z.object({
  employeeId: z.string().min(1).max(50),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  email: z.string().email(),
  roleId: z.number().int().positive(),
  supervisorId: z.number().int().positive().optional(),
  username: z.string().min(1).optional(),
  password: z.string().min(6).optional(),
});

export const UpdateUserDtoSchema = z.object({
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  email: z.string().email().optional(),
  roleId: z.number().int().positive().optional(),
  supervisorId: z.number().int().positive().nullable().optional(),
});

export const UserQueryDtoSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().optional(),
  roleId: z.coerce.number().int().positive().optional(),
});

export type CreateUserDto = z.infer<typeof CreateUserDtoSchema>;
export type UpdateUserDto = z.infer<typeof UpdateUserDtoSchema>;
export type UserQueryDto = z.infer<typeof UserQueryDtoSchema>;
