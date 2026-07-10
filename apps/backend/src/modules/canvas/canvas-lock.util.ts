import { sql } from 'drizzle-orm'

/**
 * canvas-level advisory lock（事务内）。
 *
 * canvas-save 的全量删插与 canvas-result-backfill 的 appendResult 都用同一把锁，
 * 保证 save 不会在 backfill 写 results 期间删掉/覆盖目标节点（results 丢失竞态）。
 * `pg_advisory_xact_lock` 在事务结束自动释放，只在事务内调用。
 */
export function canvasAdvisoryLockSql(canvasId: string) {
  return sql`SELECT pg_advisory_xact_lock(hashtext(${canvasId}))`
}
