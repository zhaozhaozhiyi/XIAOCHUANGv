import 'reflect-metadata'

import { ConfigService } from '@nestjs/config'
import { NestFactory } from '@nestjs/core'
import { Worker } from 'bullmq'

import { AppModule } from './app.module'
import {
  createTaskQueueConnection,
  logTaskQueueEvent,
  redactRedisUrl,
  serializeQueueError,
  TASK_QUEUE_DEFAULT_JOB_OPTIONS,
  TASK_QUEUE_NAME,
  writeTaskQueueReadinessFile,
  type BackendQueueJobData,
} from './modules/queue/task-queue.shared'
import { jobLogContext, processBackendQueueJob } from './modules/queue/task-worker.processor'
import { CanvasExecutionService } from './modules/canvas/execution/canvas-execution.service'
import { CanvasRunOrchestratorService } from './modules/canvas/execution/canvas-run-orchestrator.service'
import { TaskExecutionService } from './modules/tasks/task-execution.service'

type WorkerOptions = {
  concurrency: number
  readyFile?: string
}

function getArgValue(flag: string) {
  const prefix = `${flag}=`
  return process.argv.slice(2).find((arg) => arg.startsWith(prefix))?.slice(prefix.length)
}

function parseArgs(): WorkerOptions {
  const value = getArgValue('--concurrency')
  const parsed = Number(value)
  const readyFile = getArgValue('--ready-file') || process.env.TASK_WORKER_READY_FILE || process.env.WORKER_READY_FILE || undefined

  return {
    concurrency: Number.isFinite(parsed) && parsed > 0 ? parsed : 2,
    readyFile,
  }
}

async function main() {
  const options = parseArgs()
  logTaskQueueEvent('info', {
    event: 'worker.starting',
    component: 'task-worker',
    queue: TASK_QUEUE_NAME,
    pid: process.pid,
    concurrency: options.concurrency,
    ready_file: options.readyFile ?? null,
  })

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false })
  const configService = app.get(ConfigService)
  const dramaExecutor = app.get(TaskExecutionService)
  const canvasExecutor = app.get(CanvasExecutionService)
  const canvasOrchestrator = app.get(CanvasRunOrchestratorService)
  const redisUrl = configService.getOrThrow<string>('REDIS_URL')
  const connection = createTaskQueueConnection(redisUrl, 'worker')
  const workerId = `bullmq-${process.pid}-${Math.random().toString(36).slice(2, 8)}`

  const updateReadiness = async (status: 'starting' | 'ready' | 'shutting_down' | 'stopped', extra: Record<string, unknown> = {}) => {
    try {
      await writeTaskQueueReadinessFile(options.readyFile, {
        status,
        component: 'task-worker',
        queue: TASK_QUEUE_NAME,
        worker_id: workerId,
        pid: process.pid,
        ...extra,
      })
    } catch (error) {
      logTaskQueueEvent('warn', {
        event: 'worker.readiness_write_failed',
        component: 'task-worker',
        queue: TASK_QUEUE_NAME,
        worker_id: workerId,
        error: serializeQueueError(error),
      })
    }
  }

  await updateReadiness('starting', { concurrency: options.concurrency })

  const worker = new Worker<BackendQueueJobData>(
    TASK_QUEUE_NAME,
    async (job) => processBackendQueueJob(job, {
      workerId,
      dramaExecutor,
      canvasExecutor,
      canvasOrchestrator,
    }),
    {
      connection,
      concurrency: options.concurrency,
    },
  )

  worker.on('active', (job, prev) => {
    logTaskQueueEvent('info', {
      event: 'job.active',
      component: 'task-worker',
      queue: TASK_QUEUE_NAME,
      worker_id: workerId,
      previous_state: prev,
      ...jobLogContext(job),
    })
  })

  worker.on('completed', (job, result, prev) => {
    logTaskQueueEvent('info', {
      event: 'job.completed',
      component: 'task-worker',
      queue: TASK_QUEUE_NAME,
      worker_id: workerId,
      previous_state: prev,
      ...jobLogContext(job),
      result,
    })
  })

  worker.on('failed', (job, error, prev) => {
    const attemptsConfigured = job?.opts.attempts ?? TASK_QUEUE_DEFAULT_JOB_OPTIONS.attempts ?? 1
    const attemptsMade = job?.attemptsMade ?? null
    const willRetry = !!job && error.name !== 'UnrecoverableError' && job.attemptsMade < attemptsConfigured

    logTaskQueueEvent('error', {
      event: 'job.failed',
      component: 'task-worker',
      queue: TASK_QUEUE_NAME,
      worker_id: workerId,
      previous_state: prev,
      ...jobLogContext(job),
      attempts_made: attemptsMade,
      attempts_configured: attemptsConfigured,
      will_retry: willRetry,
      error: serializeQueueError(error),
    })
  })

  worker.on('stalled', (jobId, prev) => {
    logTaskQueueEvent('warn', {
      event: 'job.stalled',
      component: 'task-worker',
      queue: TASK_QUEUE_NAME,
      worker_id: workerId,
      job_id: jobId,
      previous_state: prev,
    })
  })

  worker.on('drained', () => {
    logTaskQueueEvent('info', {
      event: 'queue.drained',
      component: 'task-worker',
      queue: TASK_QUEUE_NAME,
      worker_id: workerId,
    })
  })

  worker.on('error', (error) => {
    logTaskQueueEvent('error', {
      event: 'worker.error',
      component: 'task-worker',
      queue: TASK_QUEUE_NAME,
      worker_id: workerId,
      error: serializeQueueError(error),
    })
  })

  worker.on('lockRenewalFailed', (jobIds) => {
    logTaskQueueEvent('warn', {
      event: 'worker.lock_renewal_failed',
      component: 'task-worker',
      queue: TASK_QUEUE_NAME,
      worker_id: workerId,
      job_ids: jobIds,
    })
  })

  worker.on('closed', () => {
    logTaskQueueEvent('info', {
      event: 'worker.closed',
      component: 'task-worker',
      queue: TASK_QUEUE_NAME,
      worker_id: workerId,
    })
  })

  await worker.waitUntilReady()
  await updateReadiness('ready', {
    concurrency: options.concurrency,
    redis_url: redactRedisUrl(redisUrl),
  })
  logTaskQueueEvent('info', {
    event: 'worker.ready',
    component: 'task-worker',
    queue: TASK_QUEUE_NAME,
    worker_id: workerId,
    pid: process.pid,
    concurrency: options.concurrency,
    redis_url: redactRedisUrl(redisUrl),
    ready_file: options.readyFile ?? null,
  })

  let shuttingDown = false
  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return
    shuttingDown = true
    logTaskQueueEvent('info', {
      event: 'worker.shutdown_requested',
      component: 'task-worker',
      queue: TASK_QUEUE_NAME,
      worker_id: workerId,
      signal,
    })
    await updateReadiness('shutting_down', { signal })
    await worker.close().catch((error) => {
      logTaskQueueEvent('error', {
        event: 'worker.close_failed',
        component: 'task-worker',
        queue: TASK_QUEUE_NAME,
        worker_id: workerId,
        error: serializeQueueError(error),
      })
    })
    await app.close()
    await updateReadiness('stopped', { signal })
  }

  process.once('SIGINT', () => {
    void shutdown('SIGINT').finally(() => process.exit(0))
  })
  process.once('SIGTERM', () => {
    void shutdown('SIGTERM').finally(() => process.exit(0))
  })
}

void main().catch((error) => {
  logTaskQueueEvent('error', {
    event: 'worker.fatal',
    component: 'task-worker',
    queue: TASK_QUEUE_NAME,
    pid: process.pid,
    error: serializeQueueError(error),
  })
  process.exitCode = 1
})
