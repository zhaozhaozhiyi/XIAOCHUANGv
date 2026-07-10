import 'reflect-metadata'

import { NestFactory } from '@nestjs/core'

import { AppModule } from './app.module'
import {
  logTaskQueueEvent,
  serializeQueueError,
  writeTaskQueueReadinessFile,
} from './modules/queue/task-queue.shared'
import { TaskExecutionService } from './modules/tasks/task-execution.service'

type WorkerOptions = {
  once: boolean
  dryRun: boolean
  intervalMs: number
  limit: number
  readyFile?: string
}

function getArgValue(flag: string) {
  const prefix = `${flag}=`
  return process.argv.slice(2).find((arg) => arg.startsWith(prefix))?.slice(prefix.length)
}

function parseArgs(): WorkerOptions {
  const args = new Set(process.argv.slice(2))
  const getNumber = (flag: string, fallback: number) => {
    const value = getArgValue(flag)
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
  }
  const readyFile = getArgValue('--ready-file') || process.env.TASK_RECOVER_READY_FILE || process.env.WORKER_READY_FILE || undefined

  return {
    once: args.has('--once'),
    dryRun: args.has('--dry-run'),
    intervalMs: getNumber('--interval-ms', 15_000),
    limit: getNumber('--limit', 20),
    readyFile,
  }
}

async function main() {
  const options = parseArgs()
  const workerId = `recover-${process.pid}-${Math.random().toString(36).slice(2, 8)}`

  const updateReadiness = async (status: 'starting' | 'ready' | 'shutting_down' | 'stopped', extra: Record<string, unknown> = {}) => {
    try {
      await writeTaskQueueReadinessFile(options.readyFile, {
        status,
        component: 'task-recover',
        worker_id: workerId,
        pid: process.pid,
        ...extra,
      })
    } catch (error) {
      logTaskQueueEvent('warn', {
        event: 'task_recover.readiness_write_failed',
        component: 'task-recover',
        worker_id: workerId,
        error: serializeQueueError(error),
      })
    }
  }

  logTaskQueueEvent('info', {
    event: 'task_recover.starting',
    component: 'task-recover',
    worker_id: workerId,
    pid: process.pid,
    once: options.once,
    dry_run: options.dryRun,
    interval_ms: options.intervalMs,
    limit: options.limit,
    ready_file: options.readyFile ?? null,
  })
  await updateReadiness('starting', {
    once: options.once,
    dry_run: options.dryRun,
    interval_ms: options.intervalMs,
    limit: options.limit,
  })

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false })

  try {
    const worker = app.get(TaskExecutionService)
    await updateReadiness('ready', {
      once: options.once,
      dry_run: options.dryRun,
      interval_ms: options.intervalMs,
      limit: options.limit,
    })
    logTaskQueueEvent('info', {
      event: 'task_recover.ready',
      component: 'task-recover',
      worker_id: workerId,
      pid: process.pid,
      once: options.once,
      dry_run: options.dryRun,
      interval_ms: options.intervalMs,
      limit: options.limit,
      ready_file: options.readyFile ?? null,
    })

    do {
      const startedAt = Date.now()
      const result = await worker.recoverPendingTasks(options.limit, options.dryRun, workerId)
      logTaskQueueEvent('info', {
        event: 'task_recover.completed',
        component: 'task-recover',
        worker_id: workerId,
        ...result,
        duration_ms: Date.now() - startedAt,
      })
      if (options.once) break
      await new Promise((resolve) => setTimeout(resolve, options.intervalMs))
    } while (true)
  } finally {
    await updateReadiness('shutting_down')
    await app.close()
    await updateReadiness('stopped')
    logTaskQueueEvent('info', {
      event: 'task_recover.stopped',
      component: 'task-recover',
      worker_id: workerId,
      pid: process.pid,
    })
  }
}

void main().catch((error) => {
  logTaskQueueEvent('error', {
    event: 'task_recover.fatal',
    component: 'task-recover',
    pid: process.pid,
    error: serializeQueueError(error),
  })
  process.exitCode = 1
})
