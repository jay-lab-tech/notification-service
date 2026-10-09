import express from 'express';
import helmet from 'helmet';
import { healthRoute } from './modules/health/health.route.js';
import { notificationRoute } from './modules/notification/notification.route.js';
import { errorHandler } from './middlewares/errorHandler.js';

export const app = express();

app.disable('x-powered-by');
app.use(helmet());
app.use(express.json({ limit: '256kb' }));

app.get('/health', (_request, response) => {
  response.status(200).json({ data: { status: 'ok' } });
});

app.use('/health', healthRoute);
app.use('/api/notifications', notificationRoute);

app.use((_request, response) => {
  response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
});

app.use(errorHandler);
