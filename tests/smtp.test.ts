import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { after, before, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:5436/notification_service?schema=public';
process.env.REDIS_URL = 'redis://127.0.0.1:6383';
process.env.EMAIL_MODE = 'smtp';
process.env.EMAIL_FROM = 'notifications@example.test';
process.env.WEBHOOK_ALLOWED_HOSTS = '';

const server = createServer();
let messageData = '';
let smtpUrl = '';
let sender: typeof import('../src/channels/notificationSender.js');

server.on('connection', (socket) => {
  socket.setEncoding('utf8');
  socket.write('220 local-test-sink ESMTP\r\n');
  let buffer = '';
  let inData = false;
  socket.on('data', (chunk: string) => {
    buffer += chunk;
    while (buffer.includes('\r\n')) {
      const boundary = buffer.indexOf('\r\n');
      const line = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      if (inData) {
        if (line === '.') {
          inData = false;
          socket.write('250 queued by local test sink\r\n');
        } else {
          messageData += `${line}\n`;
        }
      } else if (line.startsWith('EHLO') || line.startsWith('HELO')) {
        socket.write('250-local-test-sink\r\n250 PIPELINING\r\n');
      } else if (line.startsWith('MAIL FROM') || line.startsWith('RCPT TO')) {
        socket.write('250 OK\r\n');
      } else if (line === 'DATA') {
        inData = true;
        socket.write('354 end with dot\r\n');
      } else if (line === 'QUIT') {
        socket.write('221 bye\r\n');
        socket.end();
      } else {
        socket.write('250 OK\r\n');
      }
    }
  });
});

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  smtpUrl = `smtp://127.0.0.1:${address.port}`;
  process.env.SMTP_URL = smtpUrl;
  sender = await import('../src/channels/notificationSender.js');
});

after(async () => {
  await sender?.closeNotificationSender();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test('SMTP adapter sends a message to a local SMTP protocol sink', async () => {
  const result = await sender.sendThroughChannel({
    id: 'smtp-local-test',
    channel: 'EMAIL',
    recipient: 'recipient@example.test',
    subject: 'SMTP adapter test',
    body: '<p>SMTP message body</p>',
    createdAt: new Date(),
    metadata: null,
  } as never);

  assert.equal(result.provider, 'smtp');
  assert.equal(result.providerResponse.acceptedCount, 1);
  assert.match(messageData, /recipient@example\.test/);
  assert.match(messageData, /SMTP adapter test/);
  assert.match(messageData, /SMTP message body/);
});

test('webhook sender rejects hosts outside the operator allowlist before connecting', async () => {
  await assert.rejects(sender.sendThroughChannel({
    id: 'webhook-ssrf-test',
    channel: 'WEBHOOK',
    recipient: 'https://127.0.0.1/private',
    subject: null,
    body: 'Must not be sent',
    createdAt: new Date(),
    metadata: null,
  } as never), /WEBHOOK_ALLOWED_HOSTS/);
});
