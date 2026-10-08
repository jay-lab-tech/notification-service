# Notification Service

Centralized notification API foundation for the `auth-service`, `E-Commerce-API`, and `url-shortener` projects. It is designed around PostgreSQL persistence and asynchronous delivery through Redis/BullMQ.

## Current status

This repository currently provides the service foundation, health checks, database schema, and local Docker environment. Notification submission, API key provisioning, templates, provider delivery, and queue workers are planned milestones and are not represented as complete features yet.

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

## Run API from Node.js

Start the infrastructure, install dependencies, and generate Prisma Client:

```powershell
docker compose up -d postgres redis
npm install
npm run db:generate
npm run db:deploy
npm run dev
```

Copy `.env.example` to `.env` for host-run development. Do not commit `.env` or provider credentials.

## Project plan

See [BLUEPRINT.md](BLUEPRINT.md) for the architecture, data model, API plan, delivery lifecycle, security rules, and milestones. Deployment is deferred.
