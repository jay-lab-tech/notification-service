import { createSign, createHmac } from 'node:crypto';
import { resolve4 } from 'node:dns/promises';
import { BlockList, isIPv4 } from 'node:net';
import { request as httpsRequest } from 'node:https';
import { createTransport } from 'nodemailer';
import type { Notification } from '../generated/prisma/client.js';
import { env } from '../config/env.js';

const smtpTransport = env.EMAIL_MODE === 'smtp' && env.SMTP_URL
  ? createTransport(env.SMTP_URL)
  : null;
let fcmAccessToken: { value: string; expiresAt: number } | undefined;
const nonPublicIpv4 = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) nonPublicIpv4.addSubnet(network, prefix, 'ipv4');

type SendResult = {
  provider: string;
  providerResponse: Record<string, string | number | boolean>;
};

async function responseDetails(response: Response): Promise<string> {
  const text = (await response.text()).slice(0, 1_000);
  return text || `HTTP ${response.status}`;
}

async function postWebhook(url: URL, payload: string, address: string, signature: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = httpsRequest(url, {
      method: 'POST',
      timeout: 10_000,
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
        'x-notification-signature': `sha256=${signature}`,
      },
      // Pin the already-validated DNS result to prevent DNS rebinding between validation and connect.
      lookup: (_hostname, _options, callback) => callback(null, address, 4),
    }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => { if (body.length < 1_000) body += chunk.slice(0, 1_000 - body.length); });
      response.on('end', () => resolve({ status: response.statusCode ?? 0, body }));
    });
    request.on('timeout', () => request.destroy(new Error('Webhook request timed out')));
    request.on('error', reject);
    request.end(payload);
  });
}

function isPublicIpv4(address: string): boolean {
  return isIPv4(address) && !nonPublicIpv4.check(address, 'ipv4');
}

async function sendWebhook(notification: Notification): Promise<SendResult> {
  const url = new URL(notification.recipient);
  if (url.protocol !== 'https:' || url.port && url.port !== '443' || url.username || url.password || url.hash) {
    throw new Error('Webhook URLs must use HTTPS on port 443 without credentials or fragments');
  }
  if (!env.WEBHOOK_ALLOWED_HOSTS.includes(url.hostname.toLowerCase())) {
    throw new Error('Webhook host is not in WEBHOOK_ALLOWED_HOSTS');
  }

  const addresses = await resolve4(url.hostname);
  if (addresses.length === 0 || addresses.some((address) => !isPublicIpv4(address))) {
    throw new Error('Webhook host must resolve only to public IPv4 addresses');
  }

  const payload = JSON.stringify({
    id: notification.id,
    channel: notification.channel,
    subject: notification.subject,
    body: notification.body,
    metadata: notification.metadata,
    createdAt: notification.createdAt.toISOString(),
  });
  const signature = createHmac('sha256', env.WEBHOOK_SIGNING_SECRET!).update(payload).digest('hex');
  const response = await postWebhook(url, payload, addresses[0]!, signature);
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Webhook provider returned ${response.status}: ${response.body || `HTTP ${response.status}`}`);
  }
  return { provider: 'webhook', providerResponse: { status: response.status } };
}

async function getFcmAccessToken(): Promise<string> {
  if (fcmAccessToken && fcmAccessToken.expiresAt > Date.now() + 60_000) return fcmAccessToken.value;
  const tokenUri = 'https://oauth2.googleapis.com/token';
  const now = Math.floor(Date.now() / 1_000);
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({
    iss: env.FCM_CLIENT_EMAIL,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: tokenUri,
    iat: now,
    exp: now + 3_600,
  })}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  const assertion = `${unsigned}.${signer.sign(env.FCM_PRIVATE_KEY!.replace(/\\n/g, '\n')).toString('base64url')}`;
  const response = await fetch(tokenUri, {
    method: 'POST',
    signal: AbortSignal.timeout(10_000),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  if (!response.ok) throw new Error(`FCM token exchange failed: HTTP ${response.status}`);
  const token = await response.json() as { access_token: string; expires_in: number };
  fcmAccessToken = { value: token.access_token, expiresAt: Date.now() + token.expires_in * 1_000 };
  return token.access_token;
}

async function sendPush(notification: Notification): Promise<SendResult> {
  if (!env.FCM_PROJECT_ID || !env.FCM_CLIENT_EMAIL || !env.FCM_PRIVATE_KEY) {
    throw new Error('FCM provider is not configured');
  }
  const response = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(env.FCM_PROJECT_ID)}/messages:send`, {
    method: 'POST',
    signal: AbortSignal.timeout(10_000),
    headers: { authorization: `Bearer ${await getFcmAccessToken()}`, 'content-type': 'application/json' },
    body: JSON.stringify({ message: {
      token: notification.recipient,
      notification: { ...(notification.subject ? { title: notification.subject } : {}), body: notification.body },
      data: Object.fromEntries(Object.entries((notification.metadata ?? {}) as Record<string, unknown>)
        .filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value))
        .map(([key, value]) => [key, String(value)])),
    } }),
  });
  if (!response.ok) throw new Error(`FCM provider returned ${response.status}: ${await responseDetails(response)}`);
  const result = await response.json() as { name?: string };
  return { provider: 'fcm', providerResponse: { messageName: result.name ?? 'accepted' } };
}

async function sendSms(notification: Notification): Promise<SendResult> {
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_FROM_NUMBER) {
    throw new Error('Twilio SMS provider is not configured');
  }
  const accountSid = encodeURIComponent(env.TWILIO_ACCOUNT_SID);
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: 'POST',
    signal: AbortSignal.timeout(10_000),
    headers: {
      authorization: `Basic ${Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      From: env.TWILIO_FROM_NUMBER,
      To: notification.recipient,
      Body: notification.body,
      ...(env.TWILIO_STATUS_CALLBACK_URL ? {
        StatusCallback: (() => {
          const callback = new URL(env.TWILIO_STATUS_CALLBACK_URL);
          callback.searchParams.set('notificationId', notification.id);
          return callback.toString();
        })(),
      } : {}),
    }),
  });
  if (!response.ok) throw new Error(`Twilio provider returned ${response.status}: ${await responseDetails(response)}`);
  const result = await response.json() as { sid?: string; status?: string };
  return { provider: 'twilio', providerResponse: { messageSid: result.sid ?? 'accepted', status: result.status ?? 'accepted' } };
}

export async function sendThroughChannel(notification: Notification): Promise<SendResult> {
  if (notification.channel === 'WEBHOOK') return sendWebhook(notification);
  if (notification.channel === 'PUSH') return sendPush(notification);
  if (notification.channel === 'SMS') return sendSms(notification);

  if (env.EMAIL_MODE === 'log') return { provider: 'log', providerResponse: { simulated: true } };
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
