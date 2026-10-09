# Notification Service

Centralized notification API foundation for the `auth-service`, `E-Commerce-API`, and `url-shortener` projects. It is designed around PostgreSQL persistence and asynchronous delivery through Redis/BullMQ.

## Current status

The service now provisions hashed API keys, accepts notification requests, stores them, and enqueues channel-specific BullMQ jobs. It also supports idempotency and service-scoped status/history reads. Delivery workers, templates, and external provider integrations are still planned; queued notifications remain `QUEUED` until a worker is added.

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

## Run API from Node.js

Start the infrastructure, install dependencies, and generate Prisma Client:

```powershell
docker compose up -d postgres redis
npm install
npm run db:generate
npm run db:deploy
npm run dev
```

Copy `.env.example` to `.env` for host-run development. Do not commit `.env` or provider credentials. Integration tests require the local PostgreSQL and Redis services to be running.

## Project plan

See [BLUEPRINT.md](BLUEPRINT.md) for the architecture, data model, API plan, delivery lifecycle, security rules, and milestones. Deployment is deferred.
