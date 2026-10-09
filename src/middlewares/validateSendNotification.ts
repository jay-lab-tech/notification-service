import type { RequestHandler } from 'express';
import { ApiError } from '../utils/ApiError.js';
import { sendNotificationSchema } from '../modules/notification/notification.schema.js';

export const validateSendNotification: RequestHandler = (request, response, next) => {
  const parsed = sendNotificationSchema.safeParse(request.body);
  if (!parsed.success) {
    next(new ApiError(400, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid request body'));
    return;
  }
  response.locals.notificationInput = parsed.data;
  next();
};
