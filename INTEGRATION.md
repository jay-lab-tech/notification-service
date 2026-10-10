# Consumer Integration

This top-level guide complements the more detailed examples in [`docs/INTEGRATION.md`](docs/INTEGRATION.md) and provider configuration in [`docs/PROVIDERS.md`](docs/PROVIDERS.md).

## 1. Provision and store a service key

Start the local service, then create a key for the calling service:

```powershell
npm run api-key:create -- auth-service "Auth Service"
```

The raw key is shown once. Store it in the consumer's local ignored `.env` or deployment secret store, never in source control. Rotate by creating a replacement, switching the consumer, verifying requests, then revoking the old key:

```powershell
npm run api-key:list -- auth-service
npm run api-key:revoke -- <api-key-id>
```

## 2. Submit an idempotent request

Send `X-API-Key` and a stable idempotency key that identifies the logical event (for example `order-confirmed:<order-id>`). A `202` response indicates queued acceptance, not final delivery.

```http
POST http://localhost:3003/api/notifications/send
X-API-Key: <service-api-key>
Content-Type: application/json

{"channel":"EMAIL","recipient":"customer@example.com","subject":"Order confirmed","body":"Your order is confirmed.","idempotencyKey":"order-confirmed:<order-id>"}
```

Use `GET /api/notifications/:id` or list endpoint to inspect status and delivery logs. Bulk send accepts up to 100 requests and reports results independently per item.

## 3. Local development and operations

`docker compose up --build` starts API, worker, PostgreSQL, and Redis. Local email defaults to `EMAIL_MODE=log`, which does not send an external email. Real provider setup, callback URLs, webhook allowlists, and security requirements are documented in [`docs/PROVIDERS.md`](docs/PROVIDERS.md).

The default rate limit is 10 requests/minute for each service/channel/recipient tuple. Handle `429` using `Retry-After`; use idempotency when retrying uncertain network outcomes. Inspect `/health/deep` for database/Redis health and `/health/queues` for queue depth. DLQ jobs can be listed and retried through the service-scoped API.

## Consumer-specific guidance

- **Auth Service:** trigger notifications only after the relevant auth operation commits; avoid putting passwords, tokens, or recovery secrets into message body/metadata.
- **E-Commerce API:** use order IDs as idempotency keys and enqueue after the order state transaction commits; avoid sending card/payment credentials.
- **URL Shortener:** keep messages transactional and low-volume; do not include click IP/user-agent analytics unless there is a clear user need and retention policy.

These are integration recommendations; the other projects are not automatically wired to this service. Configure provider credentials and a working API key before enabling actual delivery.
