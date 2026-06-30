import { Inject, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { eq } from 'drizzle-orm'

import { DatabaseService } from '../../../db/database.service'
import { imageGenerations, videoGenerations } from '../../../db/schema'
import { AudioService } from '../../audio/audio.service'
import { ImagesService } from '../../images/images.service'
import { VideosService } from '../../videos/videos.service'
import type {
  CanvasGenerateContext,
  CanvasTaskResult,
  ResolvedCanvasInputs,
} from './canvas-execution.types'
import { CanvasConcatService, waitForRecordStatus } from './canvas-concat.service'

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

@Injectable()
export class CanvasModuleRouterService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(ImagesService) private readonly imagesService: ImagesService,
    @Inject(VideosService) private readonly videosService: VideosService,
    @Inject(AudioService) private readonly audioService: AudioService,
    @Inject(CanvasConcatService) private readonly concatService: CanvasConcatService,
  ) {}

  private useStub(): boolean {
    return this.config.get<string>('CANVAS_EXECUTION_STUB', '0') === '1'
  }

  async execute(
    nodeDefId: string,
    params: Record<string, unknown>,
    inputs: ResolvedCanvasInputs,
    context: CanvasGenerateContext,
  ): Promise<CanvasTaskResult> {
    if (this.useStub()) return this.executeStub(nodeDefId, params, inputs)

    switch (nodeDefId) {
      case 'text-to-image':
        return this.executeTextToImage(params, inputs, context)
      case 'image-to-video':
        return this.executeImageToVideo(params, inputs, context)
      case 'text-to-speech':
        return this.executeTextToSpeech(params, inputs, context)
      case 'concat':
        return this.executeConcat(params, inputs)
      case 'export':
        return this.executeExport(inputs)
      default:
        throw new Error(`unsupported execute node: ${nodeDefId}`)
    }
  }

  private executeStub(
    nodeDefId: string,
    params: Record<string, unknown>,
    inputs: ResolvedCanvasInputs,
  ): CanvasTaskResult {
    const seed = encodeURIComponent(asString(params.prompt, nodeDefId).slice(0, 24) || nodeDefId)
    switch (nodeDefId) {
      case 'text-to-image': {
        const url = `https://picsum.photos/seed/canvas-${seed}/1280/720`
        return { url, outputs: [{ type: 'image', url }] }
      }
      case 'image-to-video': {
        const url = inputs.imageUrl || `https://picsum.photos/seed/canvas-v-${seed}/1280/720`
        return { url, outputs: [{ type: 'video', url }] }
      }
      case 'text-to-speech': {
        const url = 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3'
        return { url, outputs: [{ type: 'audio', url }] }
      }
      case 'concat': {
        const url = inputs.videoUrls[0] || `https://example.com/stub-${seed}.mp4`
        return { url, outputs: [{ type: 'video', url }] }
      }
      case 'export': {
        const url = inputs.videoUrls[0] || `https://example.com/stub-export-${seed}.mp4`
        return { url, outputs: [{ type: 'video', url }] }
      }
      default:
        throw new Error(`unsupported stub node: ${nodeDefId}`)
    }
  }

  private async executeTextToImage(
    params: Record<string, unknown>,
    inputs: ResolvedCanvasInputs,
    context: CanvasGenerateContext,
  ): Promise<CanvasTaskResult> {
    const prompt = asString(params.prompt, inputs.text || '')
    if (!prompt) throw new Error('text-to-image requires prompt')

    const userId = Number(context.userId)
    const genId = await this.imagesService.generateImage({
      userId,
      prompt,
      referenceImages: inputs.references.length ? inputs.references : undefined,
      taskPayload: {
        canvasId: context.canvasId,
        canvasNodeId: context.nodeId,
        source: 'canvas',
      },
    })

    await this.imagesService.processImageGeneration(genId)

    const record = await waitForRecordStatus(
      async () => {
        const [row] = await this.db.db.select().from(imageGenerations).where(eq(imageGenerations.id, genId))
        return row
      },
      {
        isDone: (row) => row.status === 'completed' && Boolean(row.imageUrl),
        isFailed: (row) => row.status === 'failed',
        getError: (row) => row.errorMsg ?? undefined,
      },
    )

    const url = record.imageUrl!
    return {
      url,
      domainId: genId,
      outputs: [{ type: 'image', url }],
    }
  }

  private async executeImageToVideo(
    params: Record<string, unknown>,
    inputs: ResolvedCanvasInputs,
    context: CanvasGenerateContext,
  ): Promise<CanvasTaskResult> {
    const imageUrl = inputs.imageUrl || inputs.references[0]
    if (!imageUrl) throw new Error('image-to-video requires upstream image')

    const userId = Number(context.userId)
    const genId = await this.videosService.generateVideo({
      userId,
      prompt: asString(params.prompt, asString(params.motion, 'cinematic motion')),
      imageUrl,
      firstFrameUrl: imageUrl,
      duration: typeof params.duration === 'number' ? params.duration : Number(params.duration) || 5,
      taskPayload: {
        canvasId: context.canvasId,
        canvasNodeId: context.nodeId,
        source: 'canvas',
      },
    })

    await this.videosService.processVideoGeneration(genId)

    const record = await waitForRecordStatus(
      async () => {
        const [row] = await this.db.db.select().from(videoGenerations).where(eq(videoGenerations.id, genId))
        return row
      },
      {
        isDone: (row) => row.status === 'completed' && Boolean(row.videoUrl),
        isFailed: (row) => row.status === 'failed',
        getError: (row) => row.errorMsg ?? undefined,
      },
    )

    const url = record.videoUrl!
    return {
      url,
      domainId: genId,
      outputs: [{ type: 'video', url }],
    }
  }

  private async executeTextToSpeech(
    params: Record<string, unknown>,
    inputs: ResolvedCanvasInputs,
    context: CanvasGenerateContext,
  ): Promise<CanvasTaskResult> {
    const text = asString(params.prompt, inputs.text || '')
    if (!text) throw new Error('text-to-speech requires text')

    const voice = asString(params.voice, 'zh_female_shuangkuaisisi_moon_bigtts')
    const result = await this.audioService.generateTTS({
      text,
      voice,
      speed: typeof params.speed === 'number' ? params.speed : undefined,
    })

    return {
      url: result.url,
      outputs: [{ type: 'audio', url: result.url }],
    }
  }

  private async executeConcat(
    params: Record<string, unknown>,
    inputs: ResolvedCanvasInputs,
  ): Promise<CanvasTaskResult> {
    const urls = inputs.videoUrls.length ? inputs.videoUrls : []
    if (!urls.length) throw new Error('concat requires upstream video inputs')

    const url = await this.concatService.concatVideos(urls)
    return { url, outputs: [{ type: 'video', url }] }
  }

  private async executeExport(inputs: ResolvedCanvasInputs): Promise<CanvasTaskResult> {
    const url = inputs.videoUrls[0]
    if (!url) throw new Error('export requires upstream video')
    return { url, outputs: [{ type: 'video', url }] }
  }
}
