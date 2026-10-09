import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.PORT = '3003';
process.env.DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:5436/notification_service?schema=public';
process.env.REDIS_URL = 'redis://127.0.0.1:6383';

const { app } = await import('../src/app.js');
const server = app.listen(0);
let baseUrl = '';

before(() => {
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test('GET /health returns a liveness response', async () => {
  const response = await fetch(`${baseUrl}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { data: { status: 'ok' } });
});

test('unknown routes return a consistent 404 response', async () => {
  const response = await fetch(`${baseUrl}/unknown`);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    error: { code: 'NOT_FOUND', message: 'Route not found' },
  });
});

test('Swagger UI and OpenAPI contract are served locally', async () => {
  const ui = await fetch(`${baseUrl}/docs`);
  assert.equal(ui.status, 200);
  assert.match(await ui.text(), /swagger-ui/);

  const contract = await fetch(`${baseUrl}/docs/openapi.yaml`);
  assert.equal(contract.status, 200);
  assert.match(await contract.text(), /openapi: 3\.1\.0/);
});
