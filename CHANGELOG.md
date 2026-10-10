# Changelog

Notable changes follow Keep a Changelog conventions. Entries are unreleased until a version is tagged.

## [Unreleased]

### Added
- API-key authenticated, service-scoped notification send, bulk send, history, and status endpoints.
- Handlebars templates, idempotency, scheduled/priority jobs, multi-channel BullMQ workers, retries, fallback, delivery logs, and DLQ tools.
- Email log/SMTP, FCM, Twilio, signed HTTPS webhooks, OpenAPI/Postman docs, Docker Compose, and integration documentation.

### Security
- Raw API keys are shown once and only SHA-256 digests are stored; webhook destinations require configured HTTPS host allowlisting.
