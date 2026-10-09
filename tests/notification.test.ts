import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.PORT = '3003';
process.env.DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:5436/notification_service?schema=public';
process.env.REDIS_URL = 'redis://127.0.0.1:6383';

const [{ app }, { prisma }, { createApiKey }, { removeNotificationJob, closeNotificationQueues }] = await Promise.all([
  import('../src/app.js'),
  import('../src/config/database.js'),
  import('../src/utils/apiKey.js'),
  import('../src/queues/notificationQueue.js'),
]);
const { redis } = await import('../src/config/redis.js');

const ownerKey = createApiKey();
const secondKey = createApiKey();
const ownerService = `test-owner-${randomUUID().slice(0, 8)}`;
const secondService = `test-other-${randomUUID().slice(0, 8)}`;
const createdNotifications: Array<{ id: string; channel: 'EMAIL' | 'PUSH' | 'SMS' | 'WEBHOOK' }> = [];
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
  for (const notification of createdNotifications) {
    await removeNotificationJob(notification.channel, notification.id);
  }
  await closeNotificationQueues();
  await prisma.notification.deleteMany({ where: { sourceService: { in: [ownerService, secondService] } } });
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
