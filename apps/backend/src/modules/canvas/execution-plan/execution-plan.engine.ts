import { BadRequestException, Injectable } from '@nestjs/common'
import type { ExecutionNode, ExecutionPlan, ExecutionStage } from './execution-plan.types'

const EXECUTE_NODE_OUTPUTS: Record<string, string[]> = {
  'text-to-image': ['image'],
  'image-to-video': ['video'],
  'text-to-speech': ['audio'],
  concat: ['video'],
  export: [],
}

@Injectable()
export class ExecutionPlanEngine {
  buildPlan(
    executeNodes: Array<{ nodeId: string; nodeDefId: string; data: Record<string, unknown> }>,
    allNodes: Array<{ id: string; nodeDefId: string; data: Record<string, unknown> }>,
    dataflowEdges: Array<{ sourceNodeId: string; targetNodeId: string; sourcePort?: string | null; targetPort?: string | null }>,
    tasks: Array<{ id: string; nodeId: string; nodeDefId: string }>,
  ): ExecutionPlan {
    const execMap = new Map<string, ExecutionNode>()
    const nodeToTask = new Map<string, string>()

    for (const t of tasks) {
      const en = executeNodes.find((n) => n.nodeId === t.nodeId)
      if (!en) continue
      execMap.set(t.nodeId, { taskId: t.id, nodeId: t.nodeId, nodeDefId: t.nodeDefId, params: en.data, dependsOn: [] })
      nodeToTask.set(t.nodeId, t.id)
    }

    // dataflow deps
    for (const e of dataflowEdges) {
      const target = execMap.get(e.targetNodeId)
      if (!target) continue
      const providers = dataflowEdges.filter((pe) => pe.targetNodeId === e.sourceNodeId)
      for (const pe of providers) {
        const pid = nodeToTask.get(pe.sourceNodeId)
        if (pid && !target.dependsOn.includes(pid)) target.dependsOn.push(pid)
      }
    }

    // natural deps
    for (const [, node] of execMap) {
      const requiredInputs = this.getRequiredInputs(node.nodeDefId)
      for (const [, other] of execMap) {
        if (other.nodeId === node.nodeId) continue
        const outputs = EXECUTE_NODE_OUTPUTS[other.nodeDefId] ?? []
        if (requiredInputs.some((ri) => outputs.includes(ri)) && !node.dependsOn.includes(other.taskId)) {
          node.dependsOn.push(other.taskId)
        }
      }
    }

    const stages = this.topologicalSort(execMap)
    return { runId: '', canvasId: '', versionId: '', stages, totalNodes: execMap.size }
  }

  private getRequiredInputs(nodeDefId: string): string[] {
    const m: Record<string, string[]> = {
      'text-to-image': [], 'image-to-video': ['image'], 'text-to-speech': ['character'],
      concat: ['video'], export: ['video'],
    }
    return m[nodeDefId] ?? []
  }

  private topologicalSort(nodeMap: Map<string, ExecutionNode>): ExecutionStage[] {
    const nodes = Array.from(nodeMap.values())
    const inDeg = new Map<string, number>()
    const adj = new Map<string, string[]>()

    for (const n of nodes) { inDeg.set(n.taskId, n.dependsOn.length); adj.set(n.taskId, []) }
    for (const n of nodes) for (const d of n.dependsOn) adj.get(d)?.push(n.taskId)

    const stages: ExecutionStage[] = []
    const visited = new Set<string>()
    let order = 0

    while (visited.size < nodes.length) {
      const stage: ExecutionNode[] = []
      for (const n of nodes) {
        if (visited.has(n.taskId)) continue
        if ((inDeg.get(n.taskId) ?? 0) === 0) { stage.push(n); visited.add(n.taskId) }
      }
      if (stage.length === 0) {
        const remaining = nodes.filter((n) => !visited.has(n.taskId)).map((n) => n.nodeDefId)
        throw new BadRequestException(`circular dependency: ${remaining.join(' → ')}`)
      }
      stages.push({ order: order++, tasks: [...stage] })
      for (const t of stage) for (const nb of adj.get(t.taskId) ?? []) inDeg.set(nb, (inDeg.get(nb) ?? 1) - 1)
    }
    return stages
  }
}
