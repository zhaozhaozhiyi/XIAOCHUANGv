ALTER TABLE "drama_asset_links"
  ADD COLUMN IF NOT EXISTS "review_status" varchar(30) NOT NULL DEFAULT 'pending_confirmation',
  ADD COLUMN IF NOT EXISTS "quality_status" varchar(30) NOT NULL DEFAULT 'not_evaluated',
  ADD COLUMN IF NOT EXISTS "quality_reasons_json" text NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS "reviewed_by" integer REFERENCES "users"("id"),
  ADD COLUMN IF NOT EXISTS "reviewed_at" timestamp,
  ADD COLUMN IF NOT EXISTS "stale_at" timestamp,
  ADD COLUMN IF NOT EXISTS "stale_reason" varchar(50),
  ADD COLUMN IF NOT EXISTS "version_key" varchar(80) NOT NULL DEFAULT '';

UPDATE "drama_asset_links"
SET "review_status" = CASE "status"
  WHEN 'candidate' THEN 'pending_confirmation'
  WHEN 'mainline' THEN 'confirmed'
  WHEN 'shot_private' THEN 'confirmed'
  WHEN 'legacy_mainline' THEN 'confirmed'
  WHEN 'rejected' THEN 'archived'
  WHEN 'archived' THEN 'archived'
  ELSE 'pending_confirmation'
END
WHERE "review_status" = 'pending_confirmation';

CREATE INDEX IF NOT EXISTS "idx_drama_asset_links_review"
  ON "drama_asset_links" ("drama_id", "review_status");

CREATE TABLE IF NOT EXISTS "drama_review_checkpoints" (
  "id" serial PRIMARY KEY,
  "drama_id" integer NOT NULL REFERENCES "dramas"("id"),
  "episode_id" integer REFERENCES "episodes"("id"),
  "storyboard_set_id" integer REFERENCES "storyboard_sets"("id"),
  "subject_type" varchar(30) NOT NULL,
  "subject_id" varchar(80) NOT NULL,
  "version_key" varchar(80) NOT NULL,
  "review_status" varchar(30) NOT NULL DEFAULT 'pending_confirmation',
  "review_note" text,
  "reviewed_by" integer REFERENCES "users"("id"),
  "reviewed_at" timestamp,
  "stale_at" timestamp,
  "stale_reason" varchar(50),
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_drama_review_checkpoint_version"
  ON "drama_review_checkpoints" ("drama_id", "subject_type", "subject_id", "version_key");
CREATE INDEX IF NOT EXISTS "idx_drama_review_checkpoint_status"
  ON "drama_review_checkpoints" ("drama_id", "episode_id", "review_status");
