import type { BusinessAction } from '../schema/business-action.js'
import type { CanvasNodeDefinition } from '../schema/node-definition.js'

/**
 * 解析后的业务动作 —— 带上来源节点 ID
 */
export interface ResolvedBusinessAction extends BusinessAction {
  /** 这个动作来自哪个节点定义（用于触发时知道调哪个 executor）*/
  sourceNodeDefId: string
}

/**
 * 按 contextMenu 类型筛选可用的业务动作
 *
 * 示例：
 *   resolveBusinessActions(nodeRegistry, 'character')
 *   → 返回所有声明了 contextMenu='character' 的 actions（含 text-to-image 的"换装/换表情/置入场景"）
 *
 * 前端右键菜单消费：
 *   const actions = resolveBusinessActions(nodeRegistry, 'character')
 *   menu.add(actions.map(a => ({ label: a.label, onClick: () => trigger(a) })))
 */
export function resolveBusinessActions(
  registry: Readonly<Record<string, CanvasNodeDefinition>>,
  contextMenu: 'storyboard' | 'character' | 'scene' | 'global',
): ResolvedBusinessAction[] {
  const result: ResolvedBusinessAction[] = []
  for (const [defId, node] of Object.entries(registry)) {
    if (!node.businessActions) continue
    for (const action of node.businessActions) {
      if (action.contextMenu === contextMenu) {
        result.push({ ...action, sourceNodeDefId: defId })
      }
    }
  }
  return result
}
