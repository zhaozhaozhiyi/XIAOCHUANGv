CREATE TABLE IF NOT EXISTS "storyboard_boundaries" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL REFERENCES "users"("id"),
  "drama_id" integer NOT NULL REFERENCES "dramas"("id"),
  "episode_id" integer NOT NULL REFERENCES "episodes"("id"),
  "from_storyboard_id" integer NOT NULL REFERENCES "storyboards"("id"),
  "to_storyboard_id" integer NOT NULL REFERENCES "storyboards"("id"),
  "source_storyboard_set_id" integer REFERENCES "storyboard_sets"("id"),
  "relation_type" varchar(50) NOT NULL DEFAULT 'intentional_cut',
  "transition_type" varchar(50) NOT NULL DEFAULT 'hard_cut',
  "opening_state_json" text NOT NULL DEFAULT '{}',
  "closing_state_json" text NOT NULL DEFAULT '{}',
  "handoff_json" text NOT NULL DEFAULT '{}',
  "asset_lock_json" text NOT NULL DEFAULT '{}',
  "status" varchar(50) NOT NULL DEFAULT 'draft',
  "review_json" text NOT NULL DEFAULT '{}',
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "deleted_at" timestamp
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_storyboard_boundaries_episode"
  ON "storyboard_boundaries" ("episode_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_storyboard_boundaries_from"
  ON "storyboard_boundaries" ("from_storyboard_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_storyboard_boundaries_to"
  ON "storyboard_boundaries" ("to_storyboard_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_storyboard_boundaries_set"
  ON "storyboard_boundaries" ("source_storyboard_set_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_storyboard_boundaries_active_pair"
  ON "storyboard_boundaries" ("episode_id", "from_storyboard_id", "to_storyboard_id")
  WHERE "deleted_at" IS NULL;
