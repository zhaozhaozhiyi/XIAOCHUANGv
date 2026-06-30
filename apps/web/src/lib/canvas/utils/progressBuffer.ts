/**
 * progressBuffer — 节点进度更新的 RAF 合批（v0.2.0 PR2）
 *
 * TRD §3.4.2 强约束：100 节点并发推 progress 时不能每次都 React re-render。
 * 方案：
 *  1. 调用方（轮询 / SSE / mock）调 scheduleProgressUpdate(nodeId, progress)
 *  2. 这里缓存到一个 Map，仅在 RAF 帧到来时统一 flush
 *  3. flush 直接写 DOM `[data-node-id="..."]` 的 --xc-progress CSS var
 *  4. 完全不走 React state → 不触发 reconciliation
 *
 * 最终态（completed / failed）应该走 runtimeStore.mergeNodeState 写回 store，
 * 触发该节点 re-render（per-node selector 保证只它一个 re-render）。
 * progress 数字本身仅在 hover tooltip / 关闭页前显示，不需要存 React。
 */

const buffer = new Map<string, number>()
let raf: number | null = null

/** 调度一次进度更新，自动合批到下个 RAF 帧 */
export function scheduleProgressUpdate(nodeId: string, progress: number): void {
  buffer.set(nodeId, progress)
  if (raf === null && typeof window !== 'undefined') {
    raf = window.requestAnimationFrame(flush)
  }
}

function flush() {
  // SSR 守卫：仅浏览器执行
  if (typeof document === 'undefined') {
    buffer.clear()
    raf = null
    return
  }
  buffer.forEach((progress, nodeId) => {
    const el = document.querySelector(`[data-node-id="${nodeId}"]`) as HTMLElement | null
    if (!el) return
    const clamped = Math.max(0, Math.min(100, progress))
    el.style.setProperty('--xc-progress', `${clamped}%`)
  })
  buffer.clear()
  raf = null
}

/** 取消所有待 flush 的进度更新（画布卸载 / 切换时调用） */
export function cancelAllProgressUpdates(): void {
  if (raf !== null && typeof window !== 'undefined') {
    window.cancelAnimationFrame(raf)
  }
  raf = null
  buffer.clear()
}

/** 测试 / 调试用：当前缓冲区大小 */
export function getBufferSize(): number {
  return buffer.size
}
