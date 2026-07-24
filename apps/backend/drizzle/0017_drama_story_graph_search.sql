CREATE TABLE IF NOT EXISTS "drama_graph_index_chunks" (
  "id" serial PRIMARY KEY,
  "graph_id" integer NOT NULL REFERENCES "drama_story_graphs"("id") ON DELETE CASCADE,
  "drama_id" integer NOT NULL REFERENCES "dramas"("id"),
  "user_id" integer NOT NULL REFERENCES "users"("id"),
  "chunk_kind" varchar(50) NOT NULL,
  "ref_id" integer,
  "ref_type" varchar(50),
  "episode_number" integer,
  "title" varchar(500),
  "content" text NOT NULL,
  "content_hash" varchar(128) NOT NULL,
  "embedding_model" varchar(100),
  "embedding_json" text NOT NULL DEFAULT '[]',
  "metadata_json" text NOT NULL DEFAULT '{}',
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_drama_graph_index_chunks_graph_kind"
  ON "drama_graph_index_chunks" ("graph_id", "chunk_kind");

CREATE UNIQUE INDEX IF NOT EXISTS "idx_drama_graph_index_chunks_graph_ref"
  ON "drama_graph_index_chunks" ("graph_id", "chunk_kind", "ref_id")
  WHERE "ref_id" IS NOT NULL;

DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS vector;
  ALTER TABLE "drama_graph_index_chunks"
    ADD COLUMN IF NOT EXISTS "embedding" vector(1536);
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'pgvector unavailable; semantic search will use embedding_json fallback';
END $$;
