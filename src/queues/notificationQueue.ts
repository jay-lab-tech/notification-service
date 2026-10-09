import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import type { NotificationChannel, NotificationPriority } from '../generated/prisma/client.js';
import { redis } from '../config/redis.js';

const queueNameByChannel: Record<NotificationChannel, string> = {
  EMAIL: 'notifications-email',
  PUSH: 'notifications-push',
  SMS: 'notifications-sms',
  WEBHOOK: 'notifications-webhook',
};

const queues = new Map<NotificationChannel, Queue>();
const queueConnections = new Map<NotificationChannel, Redis>();

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
  await Promise.all([...queueConnections.values()].map(async (connection) => {
    if (connection.status === 'wait') return;
    await connection.quit();
  }));
  queues.clear();
  queueConnections.clear();
}

export async function removeNotificationJob(channel: NotificationChannel, id: string): Promise<void> {
  const job = await queueFor(channel).getJob(`notification-${id}`);
  if (job) await job.remove();
}
