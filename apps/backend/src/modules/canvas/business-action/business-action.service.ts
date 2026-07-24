import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common'
import { and, eq, inArray } from 'drizzle-orm'
import { randomUUID } from 'crypto'

import { DatabaseService } from '../../../db/database.service'
import { canvasNodes, canvasEdges, canvasRuns, canvasVersions, canvasTasks } from '../../../db/schema'
import {
  AUDIO_RESULT_NODE_TYPES,
  IMAGE_RESULT_NODE_TYPES,
  TEXT_RESULT_NODE_TYPES,
  VIDEO_RESULT_NODE_TYPES,
  isValidCanvasNodeType,
} from '../canvas-node-types'
import { CanvasRunOrchestratorService } from '../execution/canvas-run-orchestrator.service'

function now() { return new Date() }
function uid(p: string) { return `${p}_${randomUUID().slice(0, 8)}` }

// 识别 canvas_runs 部分唯一索引抛出的唯一约束冲突，转成 'a run is already in progress'。
function isCanvasRunActiveViolation(error: unknown): boolean {
  const e = error as { code?: string; constraint?: string; constraint_name?: string } | null
  return !!e && e.code === '23505' && (
    String(e.constraint || '').includes('canvas_runs_active_unique') ||
    String(e.constraint_name || '').includes('canvas_runs_active_unique')
  )
}

type ExecuteNodeDefId = 'text-to-image' | 'image-to-video' | 'text-to-speech' | 'concat' | 'export'

type BusinessActionDef = {
  executeNodeDefId: ExecuteNodeDefId
  module: string
  method: string
  outputKind: 'image' | 'video' | 'audio'
  defaultTargetNodeType: string
}

type SourceMedia = {
  imageRefs: string[]
  videoRefs: string[]
  audioRefs: string[]
  text?: string
}

const IMAGE_ACTION: BusinessActionDef = {
  executeNodeDefId: 'text-to-image',
  module: 'images',
  method: 'generate',
  outputKind: 'image',
  defaultTargetNodeType: 'image',
}

const VIDEO_ACTION: BusinessActionDef = {
  executeNodeDefId: 'image-to-video',
  module: 'videos',
  method: 'generate',
  outputKind: 'video',
  defaultTargetNodeType: 'video-asset',
}

const AUDIO_ACTION: BusinessActionDef = {
  executeNodeDefId: 'text-to-speech',
  module: 'audio',
  method: 'synthesize',
  outputKind: 'audio',
  defaultTargetNodeType: 'audio',
}

const COMPOSE_ACTION: BusinessActionDef = {
  executeNodeDefId: 'concat',
  module: 'compose',
  method: 'concat',
  outputKind: 'video',
  defaultTargetNodeType: 'videoComposeNode',
}

const BUSINESS_ACTION_MAP: Record<string, BusinessActionDef> = {
  '构想画面': IMAGE_ACTION,
  '改画面': IMAGE_ACTION,
  '换装': IMAGE_ACTION,
  '换表情': IMAGE_ACTION,
  '换时段': IMAGE_ACTION,
  '换天气': IMAGE_ACTION,
  '生成': IMAGE_ACTION,
  '图片生成': IMAGE_ACTION,
  '生成图片': IMAGE_ACTION,
  '图片编辑': IMAGE_ACTION,
  '导出图': IMAGE_ACTION,
  '生成分镜': IMAGE_ACTION,
  '分镜生成': IMAGE_ACTION,
  '生成全景': IMAGE_ACTION,
  '360 全景': IMAGE_ACTION,
  '整理脚本': IMAGE_ACTION,
  '执行技能': IMAGE_ACTION,
  '生成镜头视频': VIDEO_ACTION,
  '生成视频': VIDEO_ACTION,
  '视频生成': VIDEO_ACTION,
  '文生视频': VIDEO_ACTION,
  '图生视频': VIDEO_ACTION,
  '生成故事': VIDEO_ACTION,
  '视频故事': VIDEO_ACTION,
  '合成': COMPOSE_ACTION,
  '视频合成': COMPOSE_ACTION,
  '配音': AUDIO_ACTION,
  '生成音频': AUDIO_ACTION,
  '音频生成': AUDIO_ACTION,
  '生成配音': AUDIO_ACTION,
  '生成音乐': AUDIO_ACTION,
}

const TARGET_INPUT_PORT: Record<string, string> = {
  'text-to-image': 'in:image',
  'image-to-video': 'in:video',
  'text-to-speech': 'in:audio',
  concat: 'in:video',
  export: 'in:video',
}

const OUTPUT_PORT: Record<string, string> = {
  'text-to-image': 'image',
  'image-to-video': 'video',
  'text-to-speech': 'audio',
  concat: 'video',
  export: 'video',
}

function asString(value: unknown, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    const text = asString(value)
    if (text) return text
  }
  return ''
}

function pushUnique(target: string[], value: unknown) {
  const text = asString(value)
  if (text && !target.includes(text)) target.push(text)
}

function collectFromArray(target: string[], value: unknown, keys: string[]) {
  if (!Array.isArray(value)) return
  for (const item of value) {
    if (typeof item === 'string') {
      pushUnique(target, item)
      continue
    }
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    for (const key of keys) pushUnique(target, record[key])
  }
}

function collectSourceMedia(nodeDefId: string | undefined, data: Record<string, unknown>): SourceMedia {
  const imageRefs: string[] = []
  const videoRefs: string[] = []
  const audioRefs: string[] = []

  for (const key of ['imageUrl', 'previewImageUrl', 'image', 'avatar', 'thumbnailUrl', 'thumbnail_url']) {
    pushUnique(imageRefs, data[key])
  }
  collectFromArray(imageRefs, data.images, ['url', 'imageUrl', 'previewImageUrl'])
  collectFromArray(imageRefs, data.generationBatch, ['url', 'imageUrl', 'previewImageUrl'])
  collectFromArray(imageRefs, data.frames, ['imageUrl', 'url', 'previewImageUrl'])

  for (const key of ['videoUrl', 'resultVideoUrl', 'video']) pushUnique(videoRefs, data[key])
  collectFromArray(videoRefs, data.videos, ['videoUrl', 'url'])
  collectFromArray(videoRefs, data.clips, ['videoUrl', 'resultVideoUrl', 'url'])

  for (const key of ['audioUrl', 'audio']) pushUnique(audioRefs, data[key])

  if (nodeDefId === 'audio' || nodeDefId === 'audioNode') pushUnique(audioRefs, data.url)
  else if (nodeDefId === 'video-asset' || nodeDefId === 'videoNode' || nodeDefId === 'videoStoryNode' || nodeDefId === 'videoComposeNode') {
    pushUnique(videoRefs, data.url)
  } else {
    pushUnique(imageRefs, data.url)
  }

  return {
    imageRefs,
    videoRefs,
    audioRefs,
    text: firstString(data.prompt, data.content, data.text, data.summary, data.shotDescription, data.description, data.title),
  }
}

function resolveActionForSource(action: BusinessActionDef, sourceMedia: SourceMedia): BusinessActionDef {
  if (action.executeNodeDefId === 'concat' && sourceMedia.videoRefs.length === 0) {
    return VIDEO_ACTION
  }
  return action
}

function sourceReference(sourceNode: typeof canvasNodes.$inferSelect | null) {
  return sourceNode
    ? [{
        node_id: sourceNode.id,
        node_type: sourceNode.nodeDefId,
        label: sourceNode.label || sourceNode.id,
      }]
    : []
}

function buildTargetNodeData(args: {
  targetNodeType: string
  targetLabel: string
  actionLabel: string
  executeData: Record<string, unknown>
  sourceNode: typeof canvasNodes.$inferSelect | null
}) {
  const prompt = asString(args.executeData.prompt)
  const startedAt = Date.now()
  const references = sourceReference(args.sourceNode)
  const base = {
    label: args.targetLabel,
    title: args.targetLabel,
    displayName: args.targetLabel,
    prompt,
    actionLabel: args.actionLabel,
    references,
    status: 'generating',
    isGenerating: true,
    generationStartedAt: startedAt,
    generationDurationMs: null,
    generationError: null,
    results: [],
  }

  if (args.targetNodeType === 'storyboardNode' || args.targetNodeType === 'storyboardGenNode') {
    return {
      ...base,
      imageUrl: null,
      previewImageUrl: null,
      frames: [],
      gridRows: 2,
      gridCols: 2,
      aspectRatio: '1:1',
      generationBatch: [],
    }
  }

  if (IMAGE_RESULT_NODE_TYPES.has(args.targetNodeType)) {
    return {
      ...base,
      imageUrl: null,
      previewImageUrl: null,
      aspectRatio: args.targetNodeType === 'pano360ViewerNode' ? '2:1' : '1:1',
      generationBatch: [],
    }
  }

  if (VIDEO_RESULT_NODE_TYPES.has(args.targetNodeType)) {
    const videoUrls = Array.isArray(args.executeData.videoUrls)
      ? args.executeData.videoUrls.filter((item): item is string => typeof item === 'string')
      : []
    return {
      ...base,
      videoUrl: null,
      resultVideoUrl: null,
      previewImageUrl: null,
      genMode: videoUrls.length ? 'compose' : 'textToVideo',
      durationSec: 5,
      quality: '720P',
      resolution: '1080p',
      clips: videoUrls.map((url) => ({ url })),
    }
  }

  if (AUDIO_RESULT_NODE_TYPES.has(args.targetNodeType)) {
    return {
      ...base,
      audioUrl: null,
      url: null,
      text: prompt,
      audioKind: 'voice',
    }
  }

  if (TEXT_RESULT_NODE_TYPES.has(args.targetNodeType)) {
    return {
      ...base,
      content: prompt,
      text: prompt,
    }
  }

  return base
}

@Injectable()
export class BusinessActionService {
  private readonly logger = new Logger(BusinessActionService.name)

  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(CanvasRunOrchestratorService) private readonly orchestrator: CanvasRunOrchestratorService,
  ) {}

  async triggerAction(
    canvasId: string,
    userId: number,
    input: {
      sourceNodeId?: string
      actionLabel: string
      userInput?: string
      renderedPrompt?: string
      outputMode?: 'current_node' | 'insert_new_node'
      positionX?: number
      positionY?: number
      targetNodeType?: string
    },
  ) {
    const baseAction = BUSINESS_ACTION_MAP[input.actionLabel]
    if (!baseAction) throw new BadRequestException(`unknown business action: ${input.actionLabel}`)

    const [sourceNode] = input.sourceNodeId
      ? await this.db.db.select().from(canvasNodes)
        .where(and(eq(canvasNodes.id, input.sourceNodeId), eq(canvasNodes.canvasId, canvasId)))
      : [null]
    if (input.sourceNodeId && !sourceNode) throw new BadRequestException('source_node_not_found')

    const sourceData = sourceNode ? JSON.parse(sourceNode.dataJson || '{}') as Record<string, unknown> : {}
    const sourceMedia = collectSourceMedia(sourceNode?.nodeDefId, sourceData)
    const action = resolveActionForSource(baseAction, sourceMedia)
    const executeData: Record<string, unknown> = {
      prompt: input.renderedPrompt || input.userInput || sourceMedia.text || '',
      userInput: input.userInput || '',
      actionLabel: input.actionLabel,
      outputKind: action.outputKind,
    }
    if (sourceMedia.imageRefs.length) executeData.references = sourceMedia.imageRefs
    if (sourceMedia.videoRefs.length) executeData.videoUrls = sourceMedia.videoRefs
    if (sourceMedia.audioRefs.length) executeData.audioUrl = sourceMedia.audioRefs[0]

    if (sourceNode?.nodeDefId === 'character') {
      executeData.characterName = sourceNode.label || sourceData.name
    }
    if (sourceNode?.nodeDefId === 'scene') {
      executeData.sceneName = sourceNode.label || sourceData.name
    }

    const insertNewNode = input.outputMode === 'insert_new_node' || !sourceNode
    const targetNodeId = insertNewNode ? uid('node') : sourceNode!.id
    const targetNodeType = input.targetNodeType || action.defaultTargetNodeType
    if (!isValidCanvasNodeType(targetNodeType)) throw new BadRequestException(`unknown target node type: ${targetNodeType}`)

    const targetX = Number.isFinite(input.positionX) ? Number(input.positionX) : ((sourceNode?.positionX ?? 120) + 300)
    const targetY = Number.isFinite(input.positionY) ? Number(input.positionY) : (sourceNode?.positionY ?? 120)

    const targetLabel = firstString(input.userInput)?.slice(0, 40) || `[${input.actionLabel}] 结果`
    const targetData = buildTargetNodeData({
      targetNodeType,
      targetLabel,
      actionLabel: input.actionLabel,
      executeData,
      sourceNode,
    })

    // 一画布一活跃 run：business-action 也受部分唯一索引约束，先做活跃 run 检查给出友好错误。
    const [activeRun] = await this.db.db
      .select()
      .from(canvasRuns)
      .where(and(eq(canvasRuns.canvasId, canvasId), inArray(canvasRuns.status, ['pending', 'running'])))
    if (activeRun) throw new BadRequestException('a run is already in progress')

    const hiddenNodeId = uid('node')
    const versionId = uid('ver')
    const runId = uid('run')
    const taskId = uid('task')
    const outPort = OUTPUT_PORT[action.executeNodeDefId] ?? 'text'
    const inPort = TARGET_INPUT_PORT[action.executeNodeDefId] ?? 'in:image'

    // 全部插入放一个事务：并发 run 撞唯一索引时整体回滚，不留孤儿 node/edge/version/task。
    try {
      await this.db.db.transaction(async (tx) => {
        if (insertNewNode) {
          await tx.insert(canvasNodes).values({
            id: targetNodeId,
            canvasId,
            nodeDefId: targetNodeType,
            label: targetLabel,
            dataJson: JSON.stringify(targetData),
            positionX: targetX,
            positionY: targetY,
            isHidden: false,
            createdAt: now(),
            updatedAt: now(),
          })
        }

        await tx.insert(canvasNodes).values({
          id: hiddenNodeId, canvasId,
          nodeDefId: action.executeNodeDefId,
          label: `[${input.actionLabel}]`,
          dataJson: JSON.stringify(executeData),
          positionX: targetX + 300, positionY: targetY,
          isHidden: true, createdAt: now(), updatedAt: now(),
        })

        await tx.insert(canvasEdges).values({
          id: uid('edge'), canvasId,
          sourceNodeId: hiddenNodeId, targetNodeId,
          edgeKind: 'dataflow', sourcePort: `out:${outPort}`, targetPort: inPort, createdAt: now(),
        })

        await tx.insert(canvasVersions).values({
          id: versionId, canvasId, type: 'run', label: `BA: ${input.actionLabel}`, runId, nodeCount: 1, createdAt: now(),
        })
        await tx.insert(canvasRuns).values({
          id: runId, canvasId, versionId, status: 'pending', totalNodes: 1, createdAt: now(),
        })
        await tx.insert(canvasTasks).values({
          id: taskId, runId, canvasId, nodeId: hiddenNodeId, nodeDefId: action.executeNodeDefId,
          status: 'pending', paramsJson: JSON.stringify(executeData), createdAt: now(),
        })
      })
    } catch (error) {
      if (isCanvasRunActiveViolation(error)) {
        throw new BadRequestException('a run is already in progress')
      }
      throw error
    }

    void this.orchestrator.startRun(runId, userId).catch((err) => {
      this.logger.error(`business action orchestration failed: ${runId}`, err)
    })

    return {
      hidden_node_id: hiddenNodeId,
      run_id: runId,
      task_id: taskId,
      node: insertNewNode ? {
        id: targetNodeId,
        type: targetNodeType,
        position: { x: targetX, y: targetY },
        data: targetData,
      } : null,
    }
  }
}
