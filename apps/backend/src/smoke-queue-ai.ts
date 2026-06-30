import 'reflect-metadata'

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import type { AddressInfo } from 'node:net'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
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
  imageGenerationId: number | null
  videoGenerationId: number | null
  imageTaskId: number | null
  videoTaskId: number | null
  ttsTaskId: number | null
  aiConfigIds: number[]
}

const PNG_1X1_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wn3n0cAAAAASUVORK5CYII='

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
      `sine=frequency=660:sample_rate=48000:duration=${durationSeconds}`,
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

function createToneWavBuffer(durationSeconds: number, frequency = 440) {
  const sampleRate = 24_000
  const channels = 1
  const bytesPerSample = 2
  const totalSamples = Math.max(1, Math.floor(durationSeconds * sampleRate))
  const dataSize = totalSamples * channels * bytesPerSample
  const buffer = Buffer.alloc(44 + dataSize)

  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(channels, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * channels * bytesPerSample, 28)
  buffer.writeUInt16LE(channels * bytesPerSample, 32)
  buffer.writeUInt16LE(bytesPerSample * 8, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataSize, 40)

  for (let index = 0; index < totalSamples; index += 1) {
    const sample = Math.round(Math.sin((2 * Math.PI * frequency * index) / sampleRate) * 0.2 * 32767)
    buffer.writeInt16LE(sample, 44 + index * bytesPerSample)
  }

  return buffer
}

async function readJsonBody(request: IncomingMessage) {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  if (!chunks.length) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function sendJson(response: ServerResponse, payload: unknown) {
  const body = Buffer.from(`${JSON.stringify(payload)}\n`, 'utf8')
  response.statusCode = 200
  response.setHeader('Content-Type', 'application/json')
  response.setHeader('Content-Length', String(body.byteLength))
  response.end(body)
}

function sendBuffer(response: ServerResponse, buffer: Buffer, mimeType: string) {
  response.statusCode = 200
  response.setHeader('Content-Type', mimeType)
  response.setHeader('Content-Length', String(buffer.byteLength))
  response.end(buffer)
}

async function main() {
  const options = parseArgs()
  const queueName = `queue-smoke-ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  process.env.TASK_QUEUE_NAME = queueName

  const [
    { NestFactory },
    { ConfigService },
    { AppModule },
    { DatabaseService },
    { ImagesTasksService },
    { VideosTasksService },
    { TaskExecutionService },
    queueShared,
    schema,
  ] = await Promise.all([
    import('@nestjs/core'),
    import('@nestjs/config'),
    import('./app.module.js'),
    import('./db/database.service.js'),
    import('./modules/images/images.tasks.js'),
    import('./modules/videos/videos.tasks.js'),
    import('./modules/tasks/task-execution.service.js'),
    import('./modules/queue/task-queue.shared.js'),
    import('./db/schema.js'),
  ])

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaochuang-queue-ai-'))
  const pngBuffer = Buffer.from(PNG_1X1_BASE64, 'base64')
  const wavBuffer = createToneWavBuffer(0.8)
  const stubVideoPath = path.join(tempDir, 'stub-video.mp4')
  createSampleVideo(stubVideoPath, 'green', 1.6)
  const stubVideoBuffer = fs.readFileSync(stubVideoPath)
  let stubPort = 0

  const server = createServer(async (request, response) => {
    try {
      if (!request.url) {
        response.statusCode = 404
        response.end()
        return
      }

      if (request.method === 'GET' && request.url === '/stub/image.png') {
        sendBuffer(response, pngBuffer, 'image/png')
        return
      }

      if (request.method === 'GET' && request.url === '/stub/video.mp4') {
        sendBuffer(response, stubVideoBuffer, 'video/mp4')
        return
      }

      if (request.method === 'POST' && request.url === '/v1/images/generations') {
        await readJsonBody(request)
        sendJson(response, {
          data: [
            {
              url: `http://127.0.0.1:${stubPort}/stub/image.png`,
            },
          ],
        })
        return
      }

      if (request.method === 'POST' && request.url === '/v1/video_generation') {
        await readJsonBody(request)
        sendJson(response, {
          video_url: `http://127.0.0.1:${stubPort}/stub/video.mp4`,
        })
        return
      }

      if (request.method === 'POST' && request.url === '/v1/t2a_v2') {
        await readJsonBody(request)
        sendJson(response, {
          base_resp: {
            status_code: 0,
            status_msg: 'success',
          },
          data: {
            audio: wavBuffer.toString('hex'),
            extra_info: {
              audio_length: 800,
              audio_sample_rate: 24_000,
              bitrate: 384_000,
              audio_format: 'wav',
              audio_channel: 1,
            },
          },
        })
        return
      }

      response.statusCode = 404
      response.end()
    } catch (error) {
      response.statusCode = 500
      response.end(error instanceof Error ? error.message : String(error))
    }
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address() as AddressInfo | null
  if (!address) {
    throw new Error('Failed to bind stub AI server')
  }
  stubPort = address.port

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false })
  let worker: Worker<{ taskId: number }> | null = null
  const cleanup: CleanupState = {
    dramaId: null,
    episodeId: null,
    storyboardIds: [],
    imageGenerationId: null,
    videoGenerationId: null,
    imageTaskId: null,
    videoTaskId: null,
    ttsTaskId: null,
    aiConfigIds: [],
  }

  try {
    const configService = app.get(ConfigService)
    const databaseService = app.get(DatabaseService)
    const imagesTasksService = app.get(ImagesTasksService)
    const videosTasksService = app.get(VideosTasksService)
    const taskExecutionService = app.get(TaskExecutionService)
    const db = databaseService.db
    const {
      aiServiceConfigs,
      dramas,
      episodes,
      imageGenerations,
      storyboards,
      tasks,
      videoGenerations,
    } = schema

    const storageDriver = configService.get<'local' | 's3'>('STORAGE_DRIVER', 'local')
    const publicBaseUrl = configService.get<string>('STORAGE_PUBLIC_BASE_URL') || null
    const redisUrl = configService.get<string>('REDIS_URL', 'redis://127.0.0.1:6379')
    const connection = queueShared.createTaskQueueConnection(redisUrl, 'worker')
    const workerId = `smoke-ai-worker-${process.pid}-${Math.random().toString(36).slice(2, 8)}`

    if (options.requireObjectStorage && storageDriver !== 's3') {
      throw new Error(`queue ai smoke requires STORAGE_DRIVER=s3, got ${storageDriver}`)
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

    const stubBaseUrl = `http://127.0.0.1:${stubPort}`
    const insertedConfigs = await db
      .insert(aiServiceConfigs)
      .values([
        {
          serviceType: 'image',
          provider: 'openai',
          name: 'Queue Smoke Image Stub',
          baseUrl: stubBaseUrl,
          apiKey: 'stub-image-key',
          model: JSON.stringify(['gpt-image-1']),
          priority: 1_000_000,
          isDefault: false,
          isActive: true,
          settings: null,
        },
        {
          serviceType: 'video',
          provider: 'minimax',
          name: 'Queue Smoke Video Stub',
          baseUrl: stubBaseUrl,
          apiKey: 'stub-video-key',
          model: JSON.stringify(['stub-video-model']),
          priority: 1_000_000,
          isDefault: false,
          isActive: true,
          settings: null,
        },
        {
          serviceType: 'audio',
          provider: 'minimax',
          name: 'Queue Smoke Audio Stub',
          baseUrl: stubBaseUrl,
          apiKey: 'stub-audio-key',
          model: JSON.stringify(['stub-audio-model']),
          priority: 1_000_000,
          isDefault: false,
          isActive: true,
          settings: null,
        },
      ])
      .returning({ id: aiServiceConfigs.id, serviceType: aiServiceConfigs.serviceType })
    cleanup.aiConfigIds = insertedConfigs.map((row: { id: number }) => row.id)

    const imageConfigId = insertedConfigs.find((row: { serviceType: string }) => row.serviceType === 'image')?.id ?? null
    const videoConfigId = insertedConfigs.find((row: { serviceType: string }) => row.serviceType === 'video')?.id ?? null
    const audioConfigId = insertedConfigs.find((row: { serviceType: string }) => row.serviceType === 'audio')?.id ?? null
    if (!imageConfigId || !videoConfigId || !audioConfigId) {
      throw new Error('Failed to create smoke AI configs')
    }

    const uniqueToken = Date.now().toString(36)
    const [createdDrama] = await db
      .insert(dramas)
      .values({
        title: `Queue AI Smoke Drama ${uniqueToken}`,
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
        title: 'Queue AI Smoke Episode',
        status: 'draft',
        imageConfigId,
        videoConfigId,
        audioConfigId,
      })
      .returning({ id: episodes.id })
    cleanup.episodeId = createdEpisode?.id ?? null
    if (!cleanup.episodeId) throw new Error('Failed to create smoke episode')

    const insertedStoryboards = await db
      .insert(storyboards)
      .values([
        {
          episodeId: cleanup.episodeId,
          storyboardNumber: 1,
          title: 'Queue AI Image Storyboard',
          description: 'Image queue smoke storyboard',
          dialogue: '旁白：这是图片任务烟雾测试。',
          status: 'pending',
        },
        {
          episodeId: cleanup.episodeId,
          storyboardNumber: 2,
          title: 'Queue AI Video Storyboard',
          description: 'Video queue smoke storyboard',
          dialogue: '旁白：这是视频任务烟雾测试。',
          status: 'pending',
        },
        {
          episodeId: cleanup.episodeId,
          storyboardNumber: 3,
          title: 'Queue AI TTS Storyboard',
          description: 'TTS queue smoke storyboard',
          dialogue: '旁白：这是配音任务烟雾测试。',
          status: 'pending',
        },
      ])
      .returning({ id: storyboards.id })
    cleanup.storyboardIds = insertedStoryboards.map((row: { id: number }) => row.id)
    if (cleanup.storyboardIds.length !== 3) {
      throw new Error(`Failed to create smoke storyboards: expected 3, got ${cleanup.storyboardIds.length}`)
    }

    const [createdImageGeneration] = await db
      .insert(imageGenerations)
      .values({
        userId: null,
        storyboardId: cleanup.storyboardIds[0],
        dramaId: cleanup.dramaId,
        prompt: 'Queue AI smoke image prompt',
        model: 'gpt-image-1',
        provider: 'openai',
        size: '1024x1024',
        frameType: 'first_frame',
        status: 'pending',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning({ id: imageGenerations.id })
    cleanup.imageGenerationId = createdImageGeneration?.id ?? null
    if (!cleanup.imageGenerationId) throw new Error('Failed to create smoke image generation')

    cleanup.imageTaskId = await imagesTasksService.syncTaskForImageGeneration(cleanup.imageGenerationId, {
      aiConfigId: imageConfigId,
      payload: {
        storyboard_id: cleanup.storyboardIds[0],
        drama_id: cleanup.dramaId,
        prompt: 'Queue AI smoke image prompt',
        frame_type: 'first_frame',
        config_id: imageConfigId,
      },
    })
    if (!cleanup.imageTaskId) throw new Error('Failed to create smoke image task')

    const [createdVideoGeneration] = await db
      .insert(videoGenerations)
      .values({
        userId: null,
        storyboardId: cleanup.storyboardIds[1],
        dramaId: cleanup.dramaId,
        prompt: 'Queue AI smoke video prompt',
        model: 'stub-video-model',
        provider: 'minimax',
        referenceMode: 'none',
        duration: 2,
        aspectRatio: '16:9',
        status: 'pending',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning({ id: videoGenerations.id })
    cleanup.videoGenerationId = createdVideoGeneration?.id ?? null
    if (!cleanup.videoGenerationId) throw new Error('Failed to create smoke video generation')

    cleanup.videoTaskId = await videosTasksService.syncTaskForVideoGeneration(cleanup.videoGenerationId, {
      aiConfigId: videoConfigId,
      payload: {
        storyboard_id: cleanup.storyboardIds[1],
        drama_id: cleanup.dramaId,
        prompt: 'Queue AI smoke video prompt',
        reference_mode: 'none',
        duration: 2,
        aspect_ratio: '16:9',
        config_id: videoConfigId,
      },
    })
    if (!cleanup.videoTaskId) throw new Error('Failed to create smoke video task')

    const [createdTtsTask] = await db
      .insert(tasks)
      .values({
        userId: null,
        type: 'audio',
        status: 'queued',
        title: 'Queue AI smoke TTS',
        progress: 0,
        sourceType: 'drama_storyboard_tts',
        dramaId: cleanup.dramaId,
        episodeId: cleanup.episodeId,
        storyboardId: cleanup.storyboardIds[2],
        aiConfigId: audioConfigId,
        domainTable: 'storyboard_tts',
        domainId: cleanup.storyboardIds[2],
        providerTaskId: null,
        attemptCount: 0,
        payloadJson: JSON.stringify({
          storyboard_id: cleanup.storyboardIds[2],
          episode_id: cleanup.episodeId,
          drama_id: cleanup.dramaId,
          text: '这是配音任务烟雾测试。',
          voice_id: 'stub-voice',
          config_id: audioConfigId,
        }),
        resultSummaryJson: null,
        errorKind: null,
        errorMessage: null,
        errorDetailsJson: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning({ id: tasks.id })
    cleanup.ttsTaskId = createdTtsTask?.id ?? null
    if (!cleanup.ttsTaskId) throw new Error('Failed to create smoke TTS task')

    for (const taskId of [cleanup.imageTaskId, cleanup.videoTaskId, cleanup.ttsTaskId]) {
      await worker.waitUntilReady()
      await app.get((await import('./modules/queue/task-queue.service.js')).TaskQueueService).enqueueTask(taskId)
    }

    const completed = await waitFor(
      'ai queue smoke',
      options.timeoutMs,
      async () => {
        const taskRows = await db
          .select({
            id: tasks.id,
            status: tasks.status,
            errorMessage: tasks.errorMessage,
            domainTable: tasks.domainTable,
          })
          .from(tasks)
          .where(inArray(tasks.id, [cleanup.imageTaskId!, cleanup.videoTaskId!, cleanup.ttsTaskId!]))

        if (taskRows.some((task: { status: string; errorMessage: string | null }) => task.status === 'failed' || task.status === 'canceled')) {
          throw new Error(taskRows.map((task: { id: number; status: string; errorMessage: string | null; domainTable: string }) => `${task.domainTable}#${task.id}:${task.status}:${task.errorMessage || ''}`).join(', '))
        }

        if (taskRows.length !== 3 || taskRows.some((task: { status: string }) => task.status !== 'completed')) {
          return null
        }

        const [imageRow] = await db
          .select({
            status: imageGenerations.status,
            imageUrl: imageGenerations.imageUrl,
          })
          .from(imageGenerations)
          .where(eq(imageGenerations.id, cleanup.imageGenerationId!))
        const [videoRow] = await db
          .select({
            status: videoGenerations.status,
            videoUrl: videoGenerations.videoUrl,
          })
          .from(videoGenerations)
          .where(eq(videoGenerations.id, cleanup.videoGenerationId!))
        const storyboardRows = await db
          .select({
            id: storyboards.id,
            firstFrameImage: storyboards.firstFrameImage,
            videoUrl: storyboards.videoUrl,
            ttsAudioUrl: storyboards.ttsAudioUrl,
          })
          .from(storyboards)
          .where(inArray(storyboards.id, cleanup.storyboardIds))

        const firstStoryboard = storyboardRows.find((row: { id: number }) => row.id === cleanup.storyboardIds[0])
        const secondStoryboard = storyboardRows.find((row: { id: number }) => row.id === cleanup.storyboardIds[1])
        const thirdStoryboard = storyboardRows.find((row: { id: number }) => row.id === cleanup.storyboardIds[2])

        if (!imageRow?.imageUrl || imageRow.status !== 'completed') return null
        if (!videoRow?.videoUrl || videoRow.status !== 'completed') return null
        if (!firstStoryboard?.firstFrameImage || !secondStoryboard?.videoUrl || !thirdStoryboard?.ttsAudioUrl) return null

        return {
          taskRows,
          imageRow,
          videoRow,
          storyboardRows,
        }
      },
    )

    const imageUrl = String(completed.imageRow.imageUrl || '').trim()
    const videoUrl = String(completed.videoRow.videoUrl || '').trim()
    const ttsStoryboard = completed.storyboardRows.find((row: { id: number }) => row.id === cleanup.storyboardIds[2])
    const ttsAudioUrl = String(ttsStoryboard?.ttsAudioUrl || '').trim()

    if (options.requireObjectStorage) {
      for (const value of [imageUrl, videoUrl, ttsAudioUrl]) {
        if (!isRemoteHttpUrl(value)) {
          throw new Error(`queue ai smoke requires remote public url, got ${value}`)
        }
      }
    }

    const result: Record<string, unknown> = {
      ok: true,
      queue_name: queueShared.TASK_QUEUE_NAME,
      storage_driver: storageDriver,
      storage_public_base_url: publicBaseUrl,
      image_task_id: cleanup.imageTaskId,
      video_task_id: cleanup.videoTaskId,
      tts_task_id: cleanup.ttsTaskId,
      image_url: imageUrl,
      video_url: videoUrl,
      tts_audio_url: ttsAudioUrl,
    }

    if (options.requirePublicFetch) {
      const [imageResponse, videoResponse, audioResponse] = await Promise.all([
        fetch(imageUrl, { signal: AbortSignal.timeout(30_000) }),
        fetch(videoUrl, { signal: AbortSignal.timeout(30_000) }),
        fetch(ttsAudioUrl, { signal: AbortSignal.timeout(30_000) }),
      ])
      const [imageBytes, videoBytes, audioBytes] = await Promise.all([
        imageResponse.arrayBuffer(),
        videoResponse.arrayBuffer(),
        audioResponse.arrayBuffer(),
      ])

      result.public_fetch_status = {
        image: imageResponse.status,
        video: videoResponse.status,
        audio: audioResponse.status,
      }
      result.public_fetch_ok =
        imageResponse.ok && videoResponse.ok && audioResponse.ok
        && imageBytes.byteLength > 0
        && videoBytes.byteLength > 0
        && audioBytes.byteLength > 0
      result.public_fetch_size = {
        image: imageBytes.byteLength,
        video: videoBytes.byteLength,
        audio: audioBytes.byteLength,
      }

      if (!result.public_fetch_ok) {
        throw new Error('public fetch failed for one or more AI queue artifacts')
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
      const {
        aiServiceConfigs,
        dramas,
        episodes,
        imageGenerations,
        storyboards,
        tasks,
        videoGenerations,
      } = schema
      try {
        if (cleanup.imageTaskId != null || cleanup.videoTaskId != null || cleanup.ttsTaskId != null) {
          const taskIds = [cleanup.imageTaskId, cleanup.videoTaskId, cleanup.ttsTaskId].filter((value): value is number => value != null)
          if (taskIds.length) {
            await db.delete(tasks).where(inArray(tasks.id, taskIds))
          }
        }
        if (cleanup.imageGenerationId != null) {
          await db.delete(imageGenerations).where(eq(imageGenerations.id, cleanup.imageGenerationId))
        }
        if (cleanup.videoGenerationId != null) {
          await db.delete(videoGenerations).where(eq(videoGenerations.id, cleanup.videoGenerationId))
        }
        if (cleanup.storyboardIds.length) {
          await db.delete(storyboards).where(inArray(storyboards.id, cleanup.storyboardIds))
        }
        if (cleanup.episodeId != null) {
          await db.delete(episodes).where(eq(episodes.id, cleanup.episodeId))
        }
        if (cleanup.dramaId != null) {
          await db.delete(dramas).where(eq(dramas.id, cleanup.dramaId))
        }
        if (cleanup.aiConfigIds.length) {
          await db.delete(aiServiceConfigs).where(inArray(aiServiceConfigs.id, cleanup.aiConfigIds))
        }
      } catch {
        // Prefer preserving main smoke result over surfacing cleanup noise.
      }
    }

    await app.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

void main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  }, null, 2))
  process.exitCode = 1
})
