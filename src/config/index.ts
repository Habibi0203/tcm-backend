import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV:              z.enum(['development', 'test', 'production']).default('development'),
  PORT:                  z.coerce.number().default(3001),
  APP_URL:               z.string().default('http://localhost:3001'),
  FRONTEND_URL:          z.string().default('http://localhost:3000'),
  CORS_ORIGINS:          z.string().default('http://localhost:3000'),
  JWT_SECRET:            z.string().min(16),
  JWT_REFRESH_SECRET:    z.string().min(16),
  DATABASE_URL:          z.string(),
  REDIS_URL:             z.string().default('redis://localhost:6379'),
  GOOGLE_CLIENT_ID:      z.string().optional().default(''),
  GOOGLE_CLIENT_SECRET:  z.string().optional().default(''),
  GOOGLE_CALLBACK_URL:   z.string().default('http://localhost:3001/auth/google/callback'),
  AGENT_API_KEY:         z.string().min(8),
  BREVO_API_KEY:         z.string().optional().default(''),
  BREVO_SENDER_EMAIL:    z.string().optional().default(''),
  BREVO_SENDER_NAME:     z.string().optional().default('TCM Indonesia'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
export type AppConfig = typeof config;
