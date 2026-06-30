CREATE TABLE IF NOT EXISTS "quick_video_sessions" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL REFERENCES "users"("id"),
  "title" varchar(255) NOT NULL DEFAULT '新创作',
  "status" varchar(20) NOT NULL DEFAULT 'active',
  "dominant_operation" varchar(20),
  "summary" text,
  "cover_output_id" integer,
  "metadata_json" text,
  "last_message_at" timestamp NOT NULL DEFAULT now(),
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_quick_video_sessions_user_last_message"
  ON "quick_video_sessions" ("user_id", "last_message_at");
CREATE INDEX IF NOT EXISTS "idx_quick_video_sessions_user_status"
  ON "quick_video_sessions" ("user_id", "status");
CREATE INDEX IF NOT EXISTS "idx_quick_video_sessions_deleted_at"
  ON "quick_video_sessions" ("deleted_at");

CREATE TABLE IF NOT EXISTS "quick_video_rounds" (
  "id" serial PRIMARY KEY NOT NULL,
  "session_id" integer NOT NULL REFERENCES "quick_video_sessions"("id"),
  "parent_round_id" integer,
  "derive_from" varchar(32),
  "operation_type" varchar(20) NOT NULL,
  "prompt" text NOT NULL,
  "attachments_json" text NOT NULL DEFAULT '[]',
  "config_snapshot_json" text,
  "status" varchar(20) NOT NULL DEFAULT 'queued',
  "task_id" integer,
  "domain_id" integer,
  "progress" integer,
  "error_message" text,
  "branch_name" varchar(255),
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_quick_video_rounds_session_created"
  ON "quick_video_rounds" ("session_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_quick_video_rounds_parent"
  ON "quick_video_rounds" ("parent_round_id");
CREATE INDEX IF NOT EXISTS "idx_quick_video_rounds_deleted_at"
  ON "quick_video_rounds" ("deleted_at");

CREATE TABLE IF NOT EXISTS "quick_video_outputs" (
  "id" serial PRIMARY KEY NOT NULL,
  "round_id" integer NOT NULL REFERENCES "quick_video_rounds"("id"),
  "kind" varchar(20) NOT NULL,
  "task_id" integer,
  "domain_id" integer,
  "preview_url" text NOT NULL,
  "thumb_url" text,
  "status" varchar(20) NOT NULL DEFAULT 'completed',
  "metadata_json" text,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_quick_video_outputs_round_created"
  ON "quick_video_outputs" ("round_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_quick_video_outputs_task_id"
  ON "quick_video_outputs" ("task_id");
