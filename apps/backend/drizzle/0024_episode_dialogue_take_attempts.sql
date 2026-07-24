ALTER TABLE "episode_dialogue_takes"
  ADD COLUMN IF NOT EXISTS "language_tag" varchar(35) NOT NULL DEFAULT 'zh-CN';
--> statement-breakpoint
ALTER TABLE "episode_dialogue_takes"
  ADD COLUMN IF NOT EXISTS "pronunciation_manifest_json" text NOT NULL DEFAULT '{}';
--> statement-breakpoint
ALTER TABLE "episode_dialogue_takes"
  ADD COLUMN IF NOT EXISTS "text_hash" varchar(64) NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE "episode_dialogue_takes"
  ADD COLUMN IF NOT EXISTS "approved_attempt_id" integer;
--> statement-breakpoint
ALTER TABLE "episode_dialogue_takes"
  ADD COLUMN IF NOT EXISTS "supersedes_take_id" integer REFERENCES "episode_dialogue_takes"("id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "episode_dialogue_take_attempts" (
  "id" serial PRIMARY KEY NOT NULL,
  "take_id" integer NOT NULL REFERENCES "episode_dialogue_takes"("id"),
  "attempt_no" integer NOT NULL,
  "kind" varchar(50) NOT NULL DEFAULT 'final_generation',
  "status" varchar(50) NOT NULL DEFAULT 'queued',
  "provider_snapshot_json" text NOT NULL DEFAULT '{}',
  "provider_request_id" varchar(255),
  "stream_session_id" varchar(255),
  "spoken_text_hash" varchar(64) NOT NULL DEFAULT '',
  "spoken_language_tag" varchar(35),
  "audio_url" text,
  "audio_sha256" varchar(64),
  "duration_ms" integer,
  "sample_rate_hz" integer,
  "channel_count" integer,
  "audio_format" varchar(50),
  "timings_json" text NOT NULL DEFAULT '[]',
  "timing_source" varchar(50),
  "failure_code" varchar(100),
  "failure_detail" text,
  "started_at" timestamp,
  "completed_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "deleted_at" timestamp,
  CONSTRAINT "episode_dialogue_take_attempts_take_attempt_no_unique"
    UNIQUE ("take_id", "attempt_no")
);
--> statement-breakpoint
ALTER TABLE "episode_dialogue_takes"
  ADD CONSTRAINT "episode_dialogue_takes_approved_attempt_id_fk"
  FOREIGN KEY ("approved_attempt_id")
  REFERENCES "episode_dialogue_take_attempts"("id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_episode_dialogue_take_attempts_take"
  ON "episode_dialogue_take_attempts" ("take_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_episode_dialogue_take_attempts_status"
  ON "episode_dialogue_take_attempts" ("status", "created_at");
