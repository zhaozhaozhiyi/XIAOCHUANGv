import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common'
import { and, eq } from 'drizzle-orm'
import { randomUUID } from 'crypto'

import { DatabaseService } from '../../../db/database.service'
import { canvasNodes, canvasEdges, canvasRuns, canvasVersions, canvasTasks } from '../../../db/schema'
import { CanvasRunOrchestratorService } from '../execution/canvas-run-orchestrator.service'

function now() { return new Date() }
function uid(p: string) { return `${p}_${randomUUID().slice(0, 8)}` }

const BUSINESS_ACTION_MAP: Record<string, { executeNodeDefId: string; module: string; method: string }> = {
  '构想画面': { executeNodeDefId: 'text-to-image', module: 'images', method: 'generate' },
  '改画面': { executeNodeDefId: 'text-to-image', module: 'images', method: 'generate' },
  '换装': { executeNodeDefId: 'text-to-image', module: 'images', method: 'generate' },
  '换表情': { executeNodeDefId: 'text-to-image', module: 'images', method: 'generate' },
  '换时段': { executeNodeDefId: 'text-to-image', module: 'images', method: 'generate' },
  '换天气': { executeNodeDefId: 'text-to-image', module: 'images', method: 'generate' },
  '生成镜头视频': { executeNodeDefId: 'image-to-video', module: 'videos', method: 'generate' },
  '配音': { executeNodeDefId: 'text-to-speech', module: 'audio', method: 'synthesize' },
}

const TARGET_INPUT_PORT: Record<string, string> = {
  'text-to-image': 'in:image',
  'image-to-video': 'in:video',
  'text-to-speech': 'in:audio',
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
    const action = BUSINESS_ACTION_MAP[input.actionLabel]
    if (!action) throw new BadRequestException(`unknown business action: ${input.actionLabel}`)

    const [sourceNode] = input.sourceNodeId
      ? await this.db.db.select().from(canvasNodes)
        .where(and(eq(canvasNodes.id, input.sourceNodeId), eq(canvasNodes.canvasId, canvasId)))
      : [null]
    if (input.sourceNodeId && !sourceNode) throw new BadRequestException('source_node_not_found')

    const sourceData = sourceNode ? JSON.parse(sourceNode.dataJson || '{}') as Record<string, unknown> : {}
    const executeData: Record<string, unknown> = {
      prompt: input.renderedPrompt || input.userInput || '',
      userInput: input.userInput || '',
      actionLabel: input.actionLabel,
    }
    if (sourceNode?.nodeDefId === 'character') {
      executeData.characterName = sourceNode.label || sourceData.name
      const images = Array.isArray(sourceData.images) ? sourceData.images as string[] : []
      executeData.references = sourceData.avatar ? [sourceData.avatar as string] : (images[0] ? [images[0]] : [])
    }
    if (sourceNode?.nodeDefId === 'scene') {
      executeData.sceneName = sourceNode.label || sourceData.name
      const images = Array.isArray(sourceData.images) ? sourceData.images as string[] : []
      executeData.references = sourceData.image ? [sourceData.image as string] : (images[0] ? [images[0]] : [])
    }
    if (sourceNode?.nodeDefId === 'storyboard') {
      const images = Array.isArray(sourceData.images) ? sourceData.images as string[] : []
      executeData.references = images[0] ? [images[0]] : []
    }

    const insertNewNode = input.outputMode === 'insert_new_node' || !sourceNode
    const targetNodeId = insertNewNode ? uid('node') : sourceNode!.id
    const targetNodeType = input.targetNodeType || {
      'text-to-image': 'image',
      'image-to-video': 'video-asset',
      'text-to-speech': 'audio',
    }[action.executeNodeDefId] || 'image'
    const targetX = Number.isFinite(input.positionX) ? Number(input.positionX) : ((sourceNode?.positionX ?? 120) + 300)
    const targetY = Number.isFinite(input.positionY) ? Number(input.positionY) : (sourceNode?.positionY ?? 120)

    if (insertNewNode) {
      await this.db.db.insert(canvasNodes).values({
        id: targetNodeId,
        canvasId,
        nodeDefId: targetNodeType,
        label: input.userInput?.slice(0, 40) || `[${input.actionLabel}] 结果`,
        dataJson: JSON.stringify({
          prompt: executeData.prompt,
          references: sourceNode ? [{ node_id: sourceNode.id, node_type: sourceNode.nodeDefId }] : [],
          status: 'generating',
        }),
        positionX: targetX,
        positionY: targetY,
        isHidden: false,
        createdAt: now(),
        updatedAt: now(),
      })
    }

    const hiddenNodeId = uid('node')
    await this.db.db.insert(canvasNodes).values({
      id: hiddenNodeId, canvasId,
      nodeDefId: action.executeNodeDefId,
      label: `[${input.actionLabel}]`,
      dataJson: JSON.stringify(executeData),
      positionX: targetX + 300, positionY: targetY,
      isHidden: true, createdAt: now(), updatedAt: now(),
    })

    const outPort = { 'text-to-image': 'image', 'image-to-video': 'video', 'text-to-speech': 'audio' }[action.executeNodeDefId] ?? 'text'
    const inPort = TARGET_INPUT_PORT[action.executeNodeDefId] ?? 'in:image'
    await this.db.db.insert(canvasEdges).values({
      id: uid('edge'), canvasId,
      sourceNodeId: hiddenNodeId, targetNodeId,
      edgeKind: 'dataflow', sourcePort: `out:${outPort}`, targetPort: inPort, createdAt: now(),
    })

    const versionId = uid('ver')
    const runId = uid('run')
    const taskId = uid('task')

    await this.db.db.insert(canvasVersions).values({
      id: versionId, canvasId, type: 'run', label: `BA: ${input.actionLabel}`, runId, nodeCount: 1, createdAt: now(),
    })
    await this.db.db.insert(canvasRuns).values({
      id: runId, canvasId, versionId, status: 'pending', totalNodes: 1, createdAt: now(),
    })
    await this.db.db.insert(canvasTasks).values({
      id: taskId, runId, canvasId, nodeId: hiddenNodeId, nodeDefId: action.executeNodeDefId,
      status: 'pending', paramsJson: JSON.stringify(executeData), createdAt: now(),
    })

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
        data: {
          prompt: executeData.prompt,
          references: sourceNode ? [{ node_id: sourceNode.id, node_type: sourceNode.nodeDefId }] : [],
          status: 'generating',
        },
      } : null,
    }
  }
}
