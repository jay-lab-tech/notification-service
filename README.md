# Notification Service

Centralized notification API foundation for the `auth-service`, `E-Commerce-API`, and `url-shortener` projects. It is designed around PostgreSQL persistence and asynchronous delivery through Redis/BullMQ.

## Current status

The service provisions hashed API keys, accepts notification requests, stores them, and enqueues channel-specific BullMQ jobs. It supports idempotency, service-scoped status/history and Handlebars templates, delivery logs, retries, and dead-letter inspection/retry. Email supports SMTP and local simulation. Push, SMS, and outbound webhook provider delivery are not integrated yet and will retry into the DLQ.

## Requirements

- Node.js 24+
- npm
- Docker Desktop with Docker Compose

## Run locally with Docker

```powershell
Copy-Item .env.example .env
docker compose up --build
```

The API listens on `http://localhost:3003`, PostgreSQL is exposed on port `5436`, and Redis on port `6383`. These host ports are chosen to avoid collisions with the other portfolio services.
Compose starts the API and a separate worker. The default `EMAIL_MODE=log` simulates provider acceptance and does not send an external email.

Interactive API docs are available at `http://localhost:3003/docs`; the OpenAPI contract is at `http://localhost:3003/docs/openapi.yaml`.

Check liveness and dependency readiness:

```powershell
Invoke-RestMethod http://localhost:3003/health
Invoke-RestMethod http://localhost:3003/health/deep
```

## Create a consumer API key

With the local Postgres service running and `.env` configured, create a key for a consumer service:

```powershell
npm run api-key:create -- auth-service "Auth Service"
```

The command prints the raw key once. Store it as a secret in the consumer service; PostgreSQL stores only its SHA-256 hash. API keys authenticate through the `X-API-Key` header.

## Submit and inspect a notification

```powershell
$headers = @{ "X-API-Key" = "nsk_live_your-generated-key" }
$body = @{
  channel = "EMAIL"
  recipient = "user@example.com"
  subject = "Welcome"
  body = "Welcome to the service."
  idempotencyKey = "welcome-user-123"
} | ConvertTo-Json

Invoke-RestMethod -Method Post -Uri http://localhost:3003/api/notifications/send `
  -Headers $headers -ContentType "application/json" -Body $body
Invoke-RestMethod -Uri http://localhost:3003/api/notifications -Headers $headers
```

Supported channels in the request contract are `EMAIL`, `PUSH`, `SMS`, and `WEBHOOK`. Email requires a subject, and webhook recipients must be valid URLs. The calling service identity comes from its API key and cannot be overridden in the request.

`NOTIFICATION_RATE_LIMIT` sets the per-minute limit per service, channel, and recipient (default: 10). Recipient values are hashed before being used as Redis keys.

Bulk requests accept up to 100 notifications at `POST /api/notifications/bulk`. The response uses HTTP `202` and reports each item's accepted or rejected result; a rate-limited item does not cancel the other items.

## Manage message templates

Templates belong to the service associated with the API key. Required variables are listed when creating the template; Handlebars escapes rendered HTML values by default.

```powershell
$template = @{
  code = "welcome-email"
  name = "Welcome email"
  channel = "EMAIL"
  subject = "Welcome, {{name}}"
  body = "<p>Hello {{name}}</p>"
  variables = @("name")
} | ConvertTo-Json

Invoke-RestMethod -Method Post -Uri http://localhost:3003/api/templates `
  -Headers $headers -ContentType "application/json" -Body $template

$templatedNotification = @{
  channel = "EMAIL"
  recipient = "user@example.com"
  templateCode = "welcome-email"
  variables = @{ name = "Azhar" }
} | ConvertTo-Json

Invoke-RestMethod -Method Post -Uri http://localhost:3003/api/notifications/send `
  -Headers $headers -ContentType "application/json" -Body $templatedNotification
```

Template routes: `GET /api/templates`, `GET /api/templates/:code`, `POST /api/templates`, `PUT /api/templates/:code`, and `DELETE /api/templates/:code`. Delete deactivates the template; existing notifications keep their rendered content.

## Run API from Node.js

Start the infrastructure, install dependencies, and generate Prisma Client:

```powershell
docker compose up -d postgres redis
npm install
npm run db:generate
npm run db:deploy
npm run dev
```

Copy `.env.example` to `.env` for host-run development. Do not commit `.env` or provider credentials. Start the worker in a second terminal with `npm run dev:worker`. Integration tests require local PostgreSQL and Redis.

For real email, set `EMAIL_MODE=smtp`, `SMTP_URL`, and `EMAIL_FROM` in both API and worker environments.

## Delivery tracking and DLQ

`GET /health/queues` reports channel queue counts. Authenticated consumers can inspect their own dead-letter jobs using `GET /api/dead-letter` and retry one using `POST /api/dead-letter/:jobId/retry`. A retry resets the attempt counter; delivery history remains in PostgreSQL.

## Project plan

See [BLUEPRINT.md](BLUEPRINT.md) for the architecture, data model, API plan, delivery lifecycle, security rules, and milestones. Deployment is deferred.
