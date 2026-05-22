import { z } from 'zod';

export const allowedUserInterests = [
  'akupunktur',
  'herbal',
  'diet-tcm',
  'qigong',
  'teori-dasar',
  'kasus-klinis',
  'praktisi',
  'komunitas',
] as const;

export const userInterestSchema = z.enum(allowedUserInterests);

export const updateMeSchema = z.object({
  display_name: z.string().min(2).max(100).optional(),
  bio:          z.string().max(500).nullable().optional(),
  avatar_url:   z.string().url().nullable().optional(),
  profession:   z.enum(['general', 'practitioner', 'student']).optional(),
  interests:    z.array(userInterestSchema).max(8).optional(),
});
export type UpdateMeInput = z.infer<typeof updateMeSchema>;

export const changePasswordSchema = z.object({
  current_password: z.string().min(1),
  new_password:     z.string().min(8),
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
