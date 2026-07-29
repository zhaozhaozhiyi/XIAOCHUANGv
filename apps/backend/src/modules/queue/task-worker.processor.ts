import { UnrecoverableError, type Job } from 'bullmq'

import { CanvasExecutionService } from '../canvas/execution/canvas-execution.service'
import { CanvasRunOrchestratorService } from '../canvas/execution/canvas-run-orchestrator.service'
import { TaskExecutionService } from '../tasks/task-execution.service'
import {
  CANVAS_TASK_JOB_NAME,
  DRAMA_TASK_JOB_NAME,
  isCanvasQueueJob,
  logTaskQueueEvent,
  serializeQueueError,
  TASK_QUEUE_DEFAULT_JOB_OPTIONS,
  TASK_QUEUE_NAME,
  type BackendQueueJobData,
} from './task-queue.shared'

export type TaskWorkerProcessorDeps = {
  workerId: string
  dramaExecutor: Pick<TaskExecutionService, 'executeTaskById'>
  canvasExecutor: Pick<CanvasExecutionService, 'executeCanvasTaskById'>
  canvasOrchestrator: Pick<CanvasRunOrchestratorService, 'onTaskSettled'>
}

export function jobLogContext(job: Job<BackendQueueJobData> | undefined) {
  if (!job) {
    return {
      job_id: null,
      job_name: null,
      job_data: null,
      attempts_made: null,
      attempts_started: null,
      attempts_configured: TASK_QUEUE_DEFAULT_JOB_OPTIONS.attempts,
    }
  }

  return {
    job_id: job.id ?? null,
    job_name: job.name,
    job_data: job.data,
    attempts_made: job.attemptsMade,
    attempts_started: job.attemptsStarted,
    attempts_configured: job.opts.attempts ?? TASK_QUEUE_DEFAULT_JOB_OPTIONS.attempts,
  }
}

function isTerminalFailureResult(result: unknown) {
  return result === 'terminal:failed' || result === 'terminal:dead_letter'
}

export async function processBackendQueueJob(
  job: Job<BackendQueueJobData>,
  deps: TaskWorkerProcessorDeps,
) {
  logTaskQueueEvent('info', {
    event: 'job.processing',
    component: 'task-worker',
    queue: TASK_QUEUE_NAME,
    worker_id: deps.workerId,
    ...jobLogContext(job),
  })

  try {
    if (job.name === CANVAS_TASK_JOB_NAME || isCanvasQueueJob(job.data)) {
      const data = job.data as { canvasTaskId: string; userId: number }
      const result = await deps.canvasExecutor.executeCanvasTaskById(
        data.canvasTaskId,
        data.userId,
        `${deps.workerId}:${job.id}`,
      )
      await deps.canvasOrchestrator.onTaskSettled(data.canvasTaskId)
      return result
    }

    if (job.name === DRAMA_TASK_JOB_NAME || 'taskId' in job.data) {
      const configuredAttempts = Math.max(
        1,
        Number(job.opts.attempts ?? TASK_QUEUE_DEFAULT_JOB_OPTIONS.attempts) || 1,
      )
      const retryOnFailure = (job.attemptsMade ?? 0) + 1 < configuredAttempts
      const result = await deps.dramaExecutor.executeTaskById(
        (job.data as { taskId: number }).taskId,
        `${deps.workerId}:${job.id}`,
        { retryOnFailure },
      )
      if (isTerminalFailureResult(result)) throw new UnrecoverableError(result)
      return result
    }

    throw new UnrecoverableError(`unknown job: ${job.name}`)
  } catch (error) {
    logTaskQueueEvent('error', {
      event: 'job.processor_error',
      component: 'task-worker',
      queue: TASK_QUEUE_NAME,
      worker_id: deps.workerId,
      ...jobLogContext(job),
      error: serializeQueueError(error),
    })
    throw error
  }
}
