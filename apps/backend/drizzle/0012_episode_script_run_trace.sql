ALTER TABLE "episodes" ADD COLUMN IF NOT EXISTS "script_ai_run_id" varchar(128);--> statement-breakpoint
ALTER TABLE "episodes" ADD COLUMN IF NOT EXISTS "script_remote_run_id" varchar(128);
