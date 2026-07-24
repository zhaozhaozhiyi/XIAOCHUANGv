ALTER TABLE "canvases"
  ADD COLUMN IF NOT EXISTS "profile" varchar(30) NOT NULL DEFAULT 'general';

ALTER TABLE "canvases"
  ADD COLUMN IF NOT EXISTS "source_storyboard_id" text;

ALTER TABLE "canvases"
  ADD COLUMN IF NOT EXISTS "production_context_json" text NOT NULL DEFAULT '{}';

UPDATE "canvases"
SET "profile" = 'drama'
WHERE "source" = 'from-drama'
  AND "profile" = 'general';

CREATE INDEX IF NOT EXISTS "idx_canvases_profile" ON "canvases"("profile");
CREATE INDEX IF NOT EXISTS "idx_canvases_source_drama" ON "canvases"("source_drama_id");
CREATE INDEX IF NOT EXISTS "idx_canvases_source_episode" ON "canvases"("source_episode_id");

CREATE TABLE IF NOT EXISTS "drama_asset_links" (
  "id" serial PRIMARY KEY,
  "user_id" integer REFERENCES "users"("id"),
  "drama_id" integer NOT NULL REFERENCES "dramas"("id"),
  "episode_id" integer REFERENCES "episodes"("id"),
  "storyboard_id" integer REFERENCES "storyboards"("id"),
  "asset_id" integer NOT NULL REFERENCES "assets"("id"),
  "scope" varchar(30) NOT NULL DEFAULT 'project',
  "status" varchar(30) NOT NULL DEFAULT 'candidate',
  "role" varchar(50) NOT NULL DEFAULT 'reference',
  "target_type" varchar(50),
  "target_id" varchar(80),
  "target_field" varchar(80),
  "source_module" varchar(50),
  "source_canvas_id" text,
  "source_node_id" text,
  "source_result_id" text,
  "source_task_id" integer REFERENCES "tasks"("id"),
  "previous_asset_id" integer REFERENCES "assets"("id"),
  "metadata_json" text NOT NULL DEFAULT '{}',
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "deleted_at" timestamp
);

CREATE INDEX IF NOT EXISTS "idx_drama_asset_links_drama" ON "drama_asset_links"("drama_id", "status");
CREATE INDEX IF NOT EXISTS "idx_drama_asset_links_episode" ON "drama_asset_links"("episode_id");
CREATE INDEX IF NOT EXISTS "idx_drama_asset_links_storyboard" ON "drama_asset_links"("storyboard_id");
CREATE INDEX IF NOT EXISTS "idx_drama_asset_links_asset" ON "drama_asset_links"("asset_id");
CREATE INDEX IF NOT EXISTS "idx_drama_asset_links_source_canvas" ON "drama_asset_links"("source_canvas_id", "source_node_id");

CREATE UNIQUE INDEX IF NOT EXISTS "idx_drama_asset_links_task_target_unique"
  ON "drama_asset_links"("source_task_id", "target_type", "target_id", "target_field")
  WHERE "source_task_id" IS NOT NULL AND "deleted_at" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "idx_drama_asset_links_canvas_result_unique"
  ON "drama_asset_links"("source_canvas_id", "source_node_id", "source_result_id", "target_type", "target_id", "target_field")
  WHERE "source_canvas_id" IS NOT NULL AND "source_result_id" IS NOT NULL AND "deleted_at" IS NULL;
