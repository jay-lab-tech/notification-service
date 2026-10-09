import { app } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { prisma } from './config/database.js';
import { redis } from './config/redis.js';
import { closeNotificationQueues } from './queues/notificationQueue.js';

const server = app.listen(env.PORT, () => {
  logger.info('Notification Service listening', { port: env.PORT, environment: env.NODE_ENV });
});

function shutdown(signal: string): void {
  logger.info('Shutdown requested', { signal });
  server.close((error) => {
    if (error) {
      logger.error('HTTP server shutdown failed', { error: error.message });
      process.exitCode = 1;
    }
    void Promise.all([
      prisma.$disconnect(),
      closeNotificationQueues(),
      redis.status === 'wait' ? Promise.resolve() : redis.quit(),
    ]).catch((shutdownError: unknown) => {
      logger.error('Dependency shutdown failed', {
        error: shutdownError instanceof Error ? shutdownError.message : 'Unknown error',
      });
      process.exitCode = 1;
    });
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
