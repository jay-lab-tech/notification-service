import { Router } from 'express';
import { apiKeyAuth } from '../../middlewares/apiKeyAuth.js';
import {
  getNotificationController,
  listNotificationsController,
  sendNotificationController,
} from './notification.controller.js';

export const notificationRoute = Router();

notificationRoute.use(apiKeyAuth);
notificationRoute.post('/send', sendNotificationController);
notificationRoute.get('/', listNotificationsController);
notificationRoute.get('/:id', getNotificationController);
