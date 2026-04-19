import { z } from 'zod';

export const registerSchema = z.object({
  email:        z.string().email(),
  username:     z.string().regex(/^[a-z0-9_]{3,50}$/, 'username harus 3-50 karakter, hanya a-z, 0-9, underscore'),
  display_name: z.string().min(2).max(100),
  password:     z.string().min(8),
  profession:   z.enum(['general', 'practitioner', 'student']).default('general'),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const verifyEmailSchema = z.object({
  token: z.string().min(10),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

export const resetPasswordSchema = z.object({
  token:        z.string().min(10),
  new_password: z.string().min(8),
});
