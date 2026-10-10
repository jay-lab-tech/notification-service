# API Reference

Local base URL: `http://localhost:3003`. Swagger UI: `/docs`; OpenAPI contract: [`docs/openapi.yaml`](docs/openapi.yaml). Postman collection is under [`docs/postman/`](docs/postman/).

## Authentication and conventions

All `/api/notifications`, `/api/templates`, and `/api/dead-letter` endpoints require `X-API-Key: nsk_live_<secret>`. The key's registered `serviceName` defines tenant scope. Missing, invalid, or revoked key returns `401`. Successful responses wrap payloads in `data`; errors are `{ "error": { "code": "...", "message": "..." } }`.

## Health

| Method/path | Auth | Result |
|---|---|---|
| `GET /health` | Public | Liveness `{data:{status:"ok"}}` |
| `GET /health/deep` | Public | PostgreSQL/Redis readiness; degraded returns `503` |
| `GET /health/queues` | Public | BullMQ queue counts |

## Notifications

| Method/path | Purpose |
|---|---|
| `POST /api/notifications/send` | Queue one notification (`202`) |
| `POST /api/notifications/bulk` | Queue 1–100; per-item accepted/rejected results (`202`) |
| `GET /api/notifications?limit=20&cursor=<uuid>` | List this service's notifications (limit 1–100) |
| `GET /api/notifications/:id` | Read this service's notification and delivery data |

Send request fields: `channel` (`EMAIL`, `PUSH`, `SMS`, `WEBHOOK`), `recipient`, and either `body` or `templateCode` with optional `variables`. Optional fields: `subject`, `idempotencyKey` (max 200), `userId`, `priority` (`LOW`/`NORMAL`/`HIGH`), `metadata`, `fallback`, and ISO `scheduledAt`. Email with inline body requires subject. SMS recipients use E.164 format. Webhook URLs must be HTTPS, port 443, without embedded credentials/fragments and must also match the operator host allowlist. A fallback must use a different channel.

Example:

```json
{"channel":"EMAIL","recipient":"user@example.com","subject":"Welcome","body":"Hello!","idempotencyKey":"welcome-123"}
```

Single send returns `202 {data:{id,status,channel,recipient,createdAt,duplicate}}`; newly accepted items are queued, not necessarily delivered. The default per-minute limit is 10 per service/channel/recipient; recipient is hashed for the Redis limiter. Rate-limited requests return `429` with `Retry-After`. Duplicate idempotency keys return the existing notification with `duplicate: true`.

## Templates

All routes use the service's API key. Template code must be lowercase kebab-case, max 100 characters; name max 150; body max 100,000; variable names are unique identifiers. Email templates require a subject. Handlebars escapes rendered HTML values by default.

| Method/path | Description |
|---|---|
| `GET /api/templates` | List active service-owned templates |
| `POST /api/templates` | Create `{code,name,channel,subject?,body,variables?}` (`201`) |
| `GET /api/templates/:code` | Read owned active template |
| `PUT /api/templates/:code` | Replace fields `{name,channel,subject?,body,variables?}` |
| `DELETE /api/templates/:code` | Deactivate; returns `204`, existing notifications retain rendered content |

Codes are unique within a service. Duplicate code returns `409`; missing template `404`; invalid input `400`.

## Dead-letter queue and provider callback

- `GET /api/dead-letter`: list DLQ jobs for the authenticated service.
- `POST /api/dead-letter/:jobId/retry`: retry a job owned by that service; status is reset to `QUEUED`. Missing/not-owned job returns `404`.
- `POST /api/providers/twilio/status`: public provider callback authenticated by Twilio `X-Twilio-Signature` and exact configured callback URL. Uses form-encoded fields such as `MessageSid` and `MessageStatus`; returns `204`, invalid signature/config `403`/`404`.

## Error/status summary

`400` validation, `401` API key required/invalid, `404` missing resource or unconfigured callback, `409` template conflict, `429` per-recipient limit, `500` unexpected error, `503` deep health dependency issue. For full contract details, see OpenAPI.
