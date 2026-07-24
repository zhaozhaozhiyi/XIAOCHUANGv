CREATE TABLE IF NOT EXISTS "episode_media_production_runs" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL REFERENCES "users"("id"),
  "drama_id" integer NOT NULL REFERENCES "dramas"("id"),
  "episode_id" integer NOT NULL REFERENCES "episodes"("id"),
  "storyboard_set_id" integer NOT NULL REFERENCES "storyboard_sets"("id"),
  "status" varchar(50) NOT NULL DEFAULT 'queued',
  "run_plan_json" text NOT NULL DEFAULT '{}',
  "current_storyboard_id" integer REFERENCES "storyboards"("id"),
  "started_at" timestamp,
  "completed_at" timestamp,
  "canceled_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_episode_media_runs_episode"
  ON "episode_media_production_runs" ("episode_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_episode_media_runs_user_episode"
  ON "episode_media_production_runs" ("user_id", "episode_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_episode_media_runs_set"
  ON "episode_media_production_runs" ("storyboard_set_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "episode_media_run_items" (
  "id" serial PRIMARY KEY NOT NULL,
  "production_run_id" integer NOT NULL REFERENCES "episode_media_production_runs"("id"),
  "storyboard_id" integer NOT NULL REFERENCES "storyboards"("id"),
  "boundary_id" integer REFERENCES "storyboard_boundaries"("id"),
  "sequence_index" integer NOT NULL,
  "predecessor_item_id" integer REFERENCES "episode_media_run_items"("id"),
  "status" varchar(50) NOT NULL DEFAULT 'waiting_dependency',
  "start_anchor_url" text,
  "planned_end_anchor_url" text,
  "actual_tail_frame_url" text,
  "video_generation_id" integer REFERENCES "video_generations"("id"),
  "failure_code" varchar(100),
  "failure_detail" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_episode_media_run_items_run_storyboard"
  ON "episode_media_run_items" ("production_run_id", "storyboard_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_episode_media_run_items_predecessor"
  ON "episode_media_run_items" ("predecessor_item_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_episode_media_run_items_video_generation"
  ON "episode_media_run_items" ("video_generation_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_episode_media_run_items_run_status"
  ON "episode_media_run_items" ("production_run_id", "status");
