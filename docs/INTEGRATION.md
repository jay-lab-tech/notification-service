# Consumer integration

Create one API key per consumer service. The raw key is shown once; store it in that service's secret configuration as `NOTIFICATION_SERVICE_API_KEY`. Do not expose it in browser code or commit it. Send requests server-to-server with `X-API-Key`.

## TypeScript / Node.js example

```ts
const notificationServiceUrl = process.env.NOTIFICATION_SERVICE_URL ?? 'http://localhost:3003';
const notificationApiKey = process.env.NOTIFICATION_SERVICE_API_KEY;

if (!notificationApiKey) throw new Error('NOTIFICATION_SERVICE_API_KEY is required');

export async function sendWelcomeEmail(email: string, userId: string) {
  const response = await fetch(`${notificationServiceUrl}/api/notifications/send`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': notificationApiKey,
    },
    body: JSON.stringify({
      channel: 'EMAIL',
      recipient: email,
      subject: 'Welcome',
      body: '<p>Your account is ready.</p>',
      userId,
      idempotencyKey: `welcome:${userId}`,
    }),
    signal: AbortSignal.timeout(5_000),
  });

  if (response.status !== 202) {
    throw new Error(`Notification request failed (${response.status}): ${await response.text()}`);
  }
  return response.json() as Promise<{ data: { id: string; status: string; duplicate: boolean } }>;
}
```

`202 Accepted` means the notification was persisted and queued, not delivered. Save its `id` and query `GET /api/notifications/:id` when the caller needs status. Reuse the same idempotency key when retrying a timed-out request to avoid creating duplicates. The notification API key identifies the consumer service; `userId` is optional metadata and never changes ownership scope.

For one automatic channel fallback after the primary channel exhausts its retries, include `fallback` with a different channel, its recipient, and body. Email fallbacks also require a subject. The fallback uses the same notification ID; delivery history records each channel attempt. If fallback delivery also exhausts its retries, the notification enters the DLQ.

For batch work use `POST /api/notifications/bulk` with up to 100 entries. Inspect each result because rate-limited or invalid entries can be rejected individually. The API rate limit is per service, channel, and recipient; `429` responses include `Retry-After`.

## PowerShell smoke test

```powershell
$headers = @{ "X-API-Key" = $env:NOTIFICATION_SERVICE_API_KEY }
$body = @{
  channel = "EMAIL"
  recipient = "you@example.com"
  subject = "Notification API test"
  body = "Queued from PowerShell"
  idempotencyKey = "manual-test-001"
} | ConvertTo-Json

Invoke-RestMethod -Method Post `
  -Uri http://localhost:3003/api/notifications/send `
  -Headers $headers -ContentType "application/json" -Body $body
```

## Postman

Import `docs/postman/notification-service.postman_collection.json`. Set collection variables `baseUrl` and `apiKey`; use a generated service key for `apiKey`. The collection avoids storing a real key in the repository.
