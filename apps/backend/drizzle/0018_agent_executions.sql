ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "organization_id" integer REFERENCES "organizations"("id");
--> statement-breakpoint
ALTER TABLE "task_logs" ADD COLUMN IF NOT EXISTS "organization_id" integer REFERENCES "organizations"("id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tasks_org_id" ON "tasks" ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_task_logs_org_id" ON "task_logs" ("organization_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_executions" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL REFERENCES "users"("id"),
  "organization_id" integer REFERENCES "organizations"("id"),
  "task_id" integer NOT NULL REFERENCES "tasks"("id"),
  "attempt_no" integer NOT NULL DEFAULT 1,
  "runtime" varchar(20) NOT NULL DEFAULT 'hermes',
  "remote_run_id" varchar(255),
  "session_id" varchar(255) NOT NULL,
  "status" varchar(30) NOT NULL DEFAULT 'created',
  "tool_profile" varchar(100),
  "skill_manifest_json" text,
  "model_profile" varchar(100),
  "capability_jti" varchar(128),
  "checkpoint_json" text,
  "last_event_seq" integer,
  "last_event_json" text,
  "error_kind" varchar(50),
  "error_message" text,
  "started_at" timestamp,
  "completed_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_agent_exec_task_attempt"
  ON "agent_executions" ("task_id", "attempt_no");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_agent_exec_remote_run"
  ON "agent_executions" ("remote_run_id")
  WHERE "remote_run_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_agent_exec_user_id" ON "agent_executions" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_agent_exec_org_id" ON "agent_executions" ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_agent_exec_status" ON "agent_executions" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_agent_exec_task_id" ON "agent_executions" ("task_id");
