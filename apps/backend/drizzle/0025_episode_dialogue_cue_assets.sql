ALTER TABLE "episode_dialogue_cues"
  ADD COLUMN IF NOT EXISTS "take_sample_in" integer;
--> statement-breakpoint
ALTER TABLE "episode_dialogue_cues"
  ADD COLUMN IF NOT EXISTS "take_sample_out" integer;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "episode_dialogue_cue_assets" (
  "id" serial PRIMARY KEY NOT NULL,
  "dialogue_cue_id" integer NOT NULL REFERENCES "episode_dialogue_cues"("id"),
  "source_take_id" integer NOT NULL REFERENCES "episode_dialogue_takes"("id"),
  "source_attempt_id" integer NOT NULL REFERENCES "episode_dialogue_take_attempts"("id"),
  "source_sample_in" integer NOT NULL,
  "source_sample_out" integer NOT NULL,
  "audio_url" text,
  "audio_sha256" varchar(64),
  "sample_rate_hz" integer,
  "codec" varchar(50),
  "provider_input_snapshot_json" text NOT NULL DEFAULT '{}',
  "status" varchar(50) NOT NULL DEFAULT 'planned',
  "failure_code" varchar(100),
  "failure_detail" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "deleted_at" timestamp,
  CONSTRAINT "episode_dialogue_cue_assets_source_range_check"
    CHECK ("source_sample_out" > "source_sample_in")
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_episode_dialogue_cue_assets_active_cue"
  ON "episode_dialogue_cue_assets" ("dialogue_cue_id")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_episode_dialogue_cue_assets_source_attempt"
  ON "episode_dialogue_cue_assets" ("source_attempt_id", "status");
