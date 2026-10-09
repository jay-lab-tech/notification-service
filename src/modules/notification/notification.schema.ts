import { z } from 'zod';

export const sendNotificationSchema = z.object({
  channel: z.enum(['EMAIL', 'PUSH', 'SMS', 'WEBHOOK']),
  recipient: z.string().trim().min(1).max(2048),
  subject: z.string().trim().min(1).max(300).optional(),
  body: z.string().min(1).max(100_000),
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
  userId: z.string().trim().min(1).max(150).optional(),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH']).default('NORMAL'),
  metadata: z.record(z.string(), z.unknown()).optional(),
  scheduledAt: z.iso.datetime().optional(),
}).superRefine((input, context) => {
  if (input.channel === 'EMAIL' && !input.subject) {
    context.addIssue({ code: 'custom', path: ['subject'], message: 'Email notifications require a subject' });
  }
  if (input.channel === 'WEBHOOK' && !z.url().safeParse(input.recipient).success) {
    context.addIssue({ code: 'custom', path: ['recipient'], message: 'Webhook recipient must be a valid URL' });
  }
});

export const listNotificationsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.uuid().optional(),
});

export type SendNotificationInput = z.infer<typeof sendNotificationSchema>;
