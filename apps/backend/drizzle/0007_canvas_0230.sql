ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "source_ref" text;
CREATE INDEX IF NOT EXISTS "idx_assets_source_ref" ON "assets" ("source_ref");
