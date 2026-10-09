import type { RequestHandler } from 'express';
import { bulkNotificationsSchema, listNotificationsQuerySchema } from './notification.schema.js';
import {
  getNotificationForService,
  listNotificationsForService,
  sendNotification,
} from './notification.service.js';
import { ApiError } from '../../utils/ApiError.js';
import type { SendNotificationInput } from './notification.schema.js';
import { consumeNotificationRateLimit } from '../../middlewares/notificationRateLimit.js';

function authenticatedService(request: Express.Request): string {
  if (!request.apiKey) throw new ApiError(401, 'API_KEY_REQUIRED', 'A valid API key is required');
  return request.apiKey.serviceName;
}

export const sendNotificationController: RequestHandler = async (request, response) => {
  const input = response.locals.notificationInput as SendNotificationInput;
  const result = await sendNotification(authenticatedService(request), input);
  response.status(202).json({
    data: {
      id: result.notification.id,
      status: result.notification.status,
      channel: result.notification.channel,
      recipient: result.notification.recipient,
      createdAt: result.notification.createdAt,
      duplicate: result.duplicate,
    },
  });
};

export const bulkNotificationsController: RequestHandler = async (request, response) => {
  const parsed = bulkNotificationsSchema.safeParse(request.body);
  if (!parsed.success) {
    throw new ApiError(400, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid bulk request');
  }

  const sourceService = authenticatedService(request);
  const results: Array<Record<string, string | number | boolean>> = [];
  for (const [index, input] of parsed.data.notifications.entries()) {
    try {
      await consumeNotificationRateLimit(sourceService, input);
      const result = await sendNotification(sourceService, input);
      results.push({ index, id: result.notification.id, status: result.notification.status, duplicate: result.duplicate });
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      results.push({ index, error: error.code, message: error.message });
    }
  }

  const accepted = results.filter((result) => 'id' in result).length;
  response.status(202).json({ data: { accepted, rejected: results.length - accepted, results } });
};

export const getNotificationController: RequestHandler = async (request, response) => {
  const rawId = request.params.id;
  const id = Array.isArray(rawId) ? rawId[0] ?? '' : rawId ?? '';
  const notification = await getNotificationForService(id, authenticatedService(request));
  response.json({ data: notification });
};

export const listNotificationsController: RequestHandler = async (request, response) => {
  const parsed = listNotificationsQuerySchema.safeParse(request.query);
  if (!parsed.success) {
    throw new ApiError(400, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid query parameters');
  }

  const result = await listNotificationsForService(authenticatedService(request), {
    limit: parsed.data.limit,
    ...(parsed.data.cursor ? { cursor: parsed.data.cursor } : {}),
  });
  response.json({ data: result });
};
