import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3003),
  NOTIFICATION_RATE_LIMIT: z.coerce.number().int().min(1).max(10_000).default(10),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  EMAIL_MODE: z.enum(['log', 'smtp']).default('log'),
  SMTP_URL: z.string().url().optional(),
  EMAIL_FROM: z.string().email().optional(),
  WEBHOOK_ALLOWED_HOSTS: z.string().default('').transform((value) => value.split(',').map((host) => host.trim().toLowerCase()).filter(Boolean)),
  WEBHOOK_SIGNING_SECRET: z.string().min(32).optional(),
  FCM_PROJECT_ID: z.string().optional(),
  FCM_CLIENT_EMAIL: z.string().email().optional(),
  FCM_PRIVATE_KEY: z.string().optional(),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM_NUMBER: z.string().optional(),
  TWILIO_STATUS_CALLBACK_URL: z.string().url().optional(),
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

if (env.WEBHOOK_ALLOWED_HOSTS.length > 0 && !env.WEBHOOK_SIGNING_SECRET) {
  console.error('WEBHOOK_SIGNING_SECRET is required when webhook hosts are allowed');
  throw new Error('Webhook provider configuration is incomplete');
}

if ([env.FCM_PROJECT_ID, env.FCM_CLIENT_EMAIL, env.FCM_PRIVATE_KEY].some(Boolean)
  && ![env.FCM_PROJECT_ID, env.FCM_CLIENT_EMAIL, env.FCM_PRIVATE_KEY].every(Boolean)) {
  console.error('FCM_PROJECT_ID, FCM_CLIENT_EMAIL, and FCM_PRIVATE_KEY must be configured together');
  throw new Error('FCM provider configuration is incomplete');
}

if ([env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN, env.TWILIO_FROM_NUMBER].some(Boolean)
  && ![env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN, env.TWILIO_FROM_NUMBER].every(Boolean)) {
  console.error('Twilio account SID, auth token, and from number must be configured together');
  throw new Error('Twilio provider configuration is incomplete');
}

if (env.TWILIO_STATUS_CALLBACK_URL && new URL(env.TWILIO_STATUS_CALLBACK_URL).protocol !== 'https:') {
  console.error('TWILIO_STATUS_CALLBACK_URL must use HTTPS');
  throw new Error('Twilio callback configuration must use HTTPS');
}

if (env.TWILIO_STATUS_CALLBACK_URL && !env.TWILIO_AUTH_TOKEN) {
  console.error('TWILIO_AUTH_TOKEN is required to validate status callbacks');
  throw new Error('Twilio callback signing configuration is incomplete');
}
