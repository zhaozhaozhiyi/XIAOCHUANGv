import 'reflect-metadata'

import { ConfigService } from '@nestjs/config'
import { NestFactory } from '@nestjs/core'
import { Worker } from 'bullmq'

import { AppModule } from './app.module'
import {
  CANVAS_TASK_JOB_NAME,
  createTaskQueueConnection,
  DRAMA_TASK_JOB_NAME,
  isCanvasQueueJob,
  TASK_QUEUE_NAME,
  type BackendQueueJobData,
} from './modules/queue/task-queue.shared'
import { CanvasExecutionService } from './modules/canvas/execution/canvas-execution.service'
import { CanvasRunOrchestratorService } from './modules/canvas/execution/canvas-run-orchestrator.service'
import { TaskExecutionService } from './modules/tasks/task-execution.service'

type WorkerOptions = {
  concurrency: number
}

function parseArgs(): WorkerOptions {
  const prefix = '--concurrency='
  const value = process.argv.slice(2).find((arg) => arg.startsWith(prefix))?.slice(prefix.length)
  const parsed = Number(value)

  return {
    concurrency: Number.isFinite(parsed) && parsed > 0 ? parsed : 2,
  }
}

async function main() {
  const options = parseArgs()
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false })
  const configService = app.get(ConfigService)
  const dramaExecutor = app.get(TaskExecutionService)
  const canvasExecutor = app.get(CanvasExecutionService)
  const canvasOrchestrator = app.get(CanvasRunOrchestratorService)
  const redisUrl = configService.get<string>('REDIS_URL', 'redis://127.0.0.1:6379')
  const connection = createTaskQueueConnection(redisUrl, 'worker')
  const workerId = `bullmq-${process.pid}-${Math.random().toString(36).slice(2, 8)}`

  const worker = new Worker<BackendQueueJobData>(
    TASK_QUEUE_NAME,
    async (job) => {
      if (job.name === CANVAS_TASK_JOB_NAME || isCanvasQueueJob(job.data)) {
        const data = job.data as { canvasTaskId: string; userId: number }
        const result = await canvasExecutor.executeCanvasTaskById(
          data.canvasTaskId,
          data.userId,
          `${workerId}:${job.id}`,
        )
        await canvasOrchestrator.onTaskSettled(data.canvasTaskId)
        return result
      }

      if (job.name === DRAMA_TASK_JOB_NAME || 'taskId' in job.data) {
        return dramaExecutor.executeTaskById((job.data as { taskId: number }).taskId, `${workerId}:${job.id}`)
      }

      throw new Error(`unknown job: ${job.name}`)
    },
    {
      connection,
      concurrency: options.concurrency,
    },
  )

  worker.on('completed', (job, result) => {
    console.log(JSON.stringify({
      event: 'job.completed',
      jobId: job.id,
      jobName: job.name,
      data: job.data,
      result,
      at: new Date().toISOString(),
    }))
  })

  worker.on('failed', (job, error) => {
    console.error(JSON.stringify({
      event: 'job.failed',
      jobId: job?.id ?? null,
      jobName: job?.name ?? null,
      data: job?.data ?? null,
      error: error.message,
      at: new Date().toISOString(),
    }))
  })

  const shutdown = async () => {
    await worker.close().catch(() => undefined)
    await app.close()
  }

  process.once('SIGINT', () => {
    void shutdown().finally(() => process.exit(0))
  })
  process.once('SIGTERM', () => {
    void shutdown().finally(() => process.exit(0))
  })
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
