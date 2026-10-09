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
  fallback: z.object({
    channel: z.enum(['EMAIL', 'PUSH', 'SMS', 'WEBHOOK']),
    recipient: z.string().trim().min(1).max(2048),
    subject: z.string().trim().min(1).max(300).optional(),
    body: z.string().min(1).max(100_000),
  }).optional(),
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
  if (input.channel === 'WEBHOOK') validateWebhookUrl(input.recipient, context, ['recipient']);
  if (input.channel === 'SMS' && !/^\+[1-9]\d{7,14}$/.test(input.recipient)) {
    context.addIssue({ code: 'custom', path: ['recipient'], message: 'SMS recipient must be an E.164 phone number' });
  }
  if (input.fallback) {
    if (input.fallback.channel === input.channel) {
      context.addIssue({ code: 'custom', path: ['fallback', 'channel'], message: 'Fallback channel must differ from the primary channel' });
    }
    if (input.fallback.channel === 'EMAIL' && !input.fallback.subject) {
      context.addIssue({ code: 'custom', path: ['fallback', 'subject'], message: 'Email fallback requires a subject' });
    }
    if (input.fallback.channel === 'SMS' && !/^\+[1-9]\d{7,14}$/.test(input.fallback.recipient)) {
      context.addIssue({ code: 'custom', path: ['fallback', 'recipient'], message: 'SMS fallback recipient must use E.164 format' });
    }
    if (input.fallback.channel === 'WEBHOOK') validateWebhookUrl(input.fallback.recipient, context, ['fallback', 'recipient']);
  }
});

function validateWebhookUrl(value: string, context: z.RefinementCtx, path: Array<string | number>): void {
  if (!z.url().safeParse(value).success) {
    context.addIssue({ code: 'custom', path, message: 'Webhook recipient must be a valid HTTPS URL' });
    return;
  }
  const url = new URL(value);
  if (url.protocol !== 'https:' || (url.port && url.port !== '443') || url.username || url.password || url.hash) {
    context.addIssue({ code: 'custom', path, message: 'Webhook URL must use HTTPS on port 443 without credentials or fragments' });
  }
}

export const listNotificationsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.uuid().optional(),
});

export const bulkNotificationsSchema = z.object({
  notifications: z.array(sendNotificationSchema).min(1).max(100),
});

export type SendNotificationInput = z.infer<typeof sendNotificationSchema>;
