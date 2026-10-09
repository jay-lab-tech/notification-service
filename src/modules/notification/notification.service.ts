import { Prisma } from '../../generated/prisma/client.js';
import type { NotificationChannel, NotificationPriority } from '../../generated/prisma/client.js';
import { prisma } from '../../config/database.js';
import { enqueueNotification } from '../../queues/notificationQueue.js';
import { renderNotificationTemplate } from '../../templates/renderer.js';
import { ApiError } from '../../utils/ApiError.js';
import type { SendNotificationInput } from './notification.schema.js';

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

async function ensureQueued(notification: Awaited<ReturnType<typeof prisma.notification.create>>) {
  let current = notification;
  if (current.status === 'FAILED' && current.attempts === 0) {
    current = await prisma.notification.update({
      where: { id: current.id },
      data: { status: 'QUEUED', failedAt: null },
    });
  }

  if (current.status !== 'QUEUED') return current;

  try {
    await enqueueNotification({
      id: current.id,
      channel: current.channel,
      priority: current.priority,
      scheduledAt: current.scheduledAt,
    });
    return current;
  } catch {
    await prisma.notification.update({
      where: { id: current.id },
      data: { status: 'FAILED', failedAt: new Date() },
    });
    throw new ApiError(503, 'QUEUE_UNAVAILABLE', 'Notification could not be queued; retry with the same idempotency key');
  }
}

export async function sendNotification(sourceService: string, input: SendNotificationInput) {
  if (input.idempotencyKey) {
    const existing = await prisma.notification.findUnique({
      where: { sourceService_idempotencyKey: { sourceService, idempotencyKey: input.idempotencyKey } },
    });
    if (existing) {
      return { notification: await ensureQueued(existing), duplicate: true };
    }
  }

  let notification;
  const rendered = input.templateCode
    ? await renderNotificationTemplate({
      sourceService,
      code: input.templateCode,
      channel: input.channel as NotificationChannel,
      variables: input.variables ?? {},
    })
    : { code: null, subject: input.subject ?? null, body: input.body ?? '' };

  try {
    notification = await prisma.notification.create({
      data: {
        sourceService,
        channel: input.channel as NotificationChannel,
        recipient: input.recipient,
        body: rendered.body,
        priority: input.priority as NotificationPriority,
        ...(input.userId ? { userId: input.userId } : {}),
        ...(rendered.subject ? { subject: rendered.subject } : {}),
        ...(rendered.code ? { templateCode: rendered.code } : {}),
        ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
        ...(input.metadata ? { metadata: input.metadata as Prisma.InputJsonValue } : {}),
        ...(input.scheduledAt ? { scheduledAt: new Date(input.scheduledAt) } : {}),
      },
    });
  } catch (error) {
    if (!input.idempotencyKey || !isUniqueConstraintError(error)) throw error;
    const raced = await prisma.notification.findUnique({
      where: { sourceService_idempotencyKey: { sourceService, idempotencyKey: input.idempotencyKey } },
    });
    if (!raced) throw error;
    return { notification: await ensureQueued(raced), duplicate: true };
  }

  notification = await ensureQueued(notification);

  return { notification, duplicate: false };
}

export async function getNotificationForService(id: string, sourceService: string) {
  const notification = await prisma.notification.findFirst({ where: { id, sourceService } });
  if (!notification) throw new ApiError(404, 'NOTIFICATION_NOT_FOUND', 'Notification not found');
  return notification;
}

export async function listNotificationsForService(
  sourceService: string,
  options: { limit: number; cursor?: string },
) {
  const rows = await prisma.notification.findMany({
    where: { sourceService },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: options.limit + 1,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > options.limit;
  const items = hasMore ? rows.slice(0, options.limit) : rows;
  return {
    items,
    nextCursor: hasMore ? items.at(-1)?.id ?? null : null,
  };
}
