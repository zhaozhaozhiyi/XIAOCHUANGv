ALTER TABLE "auth_sessions" ADD COLUMN IF NOT EXISTS "expires_at" timestamp;
UPDATE "auth_sessions"
SET "expires_at" = COALESCE("expires_at", "created_at" + interval '7 days')
WHERE "expires_at" IS NULL;
ALTER TABLE "auth_sessions" ALTER COLUMN "expires_at" SET NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_auth_sessions_expires_at" ON "auth_sessions" ("expires_at");
--> statement-breakpoint
ALTER TABLE "phone_verification_codes" ADD COLUMN IF NOT EXISTS "attempt_count" integer NOT NULL DEFAULT 0;
