import { createTransport } from 'nodemailer';
import type { Notification } from '../generated/prisma/client.js';
import { env } from '../config/env.js';

const smtpTransport = env.EMAIL_MODE === 'smtp' && env.SMTP_URL
  ? createTransport(env.SMTP_URL)
  : null;

export async function sendThroughChannel(notification: Notification): Promise<{
  provider: string;
  providerResponse: Record<string, string | number | boolean>;
}> {
  if (notification.channel !== 'EMAIL') {
    throw new Error(`No provider is configured for ${notification.channel}`);
  }

  if (env.EMAIL_MODE === 'log') {
    return { provider: 'log', providerResponse: { simulated: true } };
  }

  if (!smtpTransport || !env.EMAIL_FROM) throw new Error('SMTP provider is not configured');
  if (!notification.subject) throw new Error('Email notification is missing a subject');

  const result = await smtpTransport.sendMail({
    from: env.EMAIL_FROM,
    to: notification.recipient,
    subject: notification.subject,
    html: notification.body,
  });

  return {
    provider: 'smtp',
    providerResponse: {
      messageId: result.messageId,
      acceptedCount: result.accepted.length,
      rejectedCount: result.rejected.length,
    },
  };
}

export async function closeNotificationSender(): Promise<void> {
  smtpTransport?.close();
}
