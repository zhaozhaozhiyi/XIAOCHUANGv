import fs from 'fs'
import path from 'path'

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import sharp from 'sharp'

import { DatabaseService } from '../../db/database.service'
import {
  characters,
  dramas,
  imageGenerations,
  scenes,
  storyboardCharacters,
  storyboards,
} from '../../db/schema'
import { requireOwnedEpisode, requireOwnedStoryboard } from '../images/images.ownership'
import { getAbsolutePath } from '../images/images.storage'
import { ImagesService } from '../images/images.service'
import { toPublicMediaUrl } from '../images/images.utils'
import { StorageService } from '../storage/storage.service'

const POSITIONS = [
  'top-left',
  'top-right',
  'top-center',
  'center-left',
  'center',
  'center-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
] as const

type GridMode = 'first_frame' | 'first_last' | 'multi_ref'

type ReferenceAsset = {
  path: string
  label: string
  kind: 'scene' | 'character' | 'storyboard'
  sceneId?: number
  characterId?: number
  storyboardId?: number
  imageIndex: number
  imageLabel: string
}

type CellPrompt = {
  shot_number: number
  frame_type: 'first_frame' | 'last_frame' | 'reference'
  prompt: string
}

type GridPromptParams = {
  userId: number
  storyboardIds: number[]
  dramaId?: number
  episodeId?: number
  rows: number
  cols: number
  mode?: string
}

type GridGenerateParams = GridPromptParams & {
  customPrompt?: string
}

type GridSplitParams = {
  userId: number
  generationId?: number | null
  imageGenerationId?: number | null
  imageUrl?: string | null
  rows: number
  cols: number
  assignments: Array<{ storyboard_id?: number | null; frame_type?: string | null }>
}

function now() {
  return new Date()
}

function safeParseJsonArray(value: string | null | undefined): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.map((item) => String(item || '').trim()).filter(Boolean) : []
  } catch {
    return []
  }
}

function uniqueNumberIds(values: number[]) {
  return values.filter((value, index, array) => Number.isInteger(value) && value > 0 && array.indexOf(value) === index)
}

function posLabel(index: number, _rows: number, cols: number) {
  const row = Math.floor(index / cols)
  const col = index % cols
  const position = POSITIONS[row * 3 + col] || `row ${row + 1} col ${col + 1}`
  return position.startsWith('row') ? position : `row ${row + 1} col ${col + 1} (${position})`
}

function cellLabel(index: number, rows: number, cols: number) {
  return `格${index + 1}（${posLabel(index, rows, cols)}）`
}

function createGridCellFileName(index: number) {
  return `cell_${Date.now()}_${index}.png`
}

@Injectable()
export class GridService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly imagesService: ImagesService,
    private readonly storageService: StorageService,
  ) {}

  private parseMode(mode?: string): GridMode {
    if (!mode) return 'first_frame'
    if (mode === 'first_frame' || mode === 'first_last' || mode === 'multi_ref') return mode
    throw new BadRequestException('invalid grid mode')
  }

  private assertLayout(rows: number, cols: number) {
    if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows <= 0 || cols <= 0) {
      throw new BadRequestException('rows and cols required')
    }
  }

  private async ensureOwnedStoryboards(storyboardIds: number[], userId: number) {
    const ids = uniqueNumberIds(storyboardIds)
    if (!ids.length) {
      throw new BadRequestException('storyboard_ids required')
    }

    const rows: Array<typeof storyboards.$inferSelect> = []
    for (const storyboardId of ids) {
      rows.push(await requireOwnedStoryboard(this.databaseService, storyboardId, userId))
    }
    return rows
  }

  private async getStoryboardCharacterIdsMap(storyboardIds: number[]) {
    const map = new Map<number, number[]>()
    if (!storyboardIds.length) return map

    const links = await this.databaseService.db
      .select()
      .from(storyboardCharacters)
      .where(inArray(storyboardCharacters.storyboardId, storyboardIds))

    for (const link of links) {
      const current = map.get(link.storyboardId) || []
      current.push(link.characterId)
      map.set(link.storyboardId, current)
    }

    return map
  }

  private buildReferenceLegend(referenceAssets: ReferenceAsset[]) {
    if (!referenceAssets.length) return ''
    return referenceAssets.map((asset) => `${asset.imageLabel}=${asset.label}`).join('；')
  }

  private buildStoryboardReferenceHints(
    storyboard: typeof storyboards.$inferSelect,
    referenceAssets: ReferenceAsset[],
    storyboardCharacterIds: Map<number, number[]>,
  ) {
    const hints: string[] = []
    const characterIds = storyboardCharacterIds.get(storyboard.id) || []

    for (const asset of referenceAssets) {
      if (asset.kind === 'scene' && storyboard.sceneId && asset.sceneId === storyboard.sceneId) {
        hints.push(`${asset.imageLabel}（${asset.label}）`)
      }
      if (asset.kind === 'character' && asset.characterId && characterIds.includes(asset.characterId)) {
        hints.push(`${asset.imageLabel}（${asset.label}）`)
      }
      if (asset.kind === 'storyboard' && asset.storyboardId === storyboard.id) {
        hints.push(`${asset.imageLabel}（${asset.label}）`)
      }
    }

    return [...new Set(hints)].slice(0, 4)
  }

  private async collectGridReferenceAssets(storyboardRows: Array<typeof storyboards.$inferSelect>) {
    const storyboardIds = storyboardRows.map((storyboard) => storyboard.id)
    const storyboardCharacterIds = await this.getStoryboardCharacterIdsMap(storyboardIds)
    const sceneIds = uniqueNumberIds(storyboardRows.map((storyboard) => storyboard.sceneId || 0))
    const characterIds = uniqueNumberIds([...storyboardCharacterIds.values()].flat())

    const [sceneRows, characterRows] = await Promise.all([
      sceneIds.length
        ? this.databaseService.db
          .select()
          .from(scenes)
          .where(inArray(scenes.id, sceneIds))
        : Promise.resolve([]),
      characterIds.length
        ? this.databaseService.db
          .select()
          .from(characters)
          .where(inArray(characters.id, characterIds))
        : Promise.resolve([]),
    ])

    const assets: Array<Omit<ReferenceAsset, 'imageIndex' | 'imageLabel'>> = []
    const seen = new Set<string>()

    const pushAsset = (
      assetPath: string | null | undefined,
      label: string,
      kind: ReferenceAsset['kind'],
      extra: Pick<ReferenceAsset, 'sceneId' | 'characterId' | 'storyboardId'> = {},
    ) => {
      const normalized = String(assetPath || '').trim()
      if (!normalized || seen.has(normalized) || assets.length >= 6) return
      seen.add(normalized)
      assets.push({ path: normalized, label, kind, ...extra })
    }

    for (const storyboard of storyboardRows) {
      pushAsset(storyboard.firstFrameImage, `镜头${storyboard.storyboardNumber}首帧`, 'storyboard', { storyboardId: storyboard.id })
      pushAsset(storyboard.lastFrameImage, `镜头${storyboard.storyboardNumber}尾帧`, 'storyboard', { storyboardId: storyboard.id })
      pushAsset(storyboard.composedImage, `镜头${storyboard.storyboardNumber}镜头图`, 'storyboard', { storyboardId: storyboard.id })
      for (const referenceImage of safeParseJsonArray(storyboard.referenceImages)) {
        pushAsset(referenceImage, `镜头${storyboard.storyboardNumber}参考图`, 'storyboard', { storyboardId: storyboard.id })
      }
    }

    for (const scene of sceneRows) {
      pushAsset(scene.imageUrl, `${scene.location}${scene.time ? `（${scene.time}）` : ''}场景`, 'scene', { sceneId: scene.id })
    }

    for (const character of characterRows) {
      pushAsset(character.imageUrl, `${character.name}角色`, 'character', { characterId: character.id })
      for (const referenceImage of safeParseJsonArray(character.referenceImages)) {
        pushAsset(referenceImage, `${character.name}角色参考图`, 'character', { characterId: character.id })
      }
    }

    return assets.map((asset, index) => ({
      ...asset,
      imageIndex: index + 1,
      imageLabel: `图片${index + 1}`,
    }))
  }

  private buildGridPrompt(
    mode: GridMode,
    storyboardRows: Array<typeof storyboards.$inferSelect>,
    rows: number,
    cols: number,
    dramaStyle: string,
    referenceAssets: ReferenceAsset[],
  ) {
    const style = dramaStyle || 'cinematic'
    const legend = this.buildReferenceLegend(referenceAssets)
    const storyboardCharacterIds = new Map<number, number[]>()
    for (const asset of referenceAssets) {
      if (asset.storyboardId && !storyboardCharacterIds.has(asset.storyboardId)) {
        storyboardCharacterIds.set(asset.storyboardId, [])
      }
    }

    if (mode === 'first_frame') {
      const cells = storyboardRows.map((storyboard, index) => {
        const description = storyboard.imagePrompt || storyboard.description || storyboard.title || `shot ${index + 1}`
        const refs = this.buildStoryboardReferenceHints(storyboard, referenceAssets, storyboardCharacterIds)
        return `${cellLabel(index, rows, cols)}: ${refs.length ? `参考${refs.join('、')}，` : ''}${description}`
      })

      return [
        `${rows}x${cols} grid layout, consistent art style, ${style},`,
        legend ? `参考图映射：${legend}` : '',
        '当画面涉及角色或场景时，优先使用对应的图片编号来约束一致性。',
        ...cells,
        'high quality, cinematic lighting, no text, no watermark',
      ].filter(Boolean).join('\n')
    }

    if (mode === 'first_last') {
      const totalCells = rows * cols
      const cells = Array.from({ length: totalCells }, (_, index) => {
        const storyboard = storyboardRows[index % storyboardRows.length]
        const description = storyboard.imagePrompt || storyboard.description || storyboard.title || `shot ${index + 1}`
        const action = storyboard.action || storyboard.movement || ''
        const refs = this.buildStoryboardReferenceHints(storyboard, referenceAssets, storyboardCharacterIds)
        const frameHint = index % 2 === 0 ? 'opening moment' : `${action ? `${action}, ` : ''}closing moment, subtle motion change`
        return `${cellLabel(index, rows, cols)}: ${refs.length ? `参考${refs.join('、')}，` : ''}${description}, ${frameHint}`
      })

      return [
        `${rows}x${cols} grid layout, consistent art style, ${style},`,
        legend ? `参考图映射：${legend}` : '',
        'first/last frame visual rhythm, alternating opening and closing beats across the grid,',
        ...cells,
        'continuous motion implied between left and right, high quality, no text',
      ].filter(Boolean).join('\n')
    }

    const storyboard = storyboardRows[0]
    const description = storyboard.imagePrompt || storyboard.description || storyboard.title || 'scene'
    const angles = [
      'wide establishing shot',
      'medium shot character focus',
      'close-up detail',
      'dramatic low angle',
      'over-the-shoulder view',
      'bird eye view',
      'side profile',
      'atmospheric detail',
      'extreme close-up',
      'dutch angle',
      'silhouette shot',
      'depth of field focus',
      'symmetrical composition',
      'leading lines',
      'negative space',
      'high angle looking down',
      'ground level',
      'panoramic wide',
      'intimate two-shot',
      'reflection shot',
      'shadow play',
      'backlit silhouette',
      'macro detail',
      'split lighting',
      'rim light portrait',
    ]
    const totalCells = rows * cols
    const cells = Array.from({ length: totalCells }, (_, index) => (
      `${cellLabel(index, rows, cols)}: ${legend ? `参考${legend}，` : ''}${description}, ${angles[index % angles.length]}`
    ))

    return [
      `${rows}x${cols} grid layout, same scene different angles and compositions, ${style},`,
      legend ? `参考图映射：${legend}` : '',
      `main scene: ${description},`,
      ...cells,
      'consistent lighting and color palette, high quality, no text',
    ].filter(Boolean).join('\n')
  }

  private async buildGridCellPrompts(
    mode: GridMode,
    storyboardRows: Array<typeof storyboards.$inferSelect>,
    rows: number,
    cols: number,
    referenceAssets: ReferenceAsset[],
  ) {
    const storyboardCharacterIds = await this.getStoryboardCharacterIdsMap(storyboardRows.map((storyboard) => storyboard.id))

    if (mode === 'multi_ref') {
      const storyboard = storyboardRows[0]
      const description = storyboard.imagePrompt || storyboard.description || storyboard.title || 'scene'
      const angles = [
        'wide establishing shot',
        'medium shot character focus',
        'close-up detail',
        'dramatic low angle',
        'over-the-shoulder view',
        'bird eye view',
        'side profile',
        'atmospheric detail',
        'extreme close-up',
        'dutch angle',
        'silhouette shot',
        'depth of field focus',
        'symmetrical composition',
        'leading lines',
        'negative space',
        'high angle looking down',
        'ground level',
        'panoramic wide',
        'intimate two-shot',
        'reflection shot',
        'shadow play',
        'backlit silhouette',
        'macro detail',
        'split lighting',
        'rim light portrait',
      ]

      return Array.from({ length: rows * cols }, (_, index) => {
        const refs = this.buildStoryboardReferenceHints(storyboard, referenceAssets, storyboardCharacterIds)
        return {
          shot_number: storyboard.storyboardNumber,
          frame_type: 'reference' as const,
          prompt: `${cellLabel(index, rows, cols)}: ${refs.join('、')}${refs.length ? '，' : ''}${description}, ${angles[index % angles.length]}`,
        }
      })
    }

    if (mode === 'first_last') {
      return Array.from({ length: rows * cols }, (_, index) => {
        const storyboard = storyboardRows[index % storyboardRows.length]
        const description = storyboard.imagePrompt || storyboard.description || storyboard.title || `shot ${storyboard.storyboardNumber || ''}`
        const motion = storyboard.action || storyboard.movement || ''
        const refs = this.buildStoryboardReferenceHints(storyboard, referenceAssets, storyboardCharacterIds)
        const isFirst = index % 2 === 0
        return {
          shot_number: storyboard.storyboardNumber,
          frame_type: isFirst ? 'first_frame' as const : 'last_frame' as const,
          prompt: isFirst
            ? `${cellLabel(index, rows, cols)}，首帧：${refs.length ? `参考${refs.join('、')}，` : ''}${description}${storyboard.location ? `, ${storyboard.location}` : ''}${storyboard.shotType ? `, ${storyboard.shotType}` : ''}`
            : `${cellLabel(index, rows, cols)}，尾帧：${refs.length ? `参考${refs.join('、')}，` : ''}${description}${motion ? `, ${motion}` : ''}${storyboard.location ? `, ${storyboard.location}` : ''}${storyboard.shotType ? `, ${storyboard.shotType}` : ''}`,
        }
      })
    }

    return storyboardRows.slice(0, rows * cols).map((storyboard, index) => {
      const description = storyboard.imagePrompt || storyboard.description || storyboard.title || `shot ${storyboard.storyboardNumber || ''}`
      const refs = this.buildStoryboardReferenceHints(storyboard, referenceAssets, storyboardCharacterIds)
      return {
        shot_number: storyboard.storyboardNumber,
        frame_type: 'first_frame' as const,
        prompt: `${cellLabel(index, rows, cols)}：${refs.length ? `参考${refs.join('、')}，` : ''}${description}${storyboard.location ? `, ${storyboard.location}` : ''}${storyboard.shotType ? `, ${storyboard.shotType}` : ''}, opening scene`,
      }
    })
  }

  private async resolveDramaStyle(dramaId?: number) {
    if (!dramaId) return ''
    const [drama] = await this.databaseService.db
      .select()
      .from(dramas)
      .where(eq(dramas.id, dramaId))
    return drama?.style || ''
  }

  private async loadOwnedOrLegacyGridGeneration(id: number, userId: number) {
    const [generation] = await this.databaseService.db
      .select()
      .from(imageGenerations)
      .where(and(eq(imageGenerations.id, id), eq(imageGenerations.userId, userId)))
    if (generation) return generation

    const [legacyGeneration] = await this.databaseService.db
      .select()
      .from(imageGenerations)
      .where(and(eq(imageGenerations.id, id), isNull(imageGenerations.userId)))
    if (!legacyGeneration?.frameType?.startsWith('grid_')) return null

    await this.databaseService.db
      .update(imageGenerations)
      .set({ userId, updatedAt: now() })
      .where(and(eq(imageGenerations.id, id), isNull(imageGenerations.userId)))

    return { ...legacyGeneration, userId }
  }

  async buildGridPromptPayload(params: GridPromptParams) {
    const mode = this.parseMode(params.mode)
    this.assertLayout(params.rows, params.cols)

    const storyboardRows = await this.ensureOwnedStoryboards(params.storyboardIds, params.userId)
    if (params.episodeId) {
      await requireOwnedEpisode(this.databaseService, params.episodeId, params.userId)
    }

    const dramaStyle = await this.resolveDramaStyle(params.dramaId)
    const referenceAssets = await this.collectGridReferenceAssets(storyboardRows)
    const gridPrompt = this.buildGridPrompt(mode, storyboardRows, params.rows, params.cols, dramaStyle, referenceAssets)
    const cellPrompts = await this.buildGridCellPrompts(mode, storyboardRows, params.rows, params.cols, referenceAssets)

    return {
      grid_prompt: gridPrompt,
      cell_prompts: cellPrompts,
      source: 'fallback',
      grid: { rows: params.rows, cols: params.cols },
      storyboard_ids: uniqueNumberIds(params.storyboardIds),
      mode,
    }
  }

  async generateGridImage(params: GridGenerateParams) {
    const mode = this.parseMode(params.mode)
    this.assertLayout(params.rows, params.cols)

    const storyboardRows = await this.ensureOwnedStoryboards(params.storyboardIds, params.userId)
    if (params.episodeId) {
      await requireOwnedEpisode(this.databaseService, params.episodeId, params.userId)
    }

    const dramaStyle = await this.resolveDramaStyle(params.dramaId)
    const referenceAssets = await this.collectGridReferenceAssets(storyboardRows)
    const prompt = String(params.customPrompt || '').trim()
      || this.buildGridPrompt(mode, storyboardRows, params.rows, params.cols, dramaStyle, referenceAssets)
    const referenceImages = referenceAssets.map((asset) => asset.path)
    const size = `${960 * params.cols}x${540 * params.rows}`

    const generationId = await this.imagesService.generateImage({
      userId: params.userId,
      dramaId: params.dramaId,
      prompt,
      size,
      frameType: `grid_${mode}_${params.rows}x${params.cols}`,
      referenceImages,
      taskPayload: {
        storyboard_ids: uniqueNumberIds(params.storyboardIds),
        drama_id: params.dramaId,
        episode_id: params.episodeId,
        rows: params.rows,
        cols: params.cols,
        mode,
        custom_prompt: params.customPrompt || null,
      },
    })

    return {
      image_generation_id: generationId,
      grid: { rows: params.rows, cols: params.cols },
      mode,
      storyboard_ids: uniqueNumberIds(params.storyboardIds),
      prompt,
      reference_images: referenceImages,
    }
  }

  async getGridGenerationStatus(id: number, userId: number) {
    const row = await this.loadOwnedOrLegacyGridGeneration(id, userId)
    if (!row) {
      throw new NotFoundException('image_generation_not_found')
    }

    return {
      id: row.id,
      status: row.status,
      image_url: row.imageUrl,
      error_msg: row.errorMsg,
    }
  }

  private async splitGridImage(imagePath: string, rows: number, cols: number) {
    const absolutePath = await this.storageService.ensureLocalFile(imagePath)
    const image = sharp(absolutePath)
    const metadata = await image.metadata()
    if (!metadata.width || !metadata.height) {
      throw new Error('Cannot read image dimensions')
    }

    const cellWidth = Math.floor(metadata.width / cols)
    const cellHeight = Math.floor(metadata.height / rows)
    const dataDir = getAbsolutePath(this.storageService, 'grid-cells')
    fs.mkdirSync(dataDir, { recursive: true })

    const results: Array<{ index: number; url: string }> = []
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const index = row * cols + col
        const fileName = createGridCellFileName(index)
        const outputPath = path.join(dataDir, fileName)

        await sharp(absolutePath)
          .extract({
            left: col * cellWidth,
            top: row * cellHeight,
            width: cellWidth,
            height: cellHeight,
          })
          .toFile(outputPath)

        const buffer = fs.readFileSync(outputPath)
        const storedImage = await this.storageService.saveBuffer({
          buffer,
          subDir: 'grid-cells',
          fileName,
          extension: '.png',
          mimeType: 'image/png',
        })

        results.push({
          index,
          url: storedImage.url,
        })
      }
    }

    return results
  }

  async splitGeneratedGrid(params: GridSplitParams) {
    this.assertLayout(params.rows, params.cols)

    const generationId = params.generationId ?? params.imageGenerationId ?? null
    if (!generationId && !params.imageUrl) {
      throw new BadRequestException('image_generation_id or image_url required')
    }
    if (!params.assignments.length) {
      throw new BadRequestException('assignments required')
    }

    let record: typeof imageGenerations.$inferSelect | null = null
    if (generationId) {
      record = await this.loadOwnedOrLegacyGridGeneration(generationId, params.userId)
      if (!record) {
        throw new NotFoundException('image_generation_not_found')
      }
      if (record.status !== 'completed') {
        throw new BadRequestException(`Image status: ${record.status}`)
      }
      if (!record.imageUrl) {
        throw new BadRequestException('No image source')
      }
    }

    const sourcePath = String(params.imageUrl || record?.imageUrl || '').trim()
    if (!sourcePath) {
      throw new BadRequestException('No image source')
    }

    const cells = await this.splitGridImage(sourcePath, params.rows, params.cols)
    const results: Array<{ storyboard_id: number; frame_type: string; image_url: string }> = []

    for (let index = 0; index < params.assignments.length && index < cells.length; index += 1) {
      const assignment = params.assignments[index]
      const storyboardId = Number(assignment.storyboard_id || 0)
      if (!storyboardId) continue

      const storyboard = await requireOwnedStoryboard(this.databaseService, storyboardId, params.userId)
      const frameType = String(assignment.frame_type || 'reference')
      const cell = cells[index]
      const updates: Partial<typeof storyboards.$inferInsert> = {
        updatedAt: now(),
      }

      if (frameType === 'first_frame') {
        updates.firstFrameImage = cell.url
      } else if (frameType === 'last_frame') {
        updates.lastFrameImage = cell.url
      } else {
        const existing = safeParseJsonArray(storyboard.referenceImages)
        updates.referenceImages = JSON.stringify([...new Set([...existing, cell.url])])
      }

      await this.databaseService.db
        .update(storyboards)
        .set(updates)
        .where(eq(storyboards.id, storyboardId))

      results.push({
        storyboard_id: storyboardId,
        frame_type: frameType,
        image_url: cell.url,
      })
    }

    return { cells: results }
  }
}
