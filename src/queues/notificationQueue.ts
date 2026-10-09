import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import type { NotificationChannel, NotificationPriority } from '../generated/prisma/client.js';
import { redis } from '../config/redis.js';
import { prisma } from '../config/database.js';

export const queueNameByChannel: Record<NotificationChannel, string> = {
  EMAIL: 'notifications-email',
  PUSH: 'notifications-push',
  SMS: 'notifications-sms',
  WEBHOOK: 'notifications-webhook',
};

const queues = new Map<NotificationChannel, Queue>();
const queueConnections = new Map<NotificationChannel, Redis>();
let deadLetterQueue: Queue | undefined;
let deadLetterConnection: Redis | undefined;

function deadLetterQueueFor(): Queue {
  if (!deadLetterQueue) {
    deadLetterConnection = redis.duplicate();
    deadLetterQueue = new Queue('notifications-dead-letter', {
      connection: deadLetterConnection,
      defaultJobOptions: { removeOnComplete: false, removeOnFail: false },
    });
  }
  return deadLetterQueue;
}

function queueFor(channel: NotificationChannel): Queue {
  let queue = queues.get(channel);
  if (!queue) {
    const connection = redis.duplicate();
    queue = new Queue(queueNameByChannel[channel], {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2_000 },
        removeOnComplete: 1_000,
        removeOnFail: false,
      },
    });
    queues.set(channel, queue);
    queueConnections.set(channel, connection);
  }
  return queue;
}

export async function enqueueNotification(input: {
  id: string;
  channel: NotificationChannel;
  priority: NotificationPriority;
  scheduledAt?: Date | null;
}): Promise<void> {
  const delay = input.scheduledAt ? Math.max(0, input.scheduledAt.getTime() - Date.now()) : 0;
  await queueFor(input.channel).add(
    'deliver',
    { notificationId: input.id },
    {
      jobId: `notification-${input.id}`,
      priority: input.priority === 'HIGH' ? 1 : input.priority === 'LOW' ? 10 : 5,
      delay,
    },
  );
}

export async function closeNotificationQueues(): Promise<void> {
  await Promise.all([...queues.values()].map((queue) => queue.close()));
  if (deadLetterQueue) await deadLetterQueue.close();
  await Promise.all([...queueConnections.values()].map(async (connection) => {
    if (connection.status === 'wait') return;
    await connection.quit();
  }));
  if (deadLetterConnection && deadLetterConnection.status !== 'wait') await deadLetterConnection.quit();
  queues.clear();
  queueConnections.clear();
  deadLetterQueue = undefined;
  deadLetterConnection = undefined;
}

export async function removeNotificationJob(channel: NotificationChannel, id: string): Promise<void> {
  const job = await queueFor(channel).getJob(`notification-${id}`);
  if (job) await job.remove();
}

export async function addDeadLetterJob(data: {
  notificationId: string;
  sourceService: string;
  channel: NotificationChannel;
  error: string;
  failedAt: string;
}): Promise<void> {
  await deadLetterQueueFor().add('failed', data, { jobId: `dead-${data.notificationId}` });
}

export async function removeDeadLetterJob(notificationId: string): Promise<void> {
  const job = await deadLetterQueueFor().getJob(`dead-${notificationId}`);
  if (job) await job.remove();
}

export async function getDeadLetterJobs(sourceService?: string) {
  const jobs = await deadLetterQueueFor().getJobs(['waiting', 'active', 'failed'], 0, 199, true);
  return jobs
    .filter((job) => !sourceService || job.data.sourceService === sourceService)
    .map((job) => ({
      id: job.id,
      notificationId: job.data.notificationId,
      channel: job.data.channel,
      failedAt: job.data.failedAt,
      error: job.data.error,
    }));
}

export async function retryDeadLetterJob(id: string, sourceService: string): Promise<string | null> {
  const queue = deadLetterQueueFor();
  const job = await queue.getJob(id);
  if (!job || job.data.sourceService !== sourceService) return null;

  const notificationId = String(job.data.notificationId);
  const channel = job.data.channel as NotificationChannel;
  const notification = await prismaNotificationForRetry(notificationId, sourceService);
  if (!notification) return null;
  if (!['DLQ', 'FAILED'].includes(notification.status)) return null;

  const originalJob = await queueFor(channel).getJob(`notification-${notificationId}`);
  if (originalJob) await originalJob.remove();
  await prismaResetForRetry(notificationId);
  try {
    await enqueueNotification({ id: notification.id, channel, priority: notification.priority });
  } catch (error) {
    await prisma.notification.update({
      where: { id: notificationId },
      data: { status: 'DLQ', failedAt: new Date() },
    });
    throw error;
  }
  await job.remove();
  return notificationId;
}

async function prismaNotificationForRetry(id: string, sourceService: string) {
  return prisma.notification.findFirst({ where: { id, sourceService } });
}

async function prismaResetForRetry(id: string): Promise<void> {
  await prisma.notification.update({
    where: { id },
    data: { status: 'QUEUED', failedAt: null, attempts: 0 },
  });
}

export async function getNotificationQueueCounts() {
  const result: Record<string, Record<string, number>> = {};
  for (const [channel, name] of Object.entries(queueNameByChannel)) {
    const queue = queueFor(channel as NotificationChannel);
    const counts = await queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
    result[name] = counts;
  }
  const dlqCounts = await deadLetterQueueFor().getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
  result['notifications-dead-letter'] = dlqCounts;
  return result;
}
