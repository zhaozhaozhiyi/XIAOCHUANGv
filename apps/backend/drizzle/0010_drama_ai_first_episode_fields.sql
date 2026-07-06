ALTER TABLE "episodes" ADD COLUMN IF NOT EXISTS "blueprint_payload" text;--> statement-breakpoint
ALTER TABLE "episodes" ADD COLUMN IF NOT EXISTS "source_trace" text;--> statement-breakpoint
ALTER TABLE "episodes" ADD COLUMN IF NOT EXISTS "generation_mode" varchar(50);--> statement-breakpoint
ALTER TABLE "episodes" ADD COLUMN IF NOT EXISTS "failure_reason" text;
