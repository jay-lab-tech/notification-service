import { z } from 'zod';

export const sendNotificationSchema = z.object({
  channel: z.enum(['EMAIL', 'PUSH', 'SMS', 'WEBHOOK']),
  recipient: z.string().trim().min(1).max(2048),
  subject: z.string().trim().min(1).max(300).optional(),
  body: z.string().min(1).max(100_000).optional(),
  templateCode: z.string().trim().min(1).max(100).optional(),
  variables: z.record(z.string(), z.unknown()).optional(),
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
  userId: z.string().trim().min(1).max(150).optional(),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH']).default('NORMAL'),
  metadata: z.record(z.string(), z.unknown()).optional(),
  scheduledAt: z.iso.datetime().optional(),
}).superRefine((input, context) => {
  if (!input.templateCode && !input.body) {
    context.addIssue({ code: 'custom', path: ['body'], message: 'Provide either body or templateCode' });
  }
  if (input.templateCode && (input.body || input.subject)) {
    context.addIssue({ code: 'custom', path: ['templateCode'], message: 'Do not include subject/body when using a template' });
  }
  if (input.channel === 'EMAIL' && !input.templateCode && !input.subject) {
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

export const bulkNotificationsSchema = z.object({
  notifications: z.array(sendNotificationSchema).min(1).max(100),
});

export type SendNotificationInput = z.infer<typeof sendNotificationSchema>;
