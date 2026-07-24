CREATE TABLE IF NOT EXISTS "storyboard_sets" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL REFERENCES "users"("id"),
  "drama_id" integer NOT NULL REFERENCES "dramas"("id"),
  "episode_id" integer NOT NULL REFERENCES "episodes"("id"),
  "revision" integer NOT NULL,
  "status" varchar(50) NOT NULL DEFAULT 'draft',
  "origin" varchar(50) NOT NULL DEFAULT 'agent',
  "source_task_id" integer,
  "source_execution_id" integer,
  "episode_script_hash" varchar(128) NOT NULL,
  "story_graph_id" integer REFERENCES "drama_story_graphs"("id"),
  "story_graph_script_hash" varchar(128),
  "base_revision" integer,
  "base_content_hash" varchar(128),
  "content_hash" varchar(128) NOT NULL,
  "human_edited_at" timestamp,
  "published_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_storyboard_sets_episode_revision"
  ON "storyboard_sets" ("episode_id", "revision");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_storyboard_sets_user_episode"
  ON "storyboard_sets" ("user_id", "episode_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_storyboard_sets_status"
  ON "storyboard_sets" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_storyboard_sets_task_id"
  ON "storyboard_sets" ("source_task_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "storyboard_set_items" (
  "id" serial PRIMARY KEY NOT NULL,
  "storyboard_set_id" integer NOT NULL REFERENCES "storyboard_sets"("id"),
  "storyboard_number" integer NOT NULL,
  "payload_json" text NOT NULL,
  "content_hash" varchar(128) NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_storyboard_set_items_number"
  ON "storyboard_set_items" ("storyboard_set_id", "storyboard_number");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_storyboard_set_items_set_id"
  ON "storyboard_set_items" ("storyboard_set_id");
--> statement-breakpoint
ALTER TABLE "storyboards"
  ADD COLUMN IF NOT EXISTS "storyboard_set_id" integer REFERENCES "storyboard_sets"("id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_storyboards_set_id"
  ON "storyboards" ("storyboard_set_id");
