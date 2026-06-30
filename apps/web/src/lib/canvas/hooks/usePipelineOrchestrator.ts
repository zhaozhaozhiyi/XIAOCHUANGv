'use client'

/**
 * usePipelineOrchestrator — 对话编排 → 真实画布（v2.2 PR-B）
 *
 * 用户在 ChatDock 输入故事 → 调 POST /api/v1/ai/runs（skill=storyboard_from_text）
 * 拿到结构化草稿 → 按分层布局落节点并自动连线；失败时本地启发式兜底。
 * 再次生成前清理上一轮流水线节点（__genBy 标记 + 旧版特征识别），防叠罗汉。
 */

import { useCallback, useRef } from 'react'
import { useReactFlow } from '@xyflow/react'

import { cryptoRandomId } from '@/components/canvas/editor/_utils'
import {
  useCanvasStore,
  useEdgesStore,
  useHistoryStore,
  useNodesStore,
  type FlowEdge,
  type FlowNode,
} from '@/lib/canvas/store'
import { usePipelineStore } from '@/lib/canvas/store/pipelineStore'
import { splitStoryIntoStoryboard, type PipelineResult } from '@/lib/canvas/api/pipeline'
import { getCanvasFitPadding, layoutCanvasNodes, columnPositions, layeredPosition } from '@/lib/canvas/utils/autoLayout'

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** 流水线生成节点的标记位：用于「下一次生成前」清理上一轮草稿，避免叠罗汉 */
const GEN_FLAG = '__genBy'
const GEN_VALUE = 'pipeline'

function makeNode(type: FlowNode['type'], position: FlowNode['position'], data: Record<string, unknown>): FlowNode {
  return { id: `node_${cryptoRandomId()}`, type, position, data: { ...data, [GEN_FLAG]: GEN_VALUE } }
}

function isGenerated(node: FlowNode): boolean {
  const d = node.data as Record<string, unknown> | undefined
  if (d?.[GEN_FLAG] === GEN_VALUE) return true
  // PR-B 之前生成的节点无标记，按特征清理上一轮流水线草稿
  if (node.type === 'note' && typeof d?.text === 'string' && d.text.includes('剧本大纲')) return true
  if (
    (node.type === 'character' || node.type === 'scene')
    && d?.description === '由剧本自动生成，待细化'
  ) {
    return true
  }
  // 旧版流水线分镜（有 shotIndex、未手动锁定）
  if (node.type === 'storyboard' && typeof d?.shotIndex === 'number' && !d?.__userLocked) {
    return true
  }
  return false
}

/** 按真实 handle id 建一条叙事边（handle id 形如 "out:video" / "in:image"） */
function makeEdge(
  source: string,
  sourceHandle: string,
  target: string,
  targetHandle: string,
): FlowEdge {
  return {
    id: `edge_${cryptoRandomId()}`,
    source,
    target,
    sourceHandle,
    targetHandle,
    type: 'narrative',
    data: {
      edge_kind: 'narrative',
      relation_type: 'solid',
      source_port: sourceHandle,
      target_port: targetHandle,
    },
  }
}

/** AI 不可达 / 未配置时的本地兜底草稿（与一期 mock 行为一致）。 */
function fallbackResult(text: string): PipelineResult {
  return {
    outline: `${text.slice(0, 80)}${text.length > 80 ? '…' : ''}`,
    characters: [
      { name: '女主角', description: '由剧本自动生成，待细化' },
      { name: '男主角', description: '由剧本自动生成，待细化' },
    ],
    scenes: [
      { location: '城市夜景', description: '由剧本自动生成，待细化' },
      { location: '室内客厅', description: '由剧本自动生成，待细化' },
    ],
    shots: [
      { title: '开场建立镜头', shotType: '全景', cameraMove: '推', description: '交代环境与氛围', duration: 4 },
      { title: '主角登场', shotType: '中景', cameraMove: '跟', description: '主角进入画面', duration: 5 },
      { title: '冲突爆发', shotType: '近景', cameraMove: '摇', description: '情绪转折点', duration: 6 },
      { title: '收尾留白', shotType: '远景', cameraMove: '固定', description: '余韵与悬念', duration: 4 },
    ],
  }
}

export function usePipelineOrchestrator() {
  const reactFlow = useReactFlow()
  const runningRef = useRef(false)

  const run = useCallback(
    async (input: string) => {
      const text = input.trim()
      if (!text || runningRef.current) return
      runningRef.current = true

      const pipeline = usePipelineStore.getState()
      pipeline.setRunning(true)

      try {
        const nodesState = useNodesStore.getState()
        const edgesState = useEdgesStore.getState()
        const addNode = nodesState.addNode
        const addEdge = edgesState.addEdge
        const historyPush = useHistoryStore.getState().push
        const markEditing = useCanvasStore.getState().markEditing

        historyPush()

        // ── 防叠加：清掉上一轮「流水线生成」的节点/边，保留用户手动节点 ───────
        const removedIds = new Set(nodesState.nodes.filter(isGenerated).map((n) => n.id))
        const keptNodes = nodesState.nodes.filter((n) => !isGenerated(n))
        if (removedIds.size) {
          nodesState.replaceAll(keptNodes)
          edgesState.replaceAll(
            edgesState.edges.filter((e) => !removedIds.has(e.source) && !removedIds.has(e.target)),
          )
        }
        // 新内容落在已有(用户)内容下方，避免与保留节点重叠
        const baseY = keptNodes.length
          ? Math.max(...keptNodes.map((n) => n.position.y)) + 320
          : 0

        // 重置流程清单为待执行
        pipeline.setSteps(pipeline.steps.map((s) => ({ ...s, status: 'pending' as const })))
        pipeline.pushMessage({ role: 'user', text })
        pipeline.pushMessage({
          role: 'agent',
          agent: 'director',
          text: '收到，我来安排团队拆解这个故事。',
        })

        // ── 1. 剧本拆解（真实 script.split → /ai/runs；失败回退本地草稿）──────
        pipeline.updateStep('script', { status: 'active' })
        const data = (await splitStoryIntoStoryboard(text)) ?? fallbackResult(text)

        const scriptNode = makeNode('note', layeredPosition(0, 0, { originY: baseY }), {
          text: `📄 剧本大纲\n${data.outline || text.slice(0, 80)}`,
          color: 'blue',
        })
        addNode(scriptNode)
        pipeline.pushMessage({
          role: 'agent',
          agent: 'writer',
          text: '我把它拆成了主线剧本，确认方向后我们继续做角色和场景。',
        })
        pipeline.updateStep('script', { status: 'done' })

        // ── 2. 角色设定（角色设计师）────────────────────────────────────────
        pipeline.updateStep('character', { status: 'active' })
        await delay(400)
        const characters = (data.characters.length ? data.characters : fallbackResult(text).characters).slice(0, 4)
        const charNodes = characters.map((c, i) =>
          makeNode('character', layeredPosition(1, i, { originY: baseY - 240 }), {
            name: c.name,
            description: c.role ? `${c.role}｜${c.description ?? ''}`.trim() : (c.description || '由剧本自动生成，待细化'),
          }),
        )
        charNodes.forEach((n) => addNode(n))
        pipeline.pushMessage({
          role: 'agent',
          agent: 'character',
          text: '主要角色已建立，点卡片上的「生成形象」或右侧检视面板，随时出图。',
        })
        pipeline.updateStep('character', { status: 'done' })

        // ── 3. 场景设定（美术指导）──────────────────────────────────────────
        pipeline.updateStep('scene', { status: 'active' })
        await delay(400)
        const scenes = (data.scenes.length ? data.scenes : fallbackResult(text).scenes).slice(0, 4)
        const sceneNodes = scenes.map((s, i) =>
          makeNode('scene', layeredPosition(2, i, { originY: baseY - 240 }), {
            name: s.time ? `${s.time}·${s.location}` : s.location,
            description: s.description || '由剧本自动生成，待细化',
          }),
        )
        sceneNodes.forEach((n) => addNode(n))
        pipeline.pushMessage({
          role: 'agent',
          agent: 'art',
          text: '主要场景已就绪，点「生成场景」出概念图；分镜画面也可逐个生成，满意后再合成成片。',
        })
        pipeline.updateStep('scene', { status: 'done' })

        // ── 4. 分镜脚本（分镜师）────────────────────────────────────────────
        pipeline.updateStep('storyboard', { status: 'active' })
        await delay(400)
        const shotPos = columnPositions(3, data.shots.length, { originY: baseY })
        const shotNodes = data.shots.map((s, i) =>
          makeNode('storyboard', shotPos[i], {
            shotIndex: i + 1,
            title: s.title,
            shotType: s.shotType,
            cameraMove: s.cameraMove,
            shotDescription: s.description,
            duration: s.duration ?? 4,
          }),
        )
        shotNodes.forEach((n) => addNode(n))

        // 自动连线：分镜串成叙事链 + 角色/场景汇入首镜
        const firstShot = shotNodes[0]
        if (firstShot) {
          charNodes.forEach((c) => addEdge(makeEdge(c.id, 'out:character', firstShot.id, 'in:image')))
          sceneNodes.forEach((sc) => addEdge(makeEdge(sc.id, 'out:scene', firstShot.id, 'in:image')))
          for (let i = 0; i < shotNodes.length - 1; i++) {
            addEdge(makeEdge(shotNodes[i].id, 'out:video', shotNodes[i + 1].id, 'in:video'))
          }
        }
        pipeline.pushMessage({
          role: 'agent',
          agent: 'storyboard',
          text: `已生成 ${shotNodes.length} 个分镜。逐个确认或修改后，点顶部「生成成片」即可开拍。`,
        })
        pipeline.updateStep('storyboard', { status: 'done' })

        pipeline.pushMessage({
          role: 'agent',
          agent: 'director',
          text: '设计稿已经在画布上了。你可以直接对话调整，或切到「导演模式」手动连线。满意后点「生成成片」开始制作。',
        })
        markEditing()

        // 全画布自动整理，避免角色/场景/分镜叠在一起
        const { nodes: allNodes } = useNodesStore.getState()
        const { edges: allEdges } = useEdgesStore.getState()
        const positions = layoutCanvasNodes(allNodes, allEdges)
        useNodesStore.getState().replaceAll(
          allNodes.map((node) => ({
            ...node,
            position: positions.get(node.id) ?? node.position,
          })),
        )

        const { chatOpen, railOpen, canvasMode } = usePipelineStore.getState()
        requestAnimationFrame(() => {
          reactFlow.fitView({
            duration: 400,
            padding: getCanvasFitPadding({
              chatOpen: canvasMode === 'chat' && chatOpen,
              railOpen,
            }),
          })
        })
      } catch (err) {
        console.error('[usePipelineOrchestrator]', err)
        pipeline.pushMessage({
          role: 'system',
          text: '拆解过程出错，请重试。',
        })
      } finally {
        pipeline.setRunning(false)
        runningRef.current = false
      }
    },
    [reactFlow],
  )

  return { run }
}
