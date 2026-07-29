WITH ranked_source_chunks AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "source_id", "chunk_no"
      ORDER BY
        CASE WHEN "status" = 'ready' THEN 0 ELSE 1 END,
        "updated_at" DESC NULLS LAST,
        "id" DESC
    ) AS duplicate_rank
  FROM "drama_source_chunks"
)
DELETE FROM "drama_source_chunks"
WHERE "id" IN (
  SELECT "id"
  FROM ranked_source_chunks
  WHERE duplicate_rank > 1
);
--> statement-breakpoint
DROP INDEX IF EXISTS "idx_drama_source_chunks_source_id";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_drama_source_chunks_source_chunk_no"
  ON "drama_source_chunks" ("source_id", "chunk_no");
