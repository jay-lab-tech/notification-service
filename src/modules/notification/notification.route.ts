import { Router } from 'express';
import { apiKeyAuth } from '../../middlewares/apiKeyAuth.js';
import { notificationRateLimit } from '../../middlewares/notificationRateLimit.js';
import { validateSendNotification } from '../../middlewares/validateSendNotification.js';
import {
  bulkNotificationsController,
  getNotificationController,
  listNotificationsController,
  sendNotificationController,
} from './notification.controller.js';

export const notificationRoute = Router();

notificationRoute.use(apiKeyAuth);
notificationRoute.post('/bulk', bulkNotificationsController);
notificationRoute.post('/send', validateSendNotification, notificationRateLimit, sendNotificationController);
notificationRoute.get('/', listNotificationsController);
notificationRoute.get('/:id', getNotificationController);
