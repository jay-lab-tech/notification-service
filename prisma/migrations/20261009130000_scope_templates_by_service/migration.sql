ALTER TABLE "Template" ADD COLUMN "sourceService" VARCHAR(100) NOT NULL DEFAULT 'legacy';
ALTER TABLE "Template" ALTER COLUMN "sourceService" DROP DEFAULT;
ALTER TABLE "Template" ALTER COLUMN "variables" SET DEFAULT '[]'::jsonb;

ALTER TABLE "Notification" DROP CONSTRAINT "Notification_templateCode_fkey";
DROP INDEX "Template_code_key";
DROP INDEX "Template_channel_isActive_idx";

CREATE UNIQUE INDEX "Template_sourceService_code_key" ON "Template"("sourceService", "code");
CREATE INDEX "Template_sourceService_channel_isActive_idx" ON "Template"("sourceService", "channel", "isActive");

ALTER TABLE "Notification"
ADD CONSTRAINT "Notification_sourceService_templateCode_fkey"
FOREIGN KEY ("sourceService", "templateCode")
REFERENCES "Template"("sourceService", "code")
ON DELETE RESTRICT ON UPDATE CASCADE;
