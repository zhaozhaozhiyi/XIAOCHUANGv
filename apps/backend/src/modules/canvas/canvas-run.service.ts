import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import { randomUUID } from 'crypto'

import { DatabaseService } from '../../db/database.service'
import {
  canvases,
  canvasNodes,
  canvasEdges,
  canvasVersions,
  canvasVersionNodes,
  canvasVersionEdges,
  canvasRuns,
  canvasTasks,
} from '../../db/schema'
import { CanvasRunOrchestratorService } from './execution/canvas-run-orchestrator.service'

function now() { return new Date() }
function uid(p: string) { return `${p}_${randomUUID().slice(0, 8)}` }

const EXECUTE_NODE_TYPES = ['text-to-image', 'image-to-video', 'text-to-speech', 'concat', 'export']

@Injectable()
export class CanvasRunService {
  private readonly logger = new Logger(CanvasRunService.name)

  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(CanvasRunOrchestratorService) private readonly orchestrator: CanvasRunOrchestratorService,
  ) {}

  // ═══════════════════════════════════════════════════════════
  // 触发运行
  // ═══════════════════════════════════════════════════════════
  // 前端期望: { code:0, data: { run_id, version_id, total } }

  async triggerRun(canvasId: string, userId: number, versionLabel?: string) {
    const [activeRun] = await this.db.db
      .select()
      .from(canvasRuns)
      .where(and(eq(canvasRuns.canvasId, canvasId), inArray(canvasRuns.status, ['pending', 'running'])))

    if (activeRun) throw new BadRequestException('a run is already in progress')

    const allNodes = await this.db.db
      .select()
      .from(canvasNodes)
      .where(and(eq(canvasNodes.canvasId, canvasId), eq(canvasNodes.isHidden, false)))

    const executableNodes = allNodes.filter((n) => EXECUTE_NODE_TYPES.includes(n.nodeDefId))
    if (executableNodes.length === 0) throw new BadRequestException('no executable nodes on this canvas')

    const versionId = uid('ver')
    const runId = uid('run')

    await this.db.db.insert(canvasVersions).values({
      id: versionId,
      canvasId,
      type: 'run',
      label: versionLabel ?? `Run ${now().toISOString()}`,
      runId,
      nodeCount: executableNodes.length,
      createdAt: now(),
    })

    await this.db.db.insert(canvasRuns).values({
      id: runId,
      canvasId,
      versionId,
      status: 'pending',
      totalNodes: executableNodes.length,
      createdAt: now(),
    })

    for (const node of executableNodes) {
      await this.db.db.insert(canvasTasks).values({
        id: uid('task'),
        runId,
        canvasId,
        nodeId: node.id,
        nodeDefId: node.nodeDefId,
        status: 'pending',
        paramsJson: node.dataJson,
        createdAt: now(),
      })
    }

    await this.db.db.update(canvases).set({ currentVersionId: versionId }).where(eq(canvases.id, canvasId))

    void this.orchestrator.startRun(runId, userId).catch((err) => {
      this.logger.error(`canvas run orchestration failed: ${runId}`, err)
    })

    return { run_id: runId, version_id: versionId, total: executableNodes.length }
  }

  // ═══════════════════════════════════════════════════════════
  // 运行状态
  // ═══════════════════════════════════════════════════════════
  // 前端期望: CanvasRunStatusResponse { canvas_id, version_id, run_id, progress: { current, total, eta_seconds? }, node_states }

  async getRunStatus(canvasId: string) {
    const [run] = await this.db.db
      .select().from(canvasRuns).where(eq(canvasRuns.canvasId, canvasId))
      .orderBy(desc(canvasRuns.createdAt)).limit(1)

    if (!run) return null

    const tasks = await this.db.db
      .select().from(canvasTasks).where(eq(canvasTasks.runId, run.id))
      .orderBy(asc(canvasTasks.createdAt))

    const nodeStates: Record<string, {
      status: string; progress?: number; errorMessage?: string;
      errorCode?: string; outputAssetId?: string;
    }> = {}

    for (const task of tasks) {
      const result = task.resultJson ? JSON.parse(task.resultJson) : null
      const rawStatus = task.status
      const mappedStatus =
        rawStatus === 'queued' || rawStatus === 'pending' ? 'idle'
          : rawStatus === 'running' ? 'running'
            : rawStatus
      nodeStates[task.nodeId] = {
        status: mappedStatus,
        progress: task.progress ?? undefined,
        errorMessage: task.errorMessage ?? undefined,
        errorCode: task.errorCode ?? undefined,
        outputAssetId: result?.assetId ?? undefined,
      }
    }

    const running = run.status === 'pending' || run.status === 'running'
    let state: 'idle' | 'running' | 'completed' | 'failed'
    if (running) state = 'running'
    else if (run.status === 'completed') state = 'completed'
    else if (run.status === 'failed' || run.status === 'partially-failed') state = 'failed'
    else state = 'idle'

    return {
      canvas_id: canvasId,
      version_id: run.versionId,
      run_id: run.id,
      state,
      progress: {
        current: run.completedNodes,
        total: run.totalNodes,
        eta_seconds: running ? 60 : undefined,
      },
      node_states: nodeStates,
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 取消运行
  // ═══════════════════════════════════════════════════════════

  async cancelRun(canvasId: string) {
    const [run] = await this.db.db
      .select().from(canvasRuns)
      .where(and(eq(canvasRuns.canvasId, canvasId), eq(canvasRuns.status, 'running')))

    if (!run) throw new BadRequestException('no active run to cancel')

    await this.db.db.update(canvasRuns).set({ status: 'cancelled', completedAt: now() }).where(eq(canvasRuns.id, run.id))

    const pendingTasks = await this.db.db
      .select()
      .from(canvasTasks)
      .where(and(eq(canvasTasks.runId, run.id), eq(canvasTasks.status, 'pending')))

    for (const task of pendingTasks) {
      await this.db.db
        .update(canvasTasks)
        .set({ status: 'cancelled', completedAt: now() })
        .where(eq(canvasTasks.id, task.id))
    }

    return { cancelled: true, run_id: run.id }
  }

  // ═══════════════════════════════════════════════════════════
  // 版本列表
  // ═══════════════════════════════════════════════════════════

  async listVersions(canvasId: string, type?: string, limit = 20, offset = 0) {
    const conds = [eq(canvasVersions.canvasId, canvasId)]
    if (type) conds.push(eq(canvasVersions.type, type))

    const rows = await this.db.db
      .select().from(canvasVersions).where(and(...conds))
      .orderBy(desc(canvasVersions.createdAt)).limit(limit).offset(offset)

    return { versions: rows.map(toVersionSummary), total: rows.length }
  }

  async getVersionDetail(versionId: string, canvasId: string) {
    const [v] = await this.db.db
      .select().from(canvasVersions)
      .where(and(eq(canvasVersions.id, versionId), eq(canvasVersions.canvasId, canvasId)))
    if (!v) throw new NotFoundException('version_not_found')

    const nodes = await this.db.db.select().from(canvasVersionNodes).where(eq(canvasVersionNodes.versionId, versionId))
    const edges = await this.db.db.select().from(canvasVersionEdges).where(eq(canvasVersionEdges.versionId, versionId))

    return {
      id: v.id, type: v.type, label: v.label,
      nodes: nodes.map((n) => ({ id: n.originalNodeId, type: n.nodeDefId, position: { x: n.positionX, y: n.positionY }, width: n.width, height: n.height, data: JSON.parse(n.dataJson || '{}') })),
      edges: edges.map((e) => ({ id: e.originalEdgeId, source: e.sourceNodeId, target: e.targetNodeId, edge_kind: e.edgeKind, relation_type: e.relationType, source_port: e.sourcePort, target_port: e.targetPort })),
      created_at: v.createdAt?.toISOString(),
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 快照
  // ═══════════════════════════════════════════════════════════

  async createSnapshot(canvasId: string, label: string) {
    const nodes = await this.db.db.select().from(canvasNodes).where(and(eq(canvasNodes.canvasId, canvasId), eq(canvasNodes.isHidden, false)))
    const edges = await this.db.db.select().from(canvasEdges).where(eq(canvasEdges.canvasId, canvasId))

    const vid = uid('snap')
    await this.db.db.insert(canvasVersions).values({ id: vid, canvasId, type: 'manual', label, nodeCount: nodes.length, edgeCount: edges.length, createdAt: now() })

    if (nodes.length > 0) {
      await this.db.db.insert(canvasVersionNodes).values(nodes.map((n) => ({
        id: uid('svn'), versionId: vid, originalNodeId: n.id, nodeDefId: n.nodeDefId,
        label: n.label, dataJson: n.dataJson, positionX: n.positionX, positionY: n.positionY,
        width: n.width, height: n.height, zIndex: n.zIndex, shotIndex: n.shotIndex, createdAt: now(),
      })))
    }
    if (edges.length > 0) {
      await this.db.db.insert(canvasVersionEdges).values(edges.map((e) => ({
        id: uid('sve'), versionId: vid, originalEdgeId: e.id,
        sourceNodeId: e.sourceNodeId, targetNodeId: e.targetNodeId,
        edgeKind: e.edgeKind, relationType: e.relationType, thickness: e.thickness,
        sourcePort: e.sourcePort, targetPort: e.targetPort, label: e.label, createdAt: now(),
      })))
    }

    return { id: vid, type: 'manual', label, node_count: nodes.length, edge_count: edges.length, created_at: now().toISOString() }
  }

  async restoreSnapshot(snapshotId: string, canvasId: string) {
    const [v] = await this.db.db.select().from(canvasVersions).where(and(eq(canvasVersions.id, snapshotId), eq(canvasVersions.canvasId, canvasId), eq(canvasVersions.type, 'manual')))
    if (!v) throw new NotFoundException('snapshot_not_found')

    const nodes = await this.db.db.select().from(canvasVersionNodes).where(eq(canvasVersionNodes.versionId, snapshotId))
    const edges = await this.db.db.select().from(canvasVersionEdges).where(eq(canvasVersionEdges.versionId, snapshotId))

    await this.db.db.transaction(async (tx) => {
      await tx.delete(canvasNodes).where(and(eq(canvasNodes.canvasId, canvasId), eq(canvasNodes.isHidden, false)))
      await tx.delete(canvasEdges).where(eq(canvasEdges.canvasId, canvasId))

      if (nodes.length > 0) {
        await tx.insert(canvasNodes).values(nodes.map((n) => ({
          id: n.originalNodeId, canvasId,
          nodeDefId: n.nodeDefId, label: n.label, dataJson: n.dataJson,
          positionX: n.positionX, positionY: n.positionY, width: n.width, height: n.height,
          zIndex: n.zIndex, shotIndex: n.shotIndex, isHidden: false,
          createdAt: now(), updatedAt: now(),
        })))
      }
      if (edges.length > 0) {
        await tx.insert(canvasEdges).values(edges.map((e) => ({
          id: e.originalEdgeId, canvasId,
          sourceNodeId: e.sourceNodeId, targetNodeId: e.targetNodeId,
          edgeKind: e.edgeKind, relationType: e.relationType, thickness: e.thickness,
          sourcePort: e.sourcePort, targetPort: e.targetPort, label: e.label, createdAt: now(),
        })))
      }
      await tx.update(canvases).set({ updatedAt: now() }).where(eq(canvases.id, canvasId))
    })

    return { restored: true, node_count: nodes.length, edge_count: edges.length }
  }
}

function toVersionSummary(v: typeof canvasVersions.$inferSelect) {
  return {
    id: v.id, canvas_id: v.canvasId, type: v.type,
    label: v.label ?? undefined, run_id: v.runId ?? undefined,
    node_count: v.nodeCount, edge_count: v.edgeCount,
    thumbnail: v.thumbnail ?? undefined, created_at: v.createdAt?.toISOString(),
  }
}
