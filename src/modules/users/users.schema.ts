import { z } from 'zod';

export const updateMeSchema = z.object({
  display_name: z.string().min(2).max(100).optional(),
  bio:          z.string().max(500).nullable().optional(),
  avatar_url:   z.string().url().nullable().optional(),
});
export type UpdateMeInput = z.infer<typeof updateMeSchema>;

export const changePasswordSchema = z.object({
  current_password: z.string().min(1),
  new_password:     z.string().min(8),
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
