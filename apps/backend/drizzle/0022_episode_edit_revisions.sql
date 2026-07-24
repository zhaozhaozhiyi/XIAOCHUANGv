CREATE TABLE IF NOT EXISTS "episode_edit_revisions" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL REFERENCES "users"("id"),
  "drama_id" integer NOT NULL REFERENCES "dramas"("id"),
  "episode_id" integer NOT NULL REFERENCES "episodes"("id"),
  "production_run_id" integer REFERENCES "episode_media_production_runs"("id"),
  "timeline_json" text NOT NULL DEFAULT '{}',
  "source_snapshot_json" text NOT NULL DEFAULT '{}',
  "status" varchar(50) NOT NULL DEFAULT 'draft',
  "merged_video_url" text,
  "failure_code" varchar(100),
  "failure_detail" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "completed_at" timestamp,
  "deleted_at" timestamp
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_episode_edit_revisions_episode"
  ON "episode_edit_revisions" ("episode_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_episode_edit_revisions_run"
  ON "episode_edit_revisions" ("production_run_id");
--> statement-breakpoint
ALTER TABLE "video_merges"
  ADD COLUMN IF NOT EXISTS "edit_revision_id" integer REFERENCES "episode_edit_revisions"("id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_video_merges_edit_revision"
  ON "video_merges" ("edit_revision_id");
