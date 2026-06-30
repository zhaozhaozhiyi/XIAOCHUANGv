import 'reflect-metadata'

import { eq, isNull } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'

import { toPublicMediaUrl } from './common/media-url'
import { loadEnv } from './config/env'
import {
  assets,
  characters,
  imageGenerations,
  props,
  scenes,
  videoGenerations,
} from './db/schema'

type CliOptions = {
  dryRun: boolean
  clearLocalPath: boolean
}

type BackfillResult = {
  label: string
  scanned: number
  eligible: number
  updated: number
  alreadyPresent: number
  missingSource: number
  urlBackfilled: number
  localPathPresent: number
  localPathCleared: number
}

function parseArgs(): CliOptions {
  const args = new Set(process.argv.slice(2))
  return {
    dryRun: args.has('--dry-run'),
    clearLocalPath: args.has('--clear-local-path'),
  }
}

function now() {
  return new Date()
}

async function main() {
  const env = loadEnv()
  const options = parseArgs()
  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: 4,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 2_000,
  })
  const db = drizzle(pool)

  try {
    const results: BackfillResult[] = []
    results.push(await backfillCharacters(db, env.STORAGE_PUBLIC_BASE_URL, options))
    results.push(await backfillScenes(db, env.STORAGE_PUBLIC_BASE_URL, options))
    results.push(await backfillProps(db, env.STORAGE_PUBLIC_BASE_URL, options))
    results.push(await backfillImageGenerations(db, env.STORAGE_PUBLIC_BASE_URL, options))
    results.push(await backfillVideoGenerations(db, env.STORAGE_PUBLIC_BASE_URL, options))
    results.push(await backfillAssets(db, env.STORAGE_PUBLIC_BASE_URL, options))

    const scanned = results.reduce((sum, item) => sum + item.scanned, 0)
    const eligible = results.reduce((sum, item) => sum + item.eligible, 0)
    const updated = results.reduce((sum, item) => sum + item.updated, 0)
    const alreadyPresent = results.reduce((sum, item) => sum + item.alreadyPresent, 0)
    const missingSource = results.reduce((sum, item) => sum + item.missingSource, 0)
    const urlBackfilled = results.reduce((sum, item) => sum + item.urlBackfilled, 0)
    const localPathPresent = results.reduce((sum, item) => sum + item.localPathPresent, 0)
    const localPathCleared = results.reduce((sum, item) => sum + item.localPathCleared, 0)

    console.log(
      JSON.stringify(
        {
          dry_run: options.dryRun,
          clear_local_path: options.clearLocalPath,
          scanned,
          eligible,
          updated,
          already_present: alreadyPresent,
          missing_source: missingSource,
          url_backfilled: urlBackfilled,
          local_path_present: localPathPresent,
          local_path_cleared: localPathCleared,
          tables: results,
        },
        null,
        2,
      ),
    )
  } finally {
    await pool.end()
  }
}

async function backfillCharacters(db: ReturnType<typeof drizzle>, publicBaseUrl: string | undefined, options: CliOptions) {
  const rows = await db
    .select({
      id: characters.id,
      imageUrl: characters.imageUrl,
      localPath: characters.localPath,
    })
    .from(characters)
    .where(isNull(characters.deletedAt))

  const scanned = rows.length
  let eligible = 0
  let updated = 0
  let alreadyPresent = 0
  let missingSource = 0
  let urlBackfilled = 0
  let localPathPresent = 0
  let localPathCleared = 0

  for (const row of rows) {
    const hasImageUrl = String(row.imageUrl || '').trim()
    const hasLocalPath = String(row.localPath || '').trim()
    if (hasLocalPath) localPathPresent += 1

    if (hasImageUrl) {
      alreadyPresent += 1
      if (options.clearLocalPath && hasLocalPath) {
        updated += 1
        localPathCleared += 1
        if (!options.dryRun) {
          await db
            .update(characters)
            .set({
              localPath: null,
              updatedAt: now(),
            })
            .where(eq(characters.id, row.id))
        }
      }
      continue
    }
    const publicUrl = toPublicMediaUrl(row.localPath, publicBaseUrl)
    if (!publicUrl) {
      missingSource += 1
      continue
    }
    eligible += 1
    urlBackfilled += 1
    updated += 1
    if (options.clearLocalPath && hasLocalPath) {
      localPathCleared += 1
    }
    if (options.dryRun) continue

    await db
      .update(characters)
      .set({
        imageUrl: publicUrl,
        localPath: options.clearLocalPath ? null : row.localPath,
        updatedAt: now(),
      })
      .where(eq(characters.id, row.id))
  }

  return { label: 'characters', scanned, eligible, updated, alreadyPresent, missingSource, urlBackfilled, localPathPresent, localPathCleared }
}

async function backfillScenes(db: ReturnType<typeof drizzle>, publicBaseUrl: string | undefined, options: CliOptions) {
  const rows = await db
    .select({
      id: scenes.id,
      imageUrl: scenes.imageUrl,
      localPath: scenes.localPath,
    })
    .from(scenes)
    .where(isNull(scenes.deletedAt))

  const scanned = rows.length
  let eligible = 0
  let updated = 0
  let alreadyPresent = 0
  let missingSource = 0
  let urlBackfilled = 0
  let localPathPresent = 0
  let localPathCleared = 0

  for (const row of rows) {
    const hasImageUrl = String(row.imageUrl || '').trim()
    const hasLocalPath = String(row.localPath || '').trim()
    if (hasLocalPath) localPathPresent += 1

    if (hasImageUrl) {
      alreadyPresent += 1
      if (options.clearLocalPath && hasLocalPath) {
        updated += 1
        localPathCleared += 1
        if (!options.dryRun) {
          await db
            .update(scenes)
            .set({
              localPath: null,
              updatedAt: now(),
            })
            .where(eq(scenes.id, row.id))
        }
      }
      continue
    }
    const publicUrl = toPublicMediaUrl(row.localPath, publicBaseUrl)
    if (!publicUrl) {
      missingSource += 1
      continue
    }
    eligible += 1
    urlBackfilled += 1
    updated += 1
    if (options.clearLocalPath && hasLocalPath) {
      localPathCleared += 1
    }
    if (options.dryRun) continue

    await db
      .update(scenes)
      .set({
        imageUrl: publicUrl,
        localPath: options.clearLocalPath ? null : row.localPath,
        updatedAt: now(),
      })
      .where(eq(scenes.id, row.id))
  }

  return { label: 'scenes', scanned, eligible, updated, alreadyPresent, missingSource, urlBackfilled, localPathPresent, localPathCleared }
}

async function backfillProps(db: ReturnType<typeof drizzle>, publicBaseUrl: string | undefined, options: CliOptions) {
  const rows = await db
    .select({
      id: props.id,
      imageUrl: props.imageUrl,
      localPath: props.localPath,
    })
    .from(props)
    .where(isNull(props.deletedAt))

  const scanned = rows.length
  let eligible = 0
  let updated = 0
  let alreadyPresent = 0
  let missingSource = 0
  let urlBackfilled = 0
  let localPathPresent = 0
  let localPathCleared = 0

  for (const row of rows) {
    const hasImageUrl = String(row.imageUrl || '').trim()
    const hasLocalPath = String(row.localPath || '').trim()
    if (hasLocalPath) localPathPresent += 1

    if (hasImageUrl) {
      alreadyPresent += 1
      if (options.clearLocalPath && hasLocalPath) {
        updated += 1
        localPathCleared += 1
        if (!options.dryRun) {
          await db
            .update(props)
            .set({
              localPath: null,
              updatedAt: now(),
            })
            .where(eq(props.id, row.id))
        }
      }
      continue
    }
    const publicUrl = toPublicMediaUrl(row.localPath, publicBaseUrl)
    if (!publicUrl) {
      missingSource += 1
      continue
    }
    eligible += 1
    urlBackfilled += 1
    updated += 1
    if (options.clearLocalPath && hasLocalPath) {
      localPathCleared += 1
    }
    if (options.dryRun) continue

    await db
      .update(props)
      .set({
        imageUrl: publicUrl,
        localPath: options.clearLocalPath ? null : row.localPath,
        updatedAt: now(),
      })
      .where(eq(props.id, row.id))
  }

  return { label: 'props', scanned, eligible, updated, alreadyPresent, missingSource, urlBackfilled, localPathPresent, localPathCleared }
}

async function backfillImageGenerations(db: ReturnType<typeof drizzle>, publicBaseUrl: string | undefined, options: CliOptions) {
  const rows = await db
    .select({
      id: imageGenerations.id,
      imageUrl: imageGenerations.imageUrl,
      minioUrl: imageGenerations.minioUrl,
      localPath: imageGenerations.localPath,
    })
    .from(imageGenerations)

  const scanned = rows.length
  let eligible = 0
  let updated = 0
  let alreadyPresent = 0
  let missingSource = 0
  let urlBackfilled = 0
  let localPathPresent = 0
  let localPathCleared = 0

  for (const row of rows) {
    const hasImageUrl = String(row.imageUrl || '').trim()
    const hasMinioUrl = String(row.minioUrl || '').trim()
    const hasLocalPath = String(row.localPath || '').trim()
    if (hasLocalPath) localPathPresent += 1

    if (hasImageUrl && hasMinioUrl) {
      alreadyPresent += 1
      if (options.clearLocalPath && hasLocalPath) {
        updated += 1
        localPathCleared += 1
        if (!options.dryRun) {
          await db
            .update(imageGenerations)
            .set({
              localPath: null,
              updatedAt: now(),
            })
            .where(eq(imageGenerations.id, row.id))
        }
      }
      continue
    }
    const publicUrl = hasImageUrl || hasMinioUrl || toPublicMediaUrl(row.localPath, publicBaseUrl)
    if (!publicUrl) {
      missingSource += 1
      continue
    }
    eligible += 1
    urlBackfilled += 1
    updated += 1
    if (options.clearLocalPath && hasLocalPath) {
      localPathCleared += 1
    }
    if (options.dryRun) continue

    await db
      .update(imageGenerations)
      .set({
        imageUrl: hasImageUrl || publicUrl,
        minioUrl: hasMinioUrl || publicUrl,
        localPath: options.clearLocalPath ? null : row.localPath,
        updatedAt: now(),
      })
      .where(eq(imageGenerations.id, row.id))
  }

  return { label: 'image_generations', scanned, eligible, updated, alreadyPresent, missingSource, urlBackfilled, localPathPresent, localPathCleared }
}

async function backfillVideoGenerations(db: ReturnType<typeof drizzle>, publicBaseUrl: string | undefined, options: CliOptions) {
  const rows = await db
    .select({
      id: videoGenerations.id,
      videoUrl: videoGenerations.videoUrl,
      minioUrl: videoGenerations.minioUrl,
      localPath: videoGenerations.localPath,
    })
    .from(videoGenerations)
    .where(isNull(videoGenerations.deletedAt))

  const scanned = rows.length
  let eligible = 0
  let updated = 0
  let alreadyPresent = 0
  let missingSource = 0
  let urlBackfilled = 0
  let localPathPresent = 0
  let localPathCleared = 0

  for (const row of rows) {
    const hasVideoUrl = String(row.videoUrl || '').trim()
    const hasMinioUrl = String(row.minioUrl || '').trim()
    const hasLocalPath = String(row.localPath || '').trim()
    if (hasLocalPath) localPathPresent += 1

    if (hasVideoUrl && hasMinioUrl) {
      alreadyPresent += 1
      if (options.clearLocalPath && hasLocalPath) {
        updated += 1
        localPathCleared += 1
        if (!options.dryRun) {
          await db
            .update(videoGenerations)
            .set({
              localPath: null,
              updatedAt: now(),
            })
            .where(eq(videoGenerations.id, row.id))
        }
      }
      continue
    }
    const publicUrl = hasVideoUrl || hasMinioUrl || toPublicMediaUrl(row.localPath, publicBaseUrl)
    if (!publicUrl) {
      missingSource += 1
      continue
    }
    eligible += 1
    urlBackfilled += 1
    updated += 1
    if (options.clearLocalPath && hasLocalPath) {
      localPathCleared += 1
    }
    if (options.dryRun) continue

    await db
      .update(videoGenerations)
      .set({
        videoUrl: hasVideoUrl || publicUrl,
        minioUrl: hasMinioUrl || publicUrl,
        localPath: options.clearLocalPath ? null : row.localPath,
        updatedAt: now(),
      })
      .where(eq(videoGenerations.id, row.id))
  }

  return { label: 'video_generations', scanned, eligible, updated, alreadyPresent, missingSource, urlBackfilled, localPathPresent, localPathCleared }
}

async function backfillAssets(db: ReturnType<typeof drizzle>, publicBaseUrl: string | undefined, options: CliOptions) {
  const rows = await db
    .select({
      id: assets.id,
      url: assets.url,
      localPath: assets.localPath,
    })
    .from(assets)
    .where(isNull(assets.deletedAt))

  const scanned = rows.length
  let eligible = 0
  let updated = 0
  let alreadyPresent = 0
  let missingSource = 0
  let urlBackfilled = 0
  let localPathPresent = 0
  let localPathCleared = 0

  for (const row of rows) {
    const hasUrl = String(row.url || '').trim()
    const hasLocalPath = String(row.localPath || '').trim()
    if (hasLocalPath) localPathPresent += 1

    if (hasUrl) {
      alreadyPresent += 1
      if (options.clearLocalPath && hasLocalPath) {
        updated += 1
        localPathCleared += 1
        if (!options.dryRun) {
          await db
            .update(assets)
            .set({
              localPath: null,
              updatedAt: now(),
            })
            .where(eq(assets.id, row.id))
        }
      }
      continue
    }
    const publicUrl = toPublicMediaUrl(row.localPath, publicBaseUrl)
    if (!publicUrl) {
      missingSource += 1
      continue
    }
    eligible += 1
    urlBackfilled += 1
    updated += 1
    if (options.clearLocalPath && hasLocalPath) {
      localPathCleared += 1
    }
    if (options.dryRun) continue

    await db
      .update(assets)
      .set({
        url: publicUrl,
        localPath: options.clearLocalPath ? null : row.localPath,
        updatedAt: now(),
      })
      .where(eq(assets.id, row.id))
  }

  return { label: 'assets', scanned, eligible, updated, alreadyPresent, missingSource, urlBackfilled, localPathPresent, localPathCleared }
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
