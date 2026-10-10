import express from 'express';
import helmet from 'helmet';
import path from 'node:path';
import { healthRoute } from './modules/health/health.route.js';
import { notificationRoute } from './modules/notification/notification.route.js';
import { templateRoute } from './modules/template/template.route.js';
import { deadLetterRoute } from './modules/deadLetter/deadLetter.route.js';
import { errorHandler } from './middlewares/errorHandler.js';
import { twilioCallbackRoute } from './modules/providerCallback/twilioCallback.route.js';

export const app = express();

app.disable('x-powered-by');
app.use(helmet());
app.use(express.json({ limit: '256kb' }));

app.get(['/docs', '/docs/'], (_request, response) => {
  response.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' https://unpkg.com; style-src 'self' https://unpkg.com 'unsafe-inline'; img-src 'self' data: https:; object-src 'none'; base-uri 'self'",
  );
  response.sendFile(path.resolve('docs/index.html'));
});
app.use('/docs', express.static('docs'));

app.use('/api/providers/twilio/status', twilioCallbackRoute);

app.get('/health', (_request, response) => {
  response.status(200).json({ data: { status: 'ok' } });
});

app.use('/health', healthRoute);
app.use('/api/notifications', notificationRoute);
app.use('/api/templates', templateRoute);
app.use('/api/dead-letter', deadLetterRoute);

app.use((_request, response) => {
  response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
});

app.use(errorHandler);
