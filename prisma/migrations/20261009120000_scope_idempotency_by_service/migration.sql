-- Scope idempotency keys to the calling service so unrelated consumers cannot collide.
DROP INDEX "Notification_idempotencyKey_key";

CREATE UNIQUE INDEX "Notification_sourceService_idempotencyKey_key"
ON "Notification"("sourceService", "idempotencyKey");
