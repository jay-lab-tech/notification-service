import { createHash } from 'node:crypto';
import type { RequestHandler } from 'express';
import { env } from '../config/env.js';
import { redis } from '../config/redis.js';
import { ApiError } from '../utils/ApiError.js';
import type { SendNotificationInput } from '../modules/notification/notification.schema.js';

const incrementWindowScript = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
return { count, ttl }
`;

export async function consumeNotificationRateLimit(
  serviceName: string,
  input: Pick<SendNotificationInput, 'channel' | 'recipient'>,
): Promise<void> {
  const recipientHash = createHash('sha256').update(input.recipient.trim().toLowerCase()).digest('hex');
  const key = `notification:rate:${serviceName}:${input.channel}:${recipientHash}`;
  const result = await redis.eval(incrementWindowScript, 1, key, '60000') as [number, number];
  const [count, ttlMilliseconds] = result;
  if (count > env.NOTIFICATION_RATE_LIMIT) {
    const retryAfterSeconds = Math.max(1, Math.ceil(ttlMilliseconds / 1000));
    throw new ApiError(429, 'RATE_LIMIT_EXCEEDED', `Notification limit reached; retry in ${retryAfterSeconds}s`);
  }
}

export const notificationRateLimit: RequestHandler = async (request, response, next) => {
  const serviceName = request.apiKey?.serviceName;
  const input = response.locals.notificationInput as SendNotificationInput | undefined;
  if (!serviceName || !input) {
    next(new ApiError(500, 'RATE_LIMIT_CONTEXT_MISSING', 'Could not evaluate notification rate limit'));
    return;
  }
  await consumeNotificationRateLimit(serviceName, input);
  next();
};
