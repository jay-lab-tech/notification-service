import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.PORT = '3003';
process.env.DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:5436/notification_service?schema=public';
process.env.REDIS_URL = 'redis://127.0.0.1:6383';
process.env.EMAIL_MODE = 'log';

const [{ app }, { prisma }, { createApiKey }, queueModule, workerModule] = await Promise.all([
  import('../src/app.js'),
  import('../src/config/database.js'),
  import('../src/utils/apiKey.js'),
  import('../src/queues/notificationQueue.js'),
  import('../src/workers/notification.worker.js'),
]);
const { redis } = await import('../src/config/redis.js');

const ownerKey = createApiKey();
const secondKey = createApiKey();
const ownerService = `test-owner-${randomUUID().slice(0, 8)}`;
const secondService = `test-other-${randomUUID().slice(0, 8)}`;
const createdNotifications: Array<{ id: string; channel: 'EMAIL' | 'PUSH' | 'SMS' | 'WEBHOOK' }> = [];
const workers = workerModule.startNotificationWorkers();
const server = app.listen(0);
let baseUrl = '';

before(async () => {
  await prisma.apiKey.createMany({
    data: [
      { name: 'integration-test-owner', serviceName: ownerService, keyHash: ownerKey.hash },
      { name: 'integration-test-other', serviceName: secondService, keyHash: secondKey.hash },
    ],
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await workerModule.closeNotificationWorkers(workers);
  for (const notification of createdNotifications) {
    await queueModule.removeNotificationJob(notification.channel, notification.id);
    await queueModule.removeDeadLetterJob(notification.id);
  }
  await queueModule.closeNotificationQueues();
  await prisma.notification.deleteMany({ where: { sourceService: { in: [ownerService, secondService] } } });
  await prisma.template.deleteMany({ where: { sourceService: { in: [ownerService, secondService] } } });
  await prisma.apiKey.deleteMany({ where: { serviceName: { in: [ownerService, secondService] } } });
  await prisma.$disconnect();
  redis.disconnect();
  server.closeAllConnections();
  server.close();
});

test('notification API requires a valid API key', async () => {
  const response = await fetch(`${baseUrl}/api/notifications`);
  assert.equal(response.status, 401);
});

test('queue health reports channel queues', async () => {
  const response = await fetch(`${baseUrl}/health/queues`);
  assert.equal(response.status, 200);
  const body = await response.json() as { data: { queues: Record<string, unknown> } };
  assert.ok('notifications-email' in body.data.queues);
  assert.ok('notifications-dead-letter' in body.data.queues);
});

test('send is idempotent per source service and history is scoped', async () => {
  const payload = {
    channel: 'EMAIL',
    recipient: 'person@example.com',
    subject: 'Test message',
    body: 'Hello from an integration test',
    idempotencyKey: randomUUID(),
  };
  const send = (key: string) => fetch(`${baseUrl}/api/notifications/send`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key },
    body: JSON.stringify(payload),
  });

  const first = await send(ownerKey.raw);
  assert.equal(first.status, 202);
  const firstBody = await first.json() as { data: { id: string; duplicate: boolean } };
  createdNotifications.push({ id: firstBody.data.id, channel: 'EMAIL' });
  assert.equal(firstBody.data.duplicate, false);

  const duplicate = await send(ownerKey.raw);
  assert.equal(duplicate.status, 202);
  const duplicateBody = await duplicate.json() as { data: { id: string; duplicate: boolean } };
  assert.equal(duplicateBody.data.id, firstBody.data.id);
  assert.equal(duplicateBody.data.duplicate, true);

  const otherServiceSend = await send(secondKey.raw);
  assert.equal(otherServiceSend.status, 202);
  const otherServiceBody = await otherServiceSend.json() as { data: { id: string } };
  createdNotifications.push({ id: otherServiceBody.data.id, channel: 'EMAIL' });
  assert.notEqual(otherServiceBody.data.id, firstBody.data.id);

  const history = await fetch(`${baseUrl}/api/notifications`, { headers: { 'x-api-key': ownerKey.raw } });
  assert.equal(history.status, 200);
  const historyBody = await history.json() as { data: { items: Array<{ id: string }> } };
  assert.deepEqual(historyBody.data.items.map((item) => item.id), [firstBody.data.id]);

  const foreignRead = await fetch(`${baseUrl}/api/notifications/${firstBody.data.id}`, {
    headers: { 'x-api-key': secondKey.raw },
  });
  assert.equal(foreignRead.status, 404);
});

test('email payloads require a subject', async () => {
  const response = await fetch(`${baseUrl}/api/notifications/send`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': ownerKey.raw },
    body: JSON.stringify({ channel: 'EMAIL', recipient: 'person@example.com', body: 'Missing subject' }),
  });
  assert.equal(response.status, 400);
});

test('templates are service-scoped and render safely when sending', async () => {
  const headers = { 'content-type': 'application/json', 'x-api-key': ownerKey.raw };
  const templateResponse = await fetch(`${baseUrl}/api/templates`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      code: 'welcome-email',
      name: 'Welcome email',
      channel: 'EMAIL',
      subject: 'Welcome, {{name}}',
      body: '<p>Hello {{name}}</p>',
      variables: ['name'],
    }),
  });
  assert.equal(templateResponse.status, 201);

  const hiddenTemplate = await fetch(`${baseUrl}/api/templates/welcome-email`, {
    headers: { 'x-api-key': secondKey.raw },
  });
  assert.equal(hiddenTemplate.status, 404);

  const missingVariable = await fetch(`${baseUrl}/api/notifications/send`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      channel: 'EMAIL',
      recipient: 'person@example.com',
      templateCode: 'welcome-email',
      variables: {},
    }),
  });
  assert.equal(missingVariable.status, 400);

  const sendResponse = await fetch(`${baseUrl}/api/notifications/send`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      channel: 'EMAIL',
      recipient: 'person@example.com',
      templateCode: 'welcome-email',
      variables: { name: '<Azhar>' },
    }),
  });
  assert.equal(sendResponse.status, 202);
  const sent = await sendResponse.json() as { data: { id: string } };
  createdNotifications.push({ id: sent.data.id, channel: 'EMAIL' });

  const stored = await prisma.notification.findUniqueOrThrow({ where: { id: sent.data.id } });
  assert.equal(stored.templateCode, 'welcome-email');
  assert.equal(stored.subject, 'Welcome, &lt;Azhar&gt;');
  assert.equal(stored.body, '<p>Hello &lt;Azhar&gt;</p>');

  const deliveryDeadline = Date.now() + 5_000;
  let deliveryStatus = stored.status;
  while (Date.now() < deliveryDeadline && deliveryStatus !== 'SENT') {
    await new Promise((resolve) => setTimeout(resolve, 100));
    deliveryStatus = (await prisma.notification.findUniqueOrThrow({ where: { id: sent.data.id } })).status;
  }
  assert.equal(deliveryStatus, 'SENT');
  const deliveryLogs = await prisma.deliveryLog.findMany({ where: { notificationId: sent.data.id } });
  assert.equal(deliveryLogs.length, 1);
  assert.equal(deliveryLogs[0]?.status, 'SUCCESS');
});

test('unsupported providers retry into an isolated DLQ and can be manually retried', async () => {
  const response = await fetch(`${baseUrl}/api/notifications/send`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': ownerKey.raw },
    body: JSON.stringify({
      channel: 'PUSH',
      recipient: 'device-token',
      body: 'A push notification',
    }),
  });
  assert.equal(response.status, 202);
  const created = await response.json() as { data: { id: string } };
  createdNotifications.push({ id: created.data.id, channel: 'PUSH' });

  const timeout = Date.now() + 20_000;
  let status = 'QUEUED';
  while (Date.now() < timeout) {
    const notification = await prisma.notification.findUniqueOrThrow({ where: { id: created.data.id } });
    status = notification.status;
    if (status === 'DLQ') break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.equal(status, 'DLQ');

  const dlqResponse = await fetch(`${baseUrl}/api/dead-letter`, { headers: { 'x-api-key': ownerKey.raw } });
  assert.equal(dlqResponse.status, 200);
  const dlqBody = await dlqResponse.json() as { data: Array<{ id: string; notificationId: string }> };
  const failed = dlqBody.data.find((item) => item.notificationId === created.data.id);
  assert.ok(failed);

  const hiddenFromOtherService = await fetch(`${baseUrl}/api/dead-letter`, {
    headers: { 'x-api-key': secondKey.raw },
  });
  const hiddenBody = await hiddenFromOtherService.json() as { data: Array<{ notificationId: string }> };
  assert.equal(hiddenBody.data.some((item) => item.notificationId === created.data.id), false);

  const retryResponse = await fetch(`${baseUrl}/api/dead-letter/${failed.id}/retry`, {
    method: 'POST',
    headers: { 'x-api-key': ownerKey.raw },
  });
  assert.equal(retryResponse.status, 200);
  const retried = await prisma.notification.findUniqueOrThrow({ where: { id: created.data.id } });
  assert.equal(retried.status, 'QUEUED');
});
