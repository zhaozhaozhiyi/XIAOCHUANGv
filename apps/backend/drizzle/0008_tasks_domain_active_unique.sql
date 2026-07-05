WITH ranked_active_tasks AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "domain_table", "domain_id"
      ORDER BY "updated_at" DESC NULLS LAST, "id" DESC
    ) AS duplicate_rank
  FROM "tasks"
  WHERE "deleted_at" IS NULL
)
UPDATE "tasks"
SET
  "deleted_at" = now(),
  "updated_at" = now()
WHERE "id" IN (
  SELECT "id"
  FROM ranked_active_tasks
  WHERE duplicate_rank > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_tasks_domain_active_unique"
  ON "tasks" ("domain_table", "domain_id")
  WHERE "deleted_at" IS NULL;
