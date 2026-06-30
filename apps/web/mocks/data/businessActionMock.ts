/**
 * BusinessActionMock — mock 端业务动作回路（v0.2.0 PR3）
 *
 * 处理"构想画面 / 改画面 / 配音 / 生成镜头视频 / 换装 / 换表情 / 换时段 / 换天气"等
 * keepNodeHidden 型动作：
 *   1. 在画布 store 创建 hidden:true 的 execute 节点（type = sourceNodeDefId）
 *   2. 自动添加 dataflow 连线（隐藏节点输出 → sourceNode 对应端口；v0.2.0 不强校验端口）
 *   3. 走 6 状态推进（独立 setTimeout 链，不复用 runController 的 startRun）
 *   4. completed 时把生成结果回填到 sourceNode.data 对应字段：
 *      - text-to-image  → data.images = [generatedUrl]；同步把旧 images[0] 推进 historyImages
 *      - text-to-speech → data.audioUrl
 *      - image-to-video → data.videoUrl
 *   5. 同步把状态写到 runController 的 currentRun（与 PR2 的 getRunStatus 兼容）
 *
 * 设计取舍：v0.2.0 阶段不删除隐藏节点（保留在 store 中，列表 filter 隐藏即可），
 *           方便撤销栈和 save 链路保持一致。
 */

import type {
  CanvasNode,
  CanvasNodeType,
  NodeRuntimeState,
  StoryboardData,
} from '@/lib/canvas/types'
import { cryptoRandomId, getCanvas, updateCanvas } from './store'
import { setNodeStatus } from './runController'

const HIDDEN_PREFIX = 'hidden_'

interface TriggerInput {
  actionLabel: string
  sourceNodeId: string
  sourceNodeDefId: 'text-to-image' | 'text-to-speech' | 'image-to-video' | string
  userInput: string
  style?: string
}

interface TriggerResult {
  hidden_node_id: string
  run_id: string
}

/** 按 sourceNodeDefId 决定回填到 sourceNode 的哪个字段 + 生成 mock URL */
function buildResult(
  defId: string,
  hiddenNodeId: string,
): Partial<StoryboardData> | null {
  const seed = hiddenNodeId.replace(HIDDEN_PREFIX, '').slice(0, 8)
  switch (defId) {
    case 'text-to-image':
      return {
        images: [`https://picsum.photos/seed/${seed}/512/288`],
      }
    case 'text-to-speech':
      return {
        audioUrl: `https://example.local/mock-audio/${seed}.mp3`,
      }
    case 'image-to-video':
      return {
        videoUrl: `https://example.local/mock-video/${seed}.mp4`,
      }
    default:
      return null
  }
}

/** 把上次的 images[0] 推进历史，最多保留 20 条（PRD §12.6） */
function archiveOldImages(
  current: StoryboardData,
  prompt: string,
  style: string | undefined,
): StoryboardData['historyImages'] {
  const old = current.images?.[0]
  if (!old) return current.historyImages
  const prev = current.historyImages ?? []
  const next = [
    { url: old, prompt, style, timestamp: new Date().toISOString() },
    ...prev,
  ]
  return next.slice(0, 20)
}

export function triggerBusinessAction(
  canvasId: string,
  input: TriggerInput,
): TriggerResult | null {
  const canvas = getCanvas(canvasId)
  if (!canvas) return null

  const sourceNode = canvas.nodes.find((n) => n.id === input.sourceNodeId)
  if (!sourceNode) return null

  // 1. 创建 hidden 执行节点（位置在 sourceNode 旁边一点，便于调试时也能找）
  const hiddenNodeId = `${HIDDEN_PREFIX}${cryptoRandomId()}`
  const runId = `run_${cryptoRandomId()}`
  const hiddenNode: CanvasNode = {
    id: hiddenNodeId,
    type: input.sourceNodeDefId as CanvasNodeType,
    position: { x: sourceNode.position.x + 320, y: sourceNode.position.y },
    width: 220,
    data: {
      prompt: input.userInput,
      style: input.style,
      sourceNodeId: input.sourceNodeId,
      actionLabel: input.actionLabel,
    },
    hidden: true,
  }

  // 2. 同步写入画布 store（节点 + 一条 dataflow 边）
  const nextNodes = [...canvas.nodes, hiddenNode]
  // v0.2.0 不强 schema 校验端口；保留 source_port='out:<type>' 让前端 dataflow edge 着色一致
  const portType =
    input.sourceNodeDefId === 'text-to-image'
      ? 'image'
      : input.sourceNodeDefId === 'text-to-speech'
        ? 'audio'
        : input.sourceNodeDefId === 'image-to-video'
          ? 'video'
          : 'image'
  const edge = {
    id: `edge_hidden_${cryptoRandomId()}`,
    source: hiddenNodeId,
    target: input.sourceNodeId,
    edge_kind: 'dataflow' as const,
    source_port: `out:${portType}`,
    target_port: `in:${portType}`,
  }
  const nextEdges = [...canvas.edges, edge]
  updateCanvas(canvasId, { nodes: nextNodes, edges: nextEdges })

  // 3. 推进 6 状态（同步进 runController 让 GET /run-status 能拉到）
  const push = (state: NodeRuntimeState) => setNodeStatus(canvasId, hiddenNodeId, state)
  let delay = 100
  const tid = (fn: () => void, ms: number) => window.setTimeout(fn, ms)

  tid(() => push({ status: 'queued' }), (delay += 0))
  tid(() => push({ status: 'running', progress: 0 }), (delay += 200))
  for (let p = 20; p <= 80; p += 20) {
    const progress = p
    tid(() => push({ status: 'running', progress }), (delay += 350))
  }
  tid(() => {
    push({ status: 'running', progress: 100 })
  }, (delay += 350))
  // 完成 + 回填
  tid(() => {
    push({ status: 'completed', progress: 100 })

    const result = buildResult(input.sourceNodeDefId, hiddenNodeId)
    if (!result) return
    const latest = getCanvas(canvasId)
    if (!latest) return
    const target = latest.nodes.find((n) => n.id === input.sourceNodeId)
    if (!target) return

    const oldData = (target.data ?? {}) as StoryboardData
    let merged: StoryboardData = { ...oldData, ...result }

    // text-to-image 回填时把旧图推进历史 + 写 prompt
    if (input.sourceNodeDefId === 'text-to-image') {
      merged = {
        ...merged,
        historyImages: archiveOldImages(oldData, input.userInput, input.style),
        prompt: input.userInput,
      }
    }

    const nextNodes2 = latest.nodes.map((n) =>
      n.id === input.sourceNodeId ? { ...n, data: merged as Record<string, unknown> } : n,
    )
    updateCanvas(canvasId, { nodes: nextNodes2 })
  }, (delay += 300))

  return { hidden_node_id: hiddenNodeId, run_id: runId }
}
