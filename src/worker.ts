import { logger } from './config/logger.js';
import { redis } from './config/redis.js';
import { prisma } from './config/database.js';
import { closeNotificationWorkers, startNotificationWorkers } from './workers/notification.worker.js';
import { closeNotificationSender } from './channels/notificationSender.js';

const workers = startNotificationWorkers();
logger.info('Notification workers started', { channels: workers.length });

let closing = false;
async function shutdown(signal: string): Promise<void> {
  if (closing) return;
  closing = true;
  logger.info('Worker shutdown requested', { signal });
  try {
    await closeNotificationWorkers(workers);
    await closeNotificationSender();
    await prisma.$disconnect();
    if (redis.status !== 'wait') await redis.quit();
  } catch (error) {
    logger.error('Worker shutdown failed', { error: error instanceof Error ? error.message : 'Unknown error' });
    process.exitCode = 1;
  }
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
