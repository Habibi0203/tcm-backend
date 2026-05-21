import { z } from 'zod';

const strongPassword = z.string()
  .min(10, 'password minimal 10 karakter')
  .max(128, 'password maksimal 128 karakter')
  .regex(/[a-z]/, 'password harus memuat huruf kecil')
  .regex(/[A-Z]/, 'password harus memuat huruf besar')
  .regex(/[0-9]/, 'password harus memuat angka');

export const registerSchema = z.object({
  email:        z.string().email(),
  username:     z.string().regex(/^[a-z0-9_]{3,50}$/, 'username harus 3-50 karakter, hanya a-z, 0-9, underscore'),
  display_name: z.string().min(2).max(100),
  password:     strongPassword,
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
  new_password: strongPassword,
});
