import 'reflect-metadata'

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { Worker } from 'bullmq'
import { and, eq, inArray } from 'drizzle-orm'

type SmokeOptions = {
  requireObjectStorage: boolean
  requirePublicFetch: boolean
  keepData: boolean
  timeoutMs: number
}

type CleanupState = {
  dramaId: number | null
  episodeId: number | null
  storyboardIds: number[]
  mergeId: number | null
}

function parseArgs(): SmokeOptions {
  const args = new Set(process.argv.slice(2))
  const timeoutArg = process.argv
    .slice(2)
    .find((arg) => arg.startsWith('--timeout-ms='))
    ?.slice('--timeout-ms='.length)

  const timeoutMs = Number(timeoutArg)

  return {
    requireObjectStorage: args.has('--require-object-storage'),
    requirePublicFetch: args.has('--require-public-fetch') || args.has('--require-object-storage'),
    keepData: args.has('--keep-data'),
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 120_000,
  }
}

function isRemoteHttpUrl(value: string | null | undefined) {
  return /^https?:\/\//i.test(String(value || '').trim())
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitFor<T>(
  description: string,
  timeoutMs: number,
  probe: () => Promise<T | null>,
): Promise<T> {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    const result = await probe()
    if (result != null) return result
    await sleep(500)
  }

  throw new Error(`${description} did not complete within ${timeoutMs}ms`)
}

function createSampleVideo(outputPath: string, color: string, durationSeconds: number) {
  execFileSync(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      `color=c=${color}:s=640x360:d=${durationSeconds}`,
      '-f',
      'lavfi',
      '-i',
      `sine=frequency=440:sample_rate=48000:duration=${durationSeconds}`,
      '-vf',
      'format=yuv420p',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-c:a',
      'aac',
      '-ar',
      '48000',
      '-ac',
      '2',
      '-shortest',
      '-movflags',
      '+faststart',
      outputPath,
    ],
    {
      stdio: 'pipe',
    },
  )
}

async function main() {
  const options = parseArgs()
  const queueName = `queue-smoke-media-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  process.env.TASK_QUEUE_NAME = queueName
  process.env.STORYBOARD_COMPOSE_TTS = '0'

  const [
    { NestFactory },
    { ConfigService },
    { AppModule },
    { DatabaseService },
    { StorageService },
    { ComposeService },
    { MergeService },
    { TaskExecutionService },
    queueShared,
    schema,
  ] = await Promise.all([
    import('@nestjs/core'),
    import('@nestjs/config'),
    import('./app.module.js'),
    import('./db/database.service.js'),
    import('./modules/storage/storage.service.js'),
    import('./modules/compose/compose.service.js'),
    import('./modules/merge/merge.service.js'),
    import('./modules/tasks/task-execution.service.js'),
    import('./modules/queue/task-queue.shared.js'),
    import('./db/schema.js'),
  ])

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false })
  let worker: Worker<{ taskId: number }> | null = null
  const cleanup: CleanupState = {
    dramaId: null,
    episodeId: null,
    storyboardIds: [],
    mergeId: null,
  }

  try {
    const configService = app.get(ConfigService)
    const databaseService = app.get(DatabaseService)
    const storageService = app.get(StorageService)
    const composeService = app.get(ComposeService)
    const mergeService = app.get(MergeService)
    const taskExecutionService = app.get(TaskExecutionService)
    const db = databaseService.db
    const {
      dramas,
      episodes,
      storyboards,
      tasks,
      videoMerges,
    } = schema

    const storageDriver = configService.get<'local' | 's3'>('STORAGE_DRIVER', 'local')
    const publicBaseUrl = configService.get<string>('STORAGE_PUBLIC_BASE_URL') || null
    const redisUrl = configService.get<string>('REDIS_URL', 'redis://127.0.0.1:6379')
    const connection = queueShared.createTaskQueueConnection(redisUrl, 'worker')
    const workerId = `smoke-worker-${process.pid}-${Math.random().toString(36).slice(2, 8)}`

    if (options.requireObjectStorage && storageDriver !== 's3') {
      throw new Error(`queue smoke requires STORAGE_DRIVER=s3, got ${storageDriver}`)
    }

    worker = new Worker<{ taskId: number }>(
      queueShared.TASK_QUEUE_NAME,
      async (job) => taskExecutionService.executeTaskById(job.data.taskId, `${workerId}:${job.id}`),
      {
        connection,
        concurrency: 1,
      },
    )
    await worker.waitUntilReady()

    const uniqueToken = Date.now().toString(36)
    const [createdDrama] = await db
      .insert(dramas)
      .values({
        title: `Queue Smoke Drama ${uniqueToken}`,
        status: 'draft',
      })
      .returning({ id: dramas.id })
    cleanup.dramaId = createdDrama?.id ?? null
    if (!cleanup.dramaId) throw new Error('Failed to create smoke drama')

    const [createdEpisode] = await db
      .insert(episodes)
      .values({
        dramaId: cleanup.dramaId,
        episodeNumber: 1,
        title: 'Queue Smoke Episode',
        status: 'draft',
      })
      .returning({ id: episodes.id })
    cleanup.episodeId = createdEpisode?.id ?? null
    if (!cleanup.episodeId) throw new Error('Failed to create smoke episode')

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaochuang-queue-smoke-'))
    const inputPaths = [
      path.join(tempDir, 'source-red.mp4'),
      path.join(tempDir, 'source-blue.mp4'),
    ]

    createSampleVideo(inputPaths[0], 'red', 1.2)
    createSampleVideo(inputPaths[1], 'blue', 1.4)

    const savedSources = await Promise.all(
      inputPaths.map(async (inputPath, index) => {
        const buffer = fs.readFileSync(inputPath)
        return storageService.saveBuffer({
          buffer,
          subDir: 'queue-smoke/source',
          fileName: `source-${index + 1}.mp4`,
          extension: '.mp4',
          mimeType: 'video/mp4',
        })
      }),
    )

    const insertedStoryboards = await db
      .insert(storyboards)
      .values(
        savedSources.map((saved, index) => ({
          episodeId: cleanup.episodeId!,
          storyboardNumber: index + 1,
          title: `Smoke Storyboard ${index + 1}`,
          description: `Queue smoke storyboard ${index + 1}`,
          duration: index === 0 ? 2 : 2,
          videoUrl: saved.url,
          status: 'pending',
        })),
      )
      .returning({ id: storyboards.id })
    cleanup.storyboardIds = insertedStoryboards.map((row: { id: number }) => row.id)
    if (cleanup.storyboardIds.length !== 2) {
      throw new Error(`Failed to create smoke storyboards: expected 2, got ${cleanup.storyboardIds.length}`)
    }

    const composeQueued = await composeService.enqueueEpisodeCompose(cleanup.episodeId)

    const composeComplete = await waitFor(
      'compose queue smoke',
      options.timeoutMs,
      async () => {
        const composeTasks = await db
          .select({
            id: tasks.id,
            status: tasks.status,
            errorMessage: tasks.errorMessage,
            domainId: tasks.domainId,
          })
          .from(tasks)
          .where(and(eq(tasks.domainTable, 'storyboard_compose'), inArray(tasks.domainId, cleanup.storyboardIds)))

        if (composeTasks.some((task: { status: string; errorMessage: string | null }) => task.status === 'failed' || task.status === 'canceled')) {
          throw new Error(`compose task failed: ${composeTasks.map((task: { id: number; status: string; errorMessage: string | null }) => `${task.id}:${task.status}:${task.errorMessage || ''}`).join(', ')}`)
        }

        if (composeTasks.length !== cleanup.storyboardIds.length || composeTasks.some((task: { status: string }) => task.status !== 'completed')) {
          return null
        }

        const rows = await db
          .select({
            id: storyboards.id,
            status: storyboards.status,
            composedVideoUrl: storyboards.composedVideoUrl,
          })
          .from(storyboards)
          .where(inArray(storyboards.id, cleanup.storyboardIds))

        if (rows.some((row: { status: string | null; composedVideoUrl: string | null }) => row.status !== 'compose_completed' || !row.composedVideoUrl)) {
          return null
        }

        return {
          tasks: composeTasks,
          storyboards: rows,
        }
      },
    )

    cleanup.mergeId = await mergeService.mergeEpisodeVideos(cleanup.episodeId, cleanup.dramaId)

    const mergeComplete = await waitFor(
      'merge queue smoke',
      options.timeoutMs,
      async () => {
        const [mergeTask] = await db
          .select({
            id: tasks.id,
            status: tasks.status,
            errorMessage: tasks.errorMessage,
          })
          .from(tasks)
          .where(and(eq(tasks.domainTable, 'video_merges'), eq(tasks.domainId, cleanup.mergeId!)))

        if (!mergeTask) return null
        if (mergeTask.status === 'failed' || mergeTask.status === 'canceled') {
          throw new Error(`merge task failed: ${mergeTask.status}:${mergeTask.errorMessage || ''}`)
        }
        if (mergeTask.status !== 'completed') return null

        const [mergeRow] = await db
          .select({
            id: videoMerges.id,
            status: videoMerges.status,
            mergedUrl: videoMerges.mergedUrl,
          })
          .from(videoMerges)
          .where(eq(videoMerges.id, cleanup.mergeId!))
        const [episodeRow] = await db
          .select({
            id: episodes.id,
            videoUrl: episodes.videoUrl,
          })
          .from(episodes)
          .where(eq(episodes.id, cleanup.episodeId!))

        if (!mergeRow || mergeRow.status !== 'completed' || !mergeRow.mergedUrl || !episodeRow?.videoUrl) {
          return null
        }

        return {
          task: mergeTask,
          merge: mergeRow,
          episode: episodeRow,
        }
      },
    )

    const finalMergedUrl = String(mergeComplete.merge.mergedUrl || '').trim()
    const composedUrls = composeComplete.storyboards.map((row: { composedVideoUrl: string | null }) => String(row.composedVideoUrl || '').trim())

    if (options.requireObjectStorage) {
      if (!isRemoteHttpUrl(finalMergedUrl)) {
        throw new Error(`queue smoke requires remote merged url, got ${finalMergedUrl}`)
      }
      if (composedUrls.some((url) => !isRemoteHttpUrl(url))) {
        throw new Error(`queue smoke requires remote composed urls, got ${composedUrls.join(', ')}`)
      }
    }

    const result: Record<string, unknown> = {
      ok: true,
      queue_name: queueShared.TASK_QUEUE_NAME,
      storage_driver: storageDriver,
      storage_public_base_url: publicBaseUrl,
      compose_task_ids: composeComplete.tasks.map((task: { id: number }) => task.id),
      merge_id: cleanup.mergeId,
      merge_task_id: mergeComplete.task.id,
      merged_url: finalMergedUrl,
      composed_urls: composedUrls,
      compose_enqueued_total: composeQueued.total,
    }

    if (options.requirePublicFetch) {
      const response = await fetch(finalMergedUrl, {
        signal: AbortSignal.timeout(30_000),
      })
      const bytes = Buffer.from(await response.arrayBuffer())
      result.public_fetch_status = response.status
      result.public_fetch_ok = response.ok && bytes.byteLength > 0
      result.public_fetch_size = bytes.byteLength

      if (!response.ok) {
        throw new Error(`public fetch failed with status ${response.status}`)
      }

      if (!bytes.byteLength) {
        throw new Error('public fetch returned empty media')
      }
    }

    console.log(JSON.stringify(result, null, 2))
  } finally {
    const schema = await import('./db/schema.js')
    const { DatabaseService } = await import('./db/database.service.js')
    const databaseService = app.get(DatabaseService)
    const db = databaseService.db

    try {
      await worker?.close().catch(() => undefined)
    } catch {
      // Ignore worker close failures during smoke cleanup.
    }

    if (!options.keepData) {
      const { tasks, videoMerges, storyboards, episodes, dramas } = schema
      try {
        if (cleanup.mergeId != null) {
          await db.delete(tasks).where(and(eq(tasks.domainTable, 'video_merges'), eq(tasks.domainId, cleanup.mergeId)))
          await db.delete(videoMerges).where(eq(videoMerges.id, cleanup.mergeId))
        }
        if (cleanup.storyboardIds.length) {
          await db.delete(tasks).where(and(eq(tasks.domainTable, 'storyboard_compose'), inArray(tasks.domainId, cleanup.storyboardIds)))
          await db.delete(storyboards).where(inArray(storyboards.id, cleanup.storyboardIds))
        }
        if (cleanup.episodeId != null) {
          await db.delete(episodes).where(eq(episodes.id, cleanup.episodeId))
        }
        if (cleanup.dramaId != null) {
          await db.delete(dramas).where(eq(dramas.id, cleanup.dramaId))
        }
      } catch {
        // Leave smoke rows behind rather than hiding the main result with cleanup errors.
      }
    }

    await app.close()
  }
}

void main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  }, null, 2))
  process.exitCode = 1
})
