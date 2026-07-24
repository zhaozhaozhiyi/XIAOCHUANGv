import 'reflect-metadata'
import 'dotenv/config'

import { and, eq, isNotNull, isNull } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'

import { loadEnv } from './config/env'
import * as schema from './db/schema'

type CliOptions = {
  dryRun: boolean
}

type AssetRow = typeof schema.assets.$inferSelect

type TargetMatch = {
  targetType: 'storyboard' | 'episode' | 'character' | 'scene'
  targetId: string
  targetField: string
  role: string
}

type LinkPlan = {
  asset: AssetRow
  scope: 'project' | 'episode' | 'storyboard'
  role: string
  targetType: string | null
  targetId: string | null
  targetField: string | null
  reason: string
}

type BackfillReport = {
  ok: true
  dry_run: boolean
  scanned: number
  eligible: number
  linked: number
  skipped: number
  skipped_existing_link: number
  skipped_missing_url: number
  items: Array<{
    asset_id: number
    drama_id: number
    user_id: number | null
    scope: string
    role: string
    target_type: string | null
    target_id: string | null
    target_field: string | null
    reason: string
  }>
  skipped_items: Array<{
    asset_id: number
    drama_id: number | null
    reason: string
  }>
}

function hasFlag(flag: string) {
  return process.argv.includes(flag)
}

function parseArgs(): CliOptions {
  return {
    dryRun: hasFlag('--dry-run'),
  }
}

function cleanUrl(value: string | null | undefined) {
  return String(value || '').trim()
}

function sameUrl(left: string | null | undefined, right: string | null | undefined) {
  const cleanLeft = cleanUrl(left)
  const cleanRight = cleanUrl(right)
  return Boolean(cleanLeft && cleanRight && cleanLeft === cleanRight)
}

function inferScope(asset: AssetRow): LinkPlan['scope'] {
  if (asset.storyboardId) return 'storyboard'
  if (asset.episodeId) return 'episode'
  return 'project'
}

function roleFromTargetField(field: string) {
  switch (field) {
    case 'firstFrameImage':
      return 'first_frame'
    case 'lastFrameImage':
      return 'last_frame'
    case 'videoUrl':
      return 'shot_video'
    case 'ttsAudioUrl':
      return 'voiceover'
    case 'composedVideoUrl':
      return 'composed_video'
    case 'thumbnail':
      return 'episode_thumbnail'
    case 'imageUrl':
      return 'reference_image'
    case 'voiceSampleUrl':
      return 'voice_sample'
    default:
      return 'reference'
  }
}

function inferRole(asset: AssetRow, target: TargetMatch | null) {
  if (target) return target.role
  const sourceType = asset.sourceType.toLowerCase()
  if (sourceType.includes('character')) return 'character_portrait'
  if (sourceType.includes('scene')) return 'scene_image'
  if (sourceType.includes('tts') || asset.kind === 'audio') return 'voiceover'
  if (sourceType.includes('compose')) return 'composed_video'
  if (asset.kind === 'video') return asset.storyboardId ? 'shot_video' : 'episode_video'
  if (asset.kind === 'image' && asset.storyboardId) return 'first_frame'
  return 'reference'
}

function buildPlan(asset: AssetRow, target: TargetMatch | null): LinkPlan {
  return {
    asset,
    scope: inferScope(asset),
    role: inferRole(asset, target),
    targetType: target?.targetType ?? null,
    targetId: target?.targetId ?? null,
    targetField: target?.targetField ?? null,
    reason: target ? 'url_matched_target_field' : 'scoped_legacy_asset',
  }
}

async function findExistingLink(db: ReturnType<typeof drizzle>, asset: AssetRow) {
  const [existing] = await db
    .select({ id: schema.dramaAssetLinks.id })
    .from(schema.dramaAssetLinks)
    .where(
      and(
        eq(schema.dramaAssetLinks.assetId, asset.id),
        eq(schema.dramaAssetLinks.dramaId, asset.dramaId || 0),
        isNull(schema.dramaAssetLinks.deletedAt),
      ),
    )
    .limit(1)

  return existing ?? null
}

async function matchStoryboardTarget(db: ReturnType<typeof drizzle>, asset: AssetRow): Promise<TargetMatch | null> {
  if (!asset.storyboardId) return null
  const [storyboard] = await db
    .select({
      id: schema.storyboards.id,
      composedImage: schema.storyboards.composedImage,
      firstFrameImage: schema.storyboards.firstFrameImage,
      lastFrameImage: schema.storyboards.lastFrameImage,
      videoUrl: schema.storyboards.videoUrl,
      ttsAudioUrl: schema.storyboards.ttsAudioUrl,
      composedVideoUrl: schema.storyboards.composedVideoUrl,
    })
    .from(schema.storyboards)
    .where(and(eq(schema.storyboards.id, asset.storyboardId), isNull(schema.storyboards.deletedAt)))
    .limit(1)

  if (!storyboard) return null

  const fields: Array<{ field: string; url: string | null; role?: string }> = [
    { field: 'firstFrameImage', url: storyboard.firstFrameImage, role: 'first_frame' },
    { field: 'lastFrameImage', url: storyboard.lastFrameImage, role: 'last_frame' },
    { field: 'videoUrl', url: storyboard.videoUrl, role: 'shot_video' },
    { field: 'ttsAudioUrl', url: storyboard.ttsAudioUrl, role: 'voiceover' },
    { field: 'composedVideoUrl', url: storyboard.composedVideoUrl, role: 'composed_video' },
    { field: 'composedImage', url: storyboard.composedImage, role: 'composed_image' },
  ]

  const matched = fields.find((field) => sameUrl(field.url, asset.url))
  if (!matched) return null
  return {
    targetType: 'storyboard',
    targetId: String(storyboard.id),
    targetField: matched.field,
    role: matched.role ?? roleFromTargetField(matched.field),
  }
}

async function matchEpisodeTarget(db: ReturnType<typeof drizzle>, asset: AssetRow): Promise<TargetMatch | null> {
  if (!asset.episodeId) return null
  const [episode] = await db
    .select({
      id: schema.episodes.id,
      videoUrl: schema.episodes.videoUrl,
      thumbnail: schema.episodes.thumbnail,
    })
    .from(schema.episodes)
    .where(and(eq(schema.episodes.id, asset.episodeId), isNull(schema.episodes.deletedAt)))
    .limit(1)

  if (!episode) return null
  const fields = [
    { field: 'videoUrl', url: episode.videoUrl, role: 'episode_video' },
    { field: 'thumbnail', url: episode.thumbnail, role: 'episode_thumbnail' },
  ]
  const matched = fields.find((field) => sameUrl(field.url, asset.url))
  if (!matched) return null
  return {
    targetType: 'episode',
    targetId: String(episode.id),
    targetField: matched.field,
    role: matched.role,
  }
}

async function matchCharacterTarget(db: ReturnType<typeof drizzle>, asset: AssetRow): Promise<TargetMatch | null> {
  if (!asset.sourceId || !asset.sourceType.toLowerCase().includes('character')) return null
  const [character] = await db
    .select({
      id: schema.characters.id,
      imageUrl: schema.characters.imageUrl,
      voiceSampleUrl: schema.characters.voiceSampleUrl,
    })
    .from(schema.characters)
    .where(and(eq(schema.characters.id, asset.sourceId), isNull(schema.characters.deletedAt)))
    .limit(1)

  if (!character) return null
  const fields = [
    { field: 'imageUrl', url: character.imageUrl, role: 'character_portrait' },
    { field: 'voiceSampleUrl', url: character.voiceSampleUrl, role: 'voice_sample' },
  ]
  const matched = fields.find((field) => sameUrl(field.url, asset.url))
  if (!matched) return null
  return {
    targetType: 'character',
    targetId: String(character.id),
    targetField: matched.field,
    role: matched.role,
  }
}

async function matchSceneTarget(db: ReturnType<typeof drizzle>, asset: AssetRow): Promise<TargetMatch | null> {
  if (!asset.sourceId || !asset.sourceType.toLowerCase().includes('scene')) return null
  const [scene] = await db
    .select({
      id: schema.scenes.id,
      imageUrl: schema.scenes.imageUrl,
    })
    .from(schema.scenes)
    .where(and(eq(schema.scenes.id, asset.sourceId), isNull(schema.scenes.deletedAt)))
    .limit(1)

  if (!scene || !sameUrl(scene.imageUrl, asset.url)) return null
  return {
    targetType: 'scene',
    targetId: String(scene.id),
    targetField: 'imageUrl',
    role: 'scene_image',
  }
}

async function matchTarget(db: ReturnType<typeof drizzle>, asset: AssetRow): Promise<TargetMatch | null> {
  return (
    (await matchStoryboardTarget(db, asset)) ||
    (await matchEpisodeTarget(db, asset)) ||
    (await matchCharacterTarget(db, asset)) ||
    (await matchSceneTarget(db, asset))
  )
}

async function insertLink(db: ReturnType<typeof drizzle>, plan: LinkPlan) {
  const now = new Date()
  const asset = plan.asset
  await db.insert(schema.dramaAssetLinks).values({
    userId: asset.userId,
    dramaId: asset.dramaId || 0,
    episodeId: asset.episodeId,
    storyboardId: asset.storyboardId,
    assetId: asset.id,
    scope: plan.scope,
    status: 'legacy_mainline',
    role: plan.role,
    targetType: plan.targetType,
    targetId: plan.targetId,
    targetField: plan.targetField,
    sourceModule: 'legacy_backfill',
    sourceTaskId: asset.taskId,
    metadataJson: JSON.stringify({
      backfill_version: 1,
      legacy: true,
      original_source_type: asset.sourceType,
      original_source_id: asset.sourceId,
      reason: plan.reason,
    }),
    createdAt: now,
    updatedAt: now,
  })
}

async function main() {
  const options = parseArgs()
  const env = loadEnv()
  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: 4,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 2_000,
  })
  const db = drizzle(pool, { schema })

  const report: BackfillReport = {
    ok: true,
    dry_run: options.dryRun,
    scanned: 0,
    eligible: 0,
    linked: 0,
    skipped: 0,
    skipped_existing_link: 0,
    skipped_missing_url: 0,
    items: [],
    skipped_items: [],
  }

  try {
    const rows = await db
      .select()
      .from(schema.assets)
      .where(and(isNotNull(schema.assets.dramaId), isNull(schema.assets.deletedAt)))

    report.scanned = rows.length

    for (const asset of rows) {
      const dramaId = asset.dramaId
      if (!dramaId) continue

      if (!cleanUrl(asset.url)) {
        report.skipped += 1
        report.skipped_missing_url += 1
        report.skipped_items.push({ asset_id: asset.id, drama_id: dramaId, reason: 'missing_url' })
        continue
      }

      const existingLink = await findExistingLink(db, asset)
      if (existingLink) {
        report.skipped += 1
        report.skipped_existing_link += 1
        report.skipped_items.push({ asset_id: asset.id, drama_id: dramaId, reason: 'existing_link' })
        continue
      }

      const plan = buildPlan(asset, await matchTarget(db, asset))
      report.eligible += 1
      report.items.push({
        asset_id: asset.id,
        drama_id: dramaId,
        user_id: asset.userId,
        scope: plan.scope,
        role: plan.role,
        target_type: plan.targetType,
        target_id: plan.targetId,
        target_field: plan.targetField,
        reason: plan.reason,
      })

      if (!options.dryRun) {
        await insertLink(db, plan)
      }
      report.linked += 1
    }

    console.log(JSON.stringify(report, null, 2))
  } finally {
    await pool.end()
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
