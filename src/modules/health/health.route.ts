import { Router } from 'express';
import { prisma } from '../../config/database.js';
import { redis } from '../../config/redis.js';

export const healthRoute = Router();

healthRoute.get('/deep', async (_request, response) => {
  const dependencies: Record<string, 'ok' | 'error'> = { postgres: 'error', redis: 'error' };

  try {
    await prisma.$queryRaw`SELECT 1`;
    dependencies.postgres = 'ok';
  } catch {
    // Keep dependency details out of public health responses.
  }

  try {
    if (redis.status === 'wait') await redis.connect();
    await redis.ping();
    dependencies.redis = 'ok';
  } catch {
    // Keep dependency details out of public health responses.
  }

  const status = Object.values(dependencies).every((value) => value === 'ok') ? 'ok' : 'degraded';
  response.status(status === 'ok' ? 200 : 503).json({ data: { status, dependencies } });
});
