import 'reflect-metadata'

import { isNull } from 'drizzle-orm'
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
  failOnLegacy: boolean
  requireObjectStorage: boolean
}

type AuditResult = {
  label: string
  scanned: number
  publicUrlPresent: number
  publicUrlRemote: number
  publicUrlNonRemote: number
  publicUrlMissing: number
  localPathPresent: number
  backfillableFromLocalPath: number
  legacyRows: number
  legacyExampleIds: number[]
}

type AuditRow = {
  id: number
  publicUrls: Array<string | null | undefined>
  localPath?: string | null | undefined
}

function parseArgs(): CliOptions {
  const args = new Set(process.argv.slice(2))
  return {
    failOnLegacy: args.has('--fail-on-legacy'),
    requireObjectStorage: args.has('--require-object-storage'),
  }
}

function normalizeValue(value: string | null | undefined) {
  return String(value || '').trim()
}

function isRemoteMediaUrl(value: string) {
  return value.startsWith('http://') || value.startsWith('https://') || value.startsWith('data:')
}

function isNonRemoteMediaUrl(value: string) {
  return Boolean(value) && !isRemoteMediaUrl(value)
}

function auditRows(label: string, rows: AuditRow[], publicBaseUrl: string | undefined): AuditResult {
  let publicUrlPresent = 0
  let publicUrlRemote = 0
  let publicUrlNonRemote = 0
  let publicUrlMissing = 0
  let localPathPresent = 0
  let backfillableFromLocalPath = 0
  let legacyRows = 0
  const legacyExampleIds: number[] = []

  for (const row of rows) {
    const publicUrls = row.publicUrls.map(normalizeValue).filter(Boolean)
    const hasPublicUrl = publicUrls.length > 0
    const hasRemoteUrl = publicUrls.some(isRemoteMediaUrl)
    const hasNonRemoteUrl = publicUrls.some(isNonRemoteMediaUrl)
    const localPath = normalizeValue(row.localPath)
    const hasLocalPath = Boolean(localPath)
    const canBackfillFromLocalPath = !hasPublicUrl && Boolean(toPublicMediaUrl(localPath, publicBaseUrl))
    const isLegacyRow = hasLocalPath || hasNonRemoteUrl || canBackfillFromLocalPath

    if (hasPublicUrl) publicUrlPresent += 1
    else publicUrlMissing += 1
    if (hasRemoteUrl) publicUrlRemote += 1
    if (hasNonRemoteUrl) publicUrlNonRemote += 1
    if (hasLocalPath) localPathPresent += 1
    if (canBackfillFromLocalPath) backfillableFromLocalPath += 1
    if (isLegacyRow) {
      legacyRows += 1
      if (legacyExampleIds.length < 10) legacyExampleIds.push(row.id)
    }
  }

  return {
    label,
    scanned: rows.length,
    publicUrlPresent,
    publicUrlRemote,
    publicUrlNonRemote,
    publicUrlMissing,
    localPathPresent,
    backfillableFromLocalPath,
    legacyRows,
    legacyExampleIds,
  }
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
    const [characterRows, sceneRows, propRows, imageGenerationRows, videoGenerationRows, assetRows] = await Promise.all([
      db
        .select({
          id: characters.id,
          imageUrl: characters.imageUrl,
          localPath: characters.localPath,
        })
        .from(characters)
        .where(isNull(characters.deletedAt)),
      db
        .select({
          id: scenes.id,
          imageUrl: scenes.imageUrl,
          localPath: scenes.localPath,
        })
        .from(scenes)
        .where(isNull(scenes.deletedAt)),
      db
        .select({
          id: props.id,
          imageUrl: props.imageUrl,
          localPath: props.localPath,
        })
        .from(props)
        .where(isNull(props.deletedAt)),
      db
        .select({
          id: imageGenerations.id,
          imageUrl: imageGenerations.imageUrl,
          minioUrl: imageGenerations.minioUrl,
          localPath: imageGenerations.localPath,
        })
        .from(imageGenerations),
      db
        .select({
          id: videoGenerations.id,
          videoUrl: videoGenerations.videoUrl,
          minioUrl: videoGenerations.minioUrl,
          localPath: videoGenerations.localPath,
        })
        .from(videoGenerations)
        .where(isNull(videoGenerations.deletedAt)),
      db
        .select({
          id: assets.id,
          url: assets.url,
          thumbnailUrl: assets.thumbnailUrl,
          localPath: assets.localPath,
        })
        .from(assets)
        .where(isNull(assets.deletedAt)),
    ])

    const results = [
      auditRows(
        'characters',
        characterRows.map((row) => ({
          id: row.id,
          publicUrls: [row.imageUrl],
          localPath: row.localPath,
        })),
        env.STORAGE_PUBLIC_BASE_URL,
      ),
      auditRows(
        'scenes',
        sceneRows.map((row) => ({
          id: row.id,
          publicUrls: [row.imageUrl],
          localPath: row.localPath,
        })),
        env.STORAGE_PUBLIC_BASE_URL,
      ),
      auditRows(
        'props',
        propRows.map((row) => ({
          id: row.id,
          publicUrls: [row.imageUrl],
          localPath: row.localPath,
        })),
        env.STORAGE_PUBLIC_BASE_URL,
      ),
      auditRows(
        'image_generations',
        imageGenerationRows.map((row) => ({
          id: row.id,
          publicUrls: [row.imageUrl, row.minioUrl],
          localPath: row.localPath,
        })),
        env.STORAGE_PUBLIC_BASE_URL,
      ),
      auditRows(
        'video_generations',
        videoGenerationRows.map((row) => ({
          id: row.id,
          publicUrls: [row.videoUrl, row.minioUrl],
          localPath: row.localPath,
        })),
        env.STORAGE_PUBLIC_BASE_URL,
      ),
      auditRows(
        'assets',
        assetRows.map((row) => ({
          id: row.id,
          publicUrls: [row.url, row.thumbnailUrl],
          localPath: row.localPath,
        })),
        env.STORAGE_PUBLIC_BASE_URL,
      ),
    ]

    const totals = results.reduce(
      (sum, item) => ({
        scanned: sum.scanned + item.scanned,
        publicUrlPresent: sum.publicUrlPresent + item.publicUrlPresent,
        publicUrlRemote: sum.publicUrlRemote + item.publicUrlRemote,
        publicUrlNonRemote: sum.publicUrlNonRemote + item.publicUrlNonRemote,
        publicUrlMissing: sum.publicUrlMissing + item.publicUrlMissing,
        localPathPresent: sum.localPathPresent + item.localPathPresent,
        backfillableFromLocalPath: sum.backfillableFromLocalPath + item.backfillableFromLocalPath,
        legacyRows: sum.legacyRows + item.legacyRows,
      }),
      {
        scanned: 0,
        publicUrlPresent: 0,
        publicUrlRemote: 0,
        publicUrlNonRemote: 0,
        publicUrlMissing: 0,
        localPathPresent: 0,
        backfillableFromLocalPath: 0,
        legacyRows: 0,
      },
    )

    const gateFailures: string[] = []
    const publicBaseUrl = normalizeValue(env.STORAGE_PUBLIC_BASE_URL)
    const publicBaseUrlIsRemote = isRemoteMediaUrl(publicBaseUrl)

    if (options.requireObjectStorage) {
      if (env.STORAGE_DRIVER !== 's3') {
        gateFailures.push(`STORAGE_DRIVER=${env.STORAGE_DRIVER} (expected s3)`)
      }
      if (!publicBaseUrl) {
        gateFailures.push('STORAGE_PUBLIC_BASE_URL is missing')
      } else if (!publicBaseUrlIsRemote) {
        gateFailures.push(`STORAGE_PUBLIC_BASE_URL is not remote: ${publicBaseUrl}`)
      }
      if (totals.publicUrlNonRemote > 0) {
        gateFailures.push(`non-remote public URLs remain: ${totals.publicUrlNonRemote}`)
      }
      if (totals.localPathPresent > 0) {
        gateFailures.push(`local_path values remain: ${totals.localPathPresent}`)
      }
      if (totals.legacyRows > 0) {
        gateFailures.push(`legacy media rows remain: ${totals.legacyRows}`)
      }
    }

    console.log(
      JSON.stringify(
        {
          fail_on_legacy: options.failOnLegacy,
          require_object_storage: options.requireObjectStorage,
          storage_driver: env.STORAGE_DRIVER,
          storage_public_base_url: env.STORAGE_PUBLIC_BASE_URL || null,
          object_storage_gate: {
            passed: gateFailures.length === 0,
            failures: gateFailures,
          },
          totals: {
            scanned: totals.scanned,
            public_url_present: totals.publicUrlPresent,
            public_url_remote: totals.publicUrlRemote,
            public_url_non_remote: totals.publicUrlNonRemote,
            public_url_missing: totals.publicUrlMissing,
            local_path_present: totals.localPathPresent,
            backfillable_from_local_path: totals.backfillableFromLocalPath,
            legacy_rows: totals.legacyRows,
          },
          tables: results.map((item) => ({
            label: item.label,
            scanned: item.scanned,
            public_url_present: item.publicUrlPresent,
            public_url_remote: item.publicUrlRemote,
            public_url_non_remote: item.publicUrlNonRemote,
            public_url_missing: item.publicUrlMissing,
            local_path_present: item.localPathPresent,
            backfillable_from_local_path: item.backfillableFromLocalPath,
            legacy_rows: item.legacyRows,
            legacy_example_ids: item.legacyExampleIds,
          })),
        },
        null,
        2,
      ),
    )

    if (options.failOnLegacy && totals.legacyRows > 0) {
      process.exitCode = 1
    }
    if (options.requireObjectStorage && gateFailures.length > 0) {
      process.exitCode = 1
    }
  } finally {
    await pool.end()
  }
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
