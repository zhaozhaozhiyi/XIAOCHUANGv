ALTER TABLE "ai_service_configs" ADD COLUMN IF NOT EXISTS "description" text NOT NULL DEFAULT '';
--> statement-breakpoint
UPDATE "ai_service_configs"
SET "description" = COALESCE(NULLIF(TRIM("description"), ''), TRIM("name") || ' 服务')
WHERE TRIM(COALESCE("description", '')) = '';
