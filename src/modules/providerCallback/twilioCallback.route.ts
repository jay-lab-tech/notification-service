import { Router } from 'express';
import express from 'express';
import twilio from 'twilio';
import { env } from '../../config/env.js';
import { prisma } from '../../config/database.js';
import { ApiError } from '../../utils/ApiError.js';

export const twilioCallbackRoute = Router();

twilioCallbackRoute.post('/', express.urlencoded({ extended: false, limit: '16kb' }), async (request, response) => {
  if (!env.TWILIO_STATUS_CALLBACK_URL || !env.TWILIO_AUTH_TOKEN) {
    throw new ApiError(404, 'CALLBACK_NOT_CONFIGURED', 'Twilio status callbacks are not configured');
  }

  const notificationId = request.query.notificationId;
  if (typeof notificationId !== 'string') {
    throw new ApiError(400, 'INVALID_CALLBACK', 'Notification callback identifier is missing');
  }

  const expectedUrl = new URL(env.TWILIO_STATUS_CALLBACK_URL);
  expectedUrl.searchParams.set('notificationId', notificationId);
  const receivedUrl = new URL(request.originalUrl, expectedUrl.origin);
  if (receivedUrl.toString() !== expectedUrl.toString()) {
    throw new ApiError(403, 'INVALID_CALLBACK_SIGNATURE', 'Twilio callback URL did not match configuration');
  }

  const signature = request.get('x-twilio-signature') ?? '';
  const parameters = request.body as Record<string, string>;
  if (!twilio.validateRequest(env.TWILIO_AUTH_TOKEN, signature, expectedUrl.toString(), parameters)) {
    throw new ApiError(403, 'INVALID_CALLBACK_SIGNATURE', 'Twilio callback signature is invalid');
  }

  const notification = await prisma.notification.findFirst({
    where: { id: notificationId, channel: 'SMS' },
  });
  if (!notification) throw new ApiError(404, 'NOTIFICATION_NOT_FOUND', 'SMS notification not found');

  const providerStatus = parameters.MessageStatus?.toLowerCase();
  const delivered = providerStatus === 'delivered';
  const failed = providerStatus === 'failed' || providerStatus === 'undelivered';
  const mappedStatus = delivered ? 'DELIVERED' : failed ? 'FAILED' : 'SENT';
  const update = await prisma.notification.updateMany({
    where: { id: notification.id, status: { in: ['QUEUED', 'SENT'] } },
    data: {
      status: mappedStatus,
      ...(delivered ? { deliveredAt: new Date() } : {}),
      ...(failed ? { failedAt: new Date() } : {}),
    },
  });

  if (update.count > 0) {
    await prisma.deliveryLog.create({
      data: {
        notificationId: notification.id,
        channel: 'SMS',
        provider: 'twilio',
        status: failed ? 'FAILED' : 'SUCCESS',
        attemptNumber: Math.max(1, notification.attempts),
        providerResponse: {
          callback: true,
          messageSid: parameters.MessageSid ?? 'unknown',
          messageStatus: providerStatus ?? 'unknown',
          ...(parameters.ErrorCode ? { errorCode: parameters.ErrorCode } : {}),
        },
      },
    });
  }

  response.status(204).end();
});
