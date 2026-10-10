# Architecture

## Components and delivery flow

```text
Consumer service ── X-API-Key ──→ Express API
                                  ├─ PostgreSQL: API keys, templates,
                                  │              notifications, delivery logs
                                  └─ Redis/BullMQ: per-channel delivery queues
                                                       ↓
                                                Separate worker process
                                       ┌────────┬───────┼────────┐
                                       SMTP/log   FCM   Twilio   HTTPS webhook
                                                       ↓
                                               retry → fallback → DLQ
```

The API accepts, validates, persists, and enqueues requests; a separate worker performs provider delivery. `GET /health` is liveness, `/health/deep` checks PostgreSQL and Redis, and `/health/queues` exposes queue counts. Docker Compose runs API, worker, PostgreSQL, and Redis.

## Layers and ownership

- **API/auth boundary:** API-key middleware hashes the presented key and looks up an active key. The authenticated key determines `sourceService`; callers cannot choose another tenant in the request body.
- **Domain/persistence:** Prisma stores key hashes, service-scoped templates, notification state, and delivery attempts. Idempotency is unique per `(sourceService, idempotencyKey)`.
- **Queue/worker:** separate BullMQ queues for EMAIL, PUSH, SMS, WEBHOOK plus a dead-letter queue. Delivery retries use up to three attempts with exponential backoff; priority and scheduled time are passed to queue jobs.
- **Provider adapters:** local email log mode or SMTP, FCM HTTP v1, Twilio SMS, and signed outbound webhooks constrained by HTTPS host allowlist. Credentials are optional for local development.

## Data model

```text
ApiKey (serviceName, SHA-256 keyHash, active, lastUsedAt)
Template (sourceService, code; unique pair; channel, subject/body, variables)
Notification (sourceService, idempotencyKey; userId, channel, recipient,
              rendered content, status/priority/attempts, fallback, schedule)
Notification 1 ── * DeliveryLog (provider, attempt/status, error, duration)
```

Statuses include `QUEUED`, `SENT`, `DELIVERED`, `FAILED`, and `DLQ`. A configured fallback channel is attempted once after primary delivery retries are exhausted; if it fails, the job moves to DLQ. `DELIVERED` depends on provider receipt support; Twilio callbacks can update SMS delivery state.

## Trade-offs and boundaries

- API keys are stored as SHA-256 hashes; the raw key is shown only when created. Key issuance/list/revoke are operator CLI tasks rather than public HTTP endpoints.
- Provider work is asynchronous, so `202 Accepted` means queued, not delivered. Consumers should inspect notification status/history.
- Idempotency prevents duplicate persisted request acceptance for a service/key pair; it is not a guarantee that every external provider has exactly-once delivery semantics.
- Email `log` mode simulates acceptance and sends no email. Unconfigured real providers will fail/retry and may reach DLQ.
- Consumer scoping is based on API key service identity. Provider credentials and webhook allowlists are operator-controlled configuration.
