import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3003),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  EMAIL_MODE: z.enum(['log', 'smtp']).default('log'),
  SMTP_URL: z.string().url().optional(),
  EMAIL_FROM: z.string().email().optional(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  TRUST_PROXY: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration', parsed.error.flatten().fieldErrors);
  throw new Error('Environment validation failed');
}

export const env = parsed.data;

if (env.EMAIL_MODE === 'smtp' && (!env.SMTP_URL || !env.EMAIL_FROM)) {
  console.error('SMTP_URL and EMAIL_FROM are required when EMAIL_MODE=smtp');
  throw new Error('Email provider configuration is incomplete');
}
