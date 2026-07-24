CREATE TABLE IF NOT EXISTS "episode_dialogue_takes" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL REFERENCES "users"("id"),
  "drama_id" integer NOT NULL REFERENCES "dramas"("id"),
  "episode_id" integer NOT NULL REFERENCES "episodes"("id"),
  "source_storyboard_set_id" integer REFERENCES "storyboard_sets"("id"),
  "source_script_revision_id" varchar(128),
  "speaker_character_id" integer REFERENCES "characters"("id"),
  "speaker_name" varchar(255) NOT NULL,
  "voice_snapshot_json" text NOT NULL DEFAULT '{}',
  "text" text NOT NULL,
  "performance_json" text NOT NULL DEFAULT '{}',
  "audio_url" text,
  "duration_ms" integer,
  "timings_json" text NOT NULL DEFAULT '[]',
  "timing_source" varchar(50),
  "status" varchar(50) NOT NULL DEFAULT 'planned',
  "task_id" integer,
  "alignment_task_id" integer,
  "failure_code" varchar(100),
  "failure_detail" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "deleted_at" timestamp
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_episode_dialogue_takes_episode"
  ON "episode_dialogue_takes" ("episode_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_episode_dialogue_takes_task"
  ON "episode_dialogue_takes" ("task_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "episode_dialogue_cues" (
  "id" serial PRIMARY KEY NOT NULL,
  "dialogue_take_id" integer NOT NULL REFERENCES "episode_dialogue_takes"("id"),
  "storyboard_id" integer NOT NULL REFERENCES "storyboards"("id"),
  "boundary_id" integer REFERENCES "storyboard_boundaries"("id"),
  "take_in_ms" integer,
  "take_out_ms" integer,
  "timeline_in_ms" integer,
  "cue_mode" varchar(50) NOT NULL DEFAULT 'within_shot',
  "sync_policy" varchar(50) NOT NULL DEFAULT 'not_required',
  "subtitle_segments_json" text NOT NULL DEFAULT '[]',
  "status" varchar(50) NOT NULL DEFAULT 'planned',
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "deleted_at" timestamp
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_episode_dialogue_cues_take"
  ON "episode_dialogue_cues" ("dialogue_take_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_episode_dialogue_cues_storyboard"
  ON "episode_dialogue_cues" ("storyboard_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_episode_dialogue_cues_active_take_storyboard"
  ON "episode_dialogue_cues" ("dialogue_take_id", "storyboard_id")
  WHERE "deleted_at" IS NULL;
