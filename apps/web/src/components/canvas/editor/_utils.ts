/** 编辑器内部小工具 */

import type { XYPosition } from '@xyflow/react'

export function cryptoRandomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 12)
  }
  return Math.random().toString(36).slice(2, 14)
}

/**
 * 落点避让：给定目标位置，若与已有节点几乎重合则按级联偏移顺延，
 * 直到找到空位（或达到上限后兜底回退）。
 *
 * 解决"+ 添加 / 粘贴永远落在屏幕中心 → 连续创建叠罗汉"的问题。
 *
 * @param base       期望落点（flow 坐标，已做过 -96 之类的居中偏移）
 * @param existing   现有节点位置列表
 * @param step       级联步长（默认 36px，约等于一次能看清的偏移）
 * @param threshold  判定"重合"的距离阈值（默认 24px，两轴都小于才算撞）
 */
export function findFreePosition(
  base: XYPosition,
  existing: ReadonlyArray<{ position: XYPosition }>,
  step = 80,
  threshold = 48,
): XYPosition {
  const collides = (p: XYPosition) =>
    existing.some(
      (n) =>
        Math.abs(n.position.x - p.x) < threshold &&
        Math.abs(n.position.y - p.y) < threshold,
    )

  let pos = { ...base }
  // 最多顺延 50 次，避免极端情况下死循环
  for (let i = 0; i < 50 && collides(pos); i++) {
    pos = { x: pos.x + step, y: pos.y + step }
  }
  return pos
}
