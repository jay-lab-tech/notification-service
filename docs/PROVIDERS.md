# Provider setup

The API process and the separate worker must receive the same provider environment variables. Provider credentials are read only by the worker. Do not commit `.env`, service-account JSON files, or provider secrets.

## Email (SMTP)

Set `EMAIL_MODE=smtp`, `SMTP_URL`, and `EMAIL_FROM` in `.env`; Docker Compose passes those optional values to the API and worker. Restart both services. The worker's provider acceptance is recorded as `SENT`; that does not prove delivery to an inbox. The test suite includes a local SMTP protocol sink, but it does not verify credentials or inbox delivery through a real provider.

## Push (Firebase Cloud Messaging HTTP v1)

Create a Firebase service account with permission to send FCM messages. Set all three variables:

```text
FCM_PROJECT_ID=your-project-id
FCM_CLIENT_EMAIL=firebase-adminsdk@your-project.iam.gserviceaccount.com
FCM_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

Send `channel: "PUSH"`, `recipient` as the device registration token, `subject` as the optional notification title, and `body` as the message. String/number/boolean metadata fields are sent as FCM data values. The credential is used to mint a short-lived OAuth access token; that token is cached in memory.

## SMS (Twilio)

Set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_FROM_NUMBER`. SMS recipients must use E.164 format such as `+14155552671`; `body` is sent as the message text. Confirm your Twilio account, sender, and destination country are permitted before testing, since provider charges may apply.

To receive delivery receipts, also set `TWILIO_STATUS_CALLBACK_URL` to the externally reachable HTTPS URL `https://<your-host>/api/providers/twilio/status`. The service adds a signed notification identifier to each message callback URL and validates Twilio's `X-Twilio-Signature` with the official Twilio Node SDK. Callback events advance the notification to `DELIVERED` or `FAILED`; without this URL, `SENT` means Twilio accepted the message, not that it reached the device. The callback endpoint has no API key because Twilio authenticates the signed request.

## Signed outbound webhook

Set `WEBHOOK_ALLOWED_HOSTS` to a comma-separated list of exact hostnames you control and `WEBHOOK_SIGNING_SECRET` to a random secret of at least 32 characters. Targets must use HTTPS on port 443, cannot contain userinfo or fragments, and must resolve exclusively to public IPv4 addresses. DNS results are checked and pinned for each request; redirects are not followed. Only allow hosts for which outbound delivery is intended.

The JSON POST body contains `id`, `channel`, `subject`, `body`, `metadata`, and `createdAt`. The receiver gets `X-Notification-Signature: sha256=<hex HMAC-SHA256>`. Verify the HMAC over the exact raw request bytes using a constant-time comparison. Return any 2xx response to acknowledge provider acceptance. Non-2xx responses and network errors are retried, then moved to the dead-letter queue.

The API validates the URL syntax; the worker enforces the allowlist and network restrictions at delivery time. Treat webhook request content as sensitive and avoid logging it at the receiver.

## Local testing

Without provider configuration, the email `log` mode is a simulator. FCM, Twilio, and webhook jobs fail safely and enter the DLQ after retries. Do not use production credentials for the automated integration tests. Real end-to-end delivery requires credentials and an approved recipient/endpoint; the repository tests do not send paid messages or contact third-party endpoints.
