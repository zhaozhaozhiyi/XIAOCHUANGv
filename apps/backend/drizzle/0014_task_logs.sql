CREATE TABLE IF NOT EXISTS "task_logs" (
  "id" serial PRIMARY KEY NOT NULL,
  "task_id" integer NOT NULL REFERENCES "tasks"("id"),
  "user_id" integer REFERENCES "users"("id"),
  "level" varchar(20) DEFAULT 'info' NOT NULL,
  "message" text NOT NULL,
  "metadata_json" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_task_logs_task_id" ON "task_logs" ("task_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_task_logs_created_at" ON "task_logs" ("created_at");
