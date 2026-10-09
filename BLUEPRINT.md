# Notification Service — Blueprint

Centralized notification service for the portfolio services, with asynchronous delivery, retries, idempotency, delivery history, and multiple provider channels.

## Goal and stack

- Node.js 24, Express 5, TypeScript, Zod
- PostgreSQL with Prisma
- Redis with BullMQ
- Docker Compose for local development
- Service-to-service API key authentication; only a SHA-256 hash is stored

The service exposes an HTTP API for `auth-service`, `E-Commerce-API`, and `url-shortener`. It accepts notification requests, persists them, enqueues work, and exposes status/history. Email supports SMTP and local simulation. Webhook, FCM, and Twilio provider integrations are future work.

## Architecture

```text
Consumer services
       │ HTTP + X-API-Key
       ▼
Express API ── validate/authenticate ── PostgreSQL (Prisma)
       │                                  │
       └── BullMQ queues ◀── Redis        └── templates, notifications, delivery logs
                  │
                  ▼
          channel workers ── provider adapters
                  │
                  └── exhausted jobs → dead-letter queue
```

The API, queue producer, and workers are separate layers. A request is accepted only after its notification is persisted and queued. Workers update delivery state and append attempt logs. BullMQ retries transient failures with exponential backoff; exhausted jobs are recorded as `DLQ` and retained for inspection.

## Data model

- `ApiKey`: service name, unique key hash, active/revoked state, last-used timestamp. Multiple keys per service support credential rotation.
- `Template`: service-scoped code, channel, subject/body, required variables, active state.
- `Notification`: idempotency key, source service, optional source user ID, channel, recipient, rendered content, status, priority, attempts, schedule and lifecycle timestamps, metadata.
- `DeliveryLog`: notification relation, channel/provider, attempt result, provider response, error and duration.

## Initial API contract

All consumer endpoints require `X-API-Key`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Liveness |
| GET | `/health/deep` | PostgreSQL and Redis readiness |
| POST | `/api/notifications/send` | Accept one notification |
| POST | `/api/notifications/bulk` | Accept up to 100 notifications with per-item results |
| GET | `/api/notifications/:id` | Read status belonging to the caller's service |
| GET | `/api/notifications` | Paginated history scoped to the caller's service |
| GET/POST/PUT/DELETE | `/api/templates...` | Template management scoped to the API key's service |
| GET | `/health/queues` | Queue counts for operational visibility |
| GET | `/api/dead-letter` | List DLQ jobs belonging to the API key's service |
| POST | `/api/dead-letter/:jobId/retry` | Retry a service-owned DLQ job |
| GET | `/health/queues` | Queue counts for operational visibility |

Bulk send, admin key management, and signed provider callbacks are planned additions. Public API responses must never return API key hashes or provider secrets.

## Security and delivery rules

- Generate high-entropy API keys with a recognizable prefix; store only a SHA-256 digest and compare digests safely.
- Scope notification reads to `sourceService` derived from the authenticated API key, never a caller-supplied identity.
- Enforce request schemas, payload size limits, and rate limits by service/recipient/channel. (Per-recipient/channel rate limiting implemented.)
- Idempotency keys prevent duplicate requests; database uniqueness handles concurrent retries.
- Escape template output by default and validate required variables.
- Do not log API keys, message bodies, recipient secrets, or provider credentials.
- Use provider webhooks only after validating signatures against the raw request body.

## Delivery lifecycle

`QUEUED → SENT → DELIVERED` for successful delivery and provider confirmation. Transient errors are retried with exponential backoff; after primary retries, one optional alternate channel can run before an exhausted job becomes `DLQ`. Validation/permanent provider failures are recorded with a clear failure reason. `SENT` means accepted by the provider, not necessarily received by a human.

## Planned milestones

1. Repository foundation: TypeScript, Express, validated environment, health checks, Prisma models, Docker Compose, CI, and docs.
2. API-key provisioning/authentication, notification submission, idempotency, and status/history endpoints. (Implemented.)
3. Service-scoped template CRUD, required-variable validation, and Handlebars rendering. (Implemented.)
4. BullMQ producers/workers, delivery attempts, retry policy, service-scoped DLQ inspection and manual retry. (Implemented.)
5. Email provider integration and local/test provider configuration. (SMTP and local simulation implemented; SMTP protocol covered with a local sink test.)
6. Webhook channel with signed requests, destination allowlisting, public-IP validation/DNS pinning, plus FCM HTTP v1 and Twilio SMS adapters. Provider callback delivery receipts remain future work.
7. Per-recipient/channel Redis rate limits and bulk submission with item-level results. (Implemented.)
8. Operational docs, examples, and final verification.

The repository will be committed in small, cohesive increments. Deployment is intentionally deferred.
