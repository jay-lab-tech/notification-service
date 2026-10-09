import { Worker } from 'bullmq';
import type { Job } from 'bullmq';
import type { NotificationChannel } from '../generated/prisma/client.js';
import { prisma } from '../config/database.js';
import { logger } from '../config/logger.js';
import { redis } from '../config/redis.js';
import { addDeadLetterJob, queueNameByChannel } from '../queues/notificationQueue.js';
import { sendThroughChannel } from '../channels/notificationSender.js';

type NotificationJobData = { notificationId: string };

async function processJob(job: Job<NotificationJobData>, channel: NotificationChannel): Promise<void> {
  const notification = await prisma.notification.findUnique({ where: { id: job.data.notificationId } });
  if (!notification || notification.status !== 'QUEUED') return;

  const startedAt = Date.now();
  const attemptNumber = job.attemptsMade + 1;
  try {
    const result = await sendThroughChannel(notification);
    await prisma.$transaction([
      prisma.notification.update({
        where: { id: notification.id },
        data: { status: 'SENT', sentAt: new Date(), attempts: attemptNumber },
      }),
      prisma.deliveryLog.create({
        data: {
          notificationId: notification.id,
          channel,
          provider: result.provider,
          status: 'SUCCESS',
          attemptNumber,
          durationMs: Date.now() - startedAt,
          providerResponse: result.providerResponse,
        },
      }),
    ]);
    logger.info('Notification delivered to provider', { notificationId: notification.id, channel, provider: result.provider });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 2_000) : 'Unknown provider error';
    const maxAttempts = Number(job.opts.attempts ?? notification.maxAttempts);
    const exhausted = attemptNumber >= maxAttempts;

    await prisma.$transaction([
      prisma.notification.update({
        where: { id: notification.id },
        data: {
          attempts: attemptNumber,
          ...(exhausted ? { status: 'DLQ' as const, failedAt: new Date() } : {}),
        },
      }),
      prisma.deliveryLog.create({
        data: {
          notificationId: notification.id,
          channel,
          provider: channel === 'EMAIL' ? (process.env.EMAIL_MODE === 'smtp' ? 'smtp' : 'log') : 'unconfigured',
          status: 'FAILED',
          attemptNumber,
          errorMessage: message,
          durationMs: Date.now() - startedAt,
        },
      }),
    ]);

    if (exhausted) {
      try {
        await addDeadLetterJob({
          notificationId: notification.id,
          sourceService: notification.sourceService,
          channel,
          error: message,
          failedAt: new Date().toISOString(),
        });
      } catch (dlqError) {
        logger.error('Could not persist notification in dead-letter queue', {
          notificationId: notification.id,
          error: dlqError instanceof Error ? dlqError.message : 'Unknown queue error',
        });
      }
    }

    throw error;
  }
}

export function startNotificationWorkers(): Worker[] {
  const channels = Object.keys(queueNameByChannel) as NotificationChannel[];
  return channels.map((channel) => {
    const connection = redis.duplicate();
    const worker = new Worker<NotificationJobData>(
      queueNameByChannel[channel],
      (job) => processJob(job, channel),
      { connection, concurrency: 10 },
    );
    workerConnections.set(worker, connection);
    worker.on('failed', (job, error) => {
      logger.warn('Notification job attempt failed', {
        notificationId: job?.data.notificationId,
        channel,
        attemptsMade: job?.attemptsMade,
        error: error.message,
      });
    });
    worker.on('error', (error) => logger.error('Notification worker error', { channel, error: error.message }));
    return worker;
  });
}

const workerConnections = new Map<Worker, typeof redis>();

export async function closeNotificationWorkers(workers: Worker[]): Promise<void> {
  await Promise.all(workers.map(async (worker) => {
    await worker.close();
    const connection = workerConnections.get(worker);
    if (connection && connection.status !== 'wait') await connection.quit();
    workerConnections.delete(worker);
  }));
}
