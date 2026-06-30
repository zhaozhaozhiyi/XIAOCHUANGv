/** 执行计划节点 */
export interface ExecutionNode {
  taskId: string
  nodeId: string
  nodeDefId: string
  params: Record<string, unknown>
  dependsOn: string[]
}

/** 执行阶段（同阶段内可并行） */
export interface ExecutionStage {
  order: number
  tasks: ExecutionNode[]
}

/** 完整执行计划 */
export interface ExecutionPlan {
  runId: string
  canvasId: string
  versionId: string
  stages: ExecutionStage[]
  totalNodes: number
}
