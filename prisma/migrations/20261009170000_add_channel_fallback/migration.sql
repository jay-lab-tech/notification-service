ALTER TABLE "Notification"
ADD COLUMN "fallbackChannel" "NotificationChannel",
ADD COLUMN "fallbackRecipient" TEXT,
ADD COLUMN "fallbackSubject" VARCHAR(300),
ADD COLUMN "fallbackBody" TEXT;
