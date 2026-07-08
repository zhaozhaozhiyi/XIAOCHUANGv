-- 清理历史脏数据：同一画布若存在多个活跃 run（pending/running），仅保留最新一个，其余置为 canceled。
-- canvas_runs 无 deleted_at 软删字段，故用 canceled 终态收敛重复活跃 run，为部分唯一索引扫清障碍。
WITH ranked_active_runs AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "canvas_id"
      ORDER BY "created_at" DESC NULLS LAST, "id" DESC
    ) AS duplicate_rank
  FROM "canvas_runs"
  WHERE "status" IN ('pending', 'running')
)
UPDATE "canvas_runs"
SET
  "status" = 'canceled',
  "error_message" = COALESCE("error_message", 'superseded by newer active run during unique index cleanup'),
  "completed_at" = now()
WHERE "id" IN (
  SELECT "id"
  FROM ranked_active_runs
  WHERE duplicate_rank > 1
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_canvas_runs_active_unique"
  ON "canvas_runs" ("canvas_id")
  WHERE "status" IN ('pending', 'running');
