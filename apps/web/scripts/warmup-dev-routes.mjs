#!/usr/bin/env node
import { setTimeout as delay } from 'node:timers/promises'

const baseUrl = process.env.WARMUP_BASE_URL?.trim() || 'http://127.0.0.1:3001'
const timeoutMs = Number(process.env.WARMUP_TIMEOUT_MS || 15000)

const targets = [
  '/',
  '/writing',
  '/assets',
  '/api/v1/health',
  '/api/v1/writings?page=1&page_size=50&sort=updated_at',
  '/api/v1/assets',
]

async function waitForReady(url) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { redirect: 'manual' })
      if (response.status > 0) return
    } catch {
      // keep retrying while dev server is booting
    }
    await delay(500)
  }

  throw new Error(`Timed out waiting for ${url}`)
}

async function warm(url) {
  const start = Date.now()
  const response = await fetch(url, { redirect: 'manual' })
  const elapsedMs = Date.now() - start
  console.log(`[warmup] ${response.status} ${elapsedMs}ms ${url}`)
}

async function main() {
  await waitForReady(`${baseUrl}/`)
  console.log(`[warmup] dev server ready at ${baseUrl}`)

  for (const path of targets) {
    await warm(`${baseUrl}${path}`)
  }
}

main().catch((error) => {
  console.error(`[warmup] failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
