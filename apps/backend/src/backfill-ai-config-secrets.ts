import 'reflect-metadata'
import 'dotenv/config'

import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'

import { loadEnv } from './config/env'
import * as schema from './db/schema'
import {
  isEncryptedAiConfigSecret,
  prepareAiConfigSecretForStorage,
} from './modules/ai-configs/ai-configs.crypto'

function hasFlag(flag: string) {
  return process.argv.includes(flag)
}

function readExplicitEncryptionKey() {
  const value = String(process.env.AI_CONFIG_ENCRYPTION_KEY || '').trim()
  if (!value) {
    throw new Error('AI_CONFIG_ENCRYPTION_KEY is required for ai config secret backfill')
  }
  if (value.length < 16) {
    throw new Error('AI_CONFIG_ENCRYPTION_KEY must be at least 16 characters for ai config secret backfill')
  }
  return value
}

async function main() {
  const dryRun = hasFlag('--dry-run')
  const encryptionKey = readExplicitEncryptionKey()
  const env = loadEnv()
  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: 2,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 2_000,
  })
  const db = drizzle(pool, { schema })

  try {
    const { aiServiceConfigs } = schema
    const rows = await db.select().from(aiServiceConfigs)

    const candidates = rows.filter((row) => {
      const apiKey = String(row.apiKey || '').trim()
      return Boolean(apiKey) && !isEncryptedAiConfigSecret(apiKey)
    })

    if (!dryRun) {
      const updatedAt = new Date()
      for (const row of candidates) {
        const encrypted = prepareAiConfigSecretForStorage(row.apiKey, encryptionKey)
        await db
          .update(aiServiceConfigs)
          .set({
            apiKey: encrypted,
            updatedAt,
          })
          .where(eq(aiServiceConfigs.id, row.id))
      }
    }

    console.log(JSON.stringify({
      ok: true,
      dry_run: dryRun,
      scanned: rows.length,
      encrypted: candidates.length,
      already_encrypted: rows.length - candidates.length,
      items: candidates.map((row) => ({
        id: row.id,
        user_id: row.userId,
        service_type: row.serviceType,
        provider: row.provider,
        name: row.name,
      })),
    }, null, 2))
  } finally {
    await pool.end()
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
