import 'reflect-metadata'

import { NestFactory } from '@nestjs/core'

import { AppModule } from './app.module'
import { TaskExecutionService } from './modules/tasks/task-execution.service'

type WorkerOptions = {
  once: boolean
  dryRun: boolean
  intervalMs: number
  limit: number
}

function parseArgs(): WorkerOptions {
  const args = new Set(process.argv.slice(2))
  const getNumber = (flag: string, fallback: number) => {
    const prefix = `${flag}=`
    const value = process.argv.slice(2).find((arg) => arg.startsWith(prefix))?.slice(prefix.length)
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
  }

  return {
    once: args.has('--once'),
    dryRun: args.has('--dry-run'),
    intervalMs: getNumber('--interval-ms', 15_000),
    limit: getNumber('--limit', 20),
  }
}

async function main() {
  const options = parseArgs()
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false })
  const workerId = `recover-${process.pid}-${Math.random().toString(36).slice(2, 8)}`

  try {
    const worker = app.get(TaskExecutionService)

    do {
      const result = await worker.recoverPendingTasks(options.limit, options.dryRun, workerId)
      console.log(JSON.stringify({
        ...result,
        at: new Date().toISOString(),
      }))
      if (options.once) break
      await new Promise((resolve) => setTimeout(resolve, options.intervalMs))
    } while (true)
  } finally {
    await app.close()
  }
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
