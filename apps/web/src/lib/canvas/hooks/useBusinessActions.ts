'use client'

/**
 * useBusinessActions — 业务动作 hook（v0.2.0 PR3）
 *
 * 用 canvas-shared 的 resolveBusinessActions(nodeRegistry, ctx) 拿当前节点适用的动作。
 * 业务节点 type → contextMenu 映射：
 *   storyboard / image  → 'storyboard'   （image 节点共享 storyboard 的 prompt 类动作）
 *   character           → 'character'
 *   scene               → 'scene'
 *   其他                → 'global'
 *
 * trigger(action, sourceNodeId)：
 *   1. uiStore.setPendingAction({ action, sourceNodeId })  → 自动 setSelectedNodeId + 展开底栏
 *   2. ExpandedEditor 检测到 pendingAction → 切业务动作模式（标题 + "生成"按钮 + prompt placeholder）
 *   3. 用户填 userInput 点"生成" → canvasApi.triggerBusinessAction → mock 跑 6 状态 → 完成回填
 */

import { useCallback } from 'react'
import {
  nodeRegistry,
  resolveBusinessActions,
  type ResolvedBusinessAction,
} from '@xiaochuang/canvas-shared'

import { useUiStore } from '@/lib/canvas/store'

type CtxKey = 'storyboard' | 'character' | 'scene' | 'global'

const TYPE_TO_CTX: Record<string, CtxKey> = {
  storyboard: 'storyboard',
  image: 'storyboard', // image 节点共用 prompt 动作（构想/改画面）
  character: 'character',
  scene: 'scene',
}

export function useBusinessActions() {
  const setPendingAction = useUiStore((s) => s.setPendingAction)
  const setAssociateMode = useUiStore((s) => s.setAssociateMode)
  const closeNodeContextMenu = useUiStore((s) => s.closeNodeContextMenu)

  /** 解析某节点 type 适用的业务动作（按 contextMenu 过滤） */
  const resolve = useCallback((nodeType: string): ResolvedBusinessAction[] => {
    const ctx = TYPE_TO_CTX[nodeType] ?? 'global'
    return resolveBusinessActions(nodeRegistry, ctx)
  }, [])

  /**
   * 触发业务动作。
   *
   * - 关联类动作（"关联到分镜" / "设为分镜背景"）→ 进入 associateMode，不弹底栏
   * - 其他动作 → setPendingAction，自动展开底栏让用户填 userInput
   *
   * PR3 阶段 character 节点上的"关联到分镜"和 scene 节点上的"设为分镜背景"
   * 仍由前端 UI（NodeContextMenu）单独走 enterAssociateMode 入口，
   * 不通过 resolveBusinessActions（这两个动作不属于 BusinessAction schema —— 没有 promptTemplate）。
   */
  const trigger = useCallback(
    (action: ResolvedBusinessAction, sourceNodeId: string) => {
      closeNodeContextMenu()
      setPendingAction({ action, sourceNodeId })
    },
    [closeNodeContextMenu, setPendingAction],
  )

  /** 进入关联模式（PR3 业务动作 6/7） */
  const enterAssociateMode = useCallback(
    (sourceNodeId: string, mode: 'character' | 'scene') => {
      closeNodeContextMenu()
      setAssociateMode({ sourceNodeId, mode })
    },
    [closeNodeContextMenu, setAssociateMode],
  )

  return { resolve, trigger, enterAssociateMode }
}
