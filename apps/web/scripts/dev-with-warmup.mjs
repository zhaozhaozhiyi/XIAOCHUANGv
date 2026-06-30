#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.resolve(__dirname, '..')

const baseUrl = process.env.WARMUP_BASE_URL?.trim() || 'http://127.0.0.1:3001'
const devArgs = ['scripts/run-next.mjs', '.next-dev', 'dev', '-p', '3001', '-H', '127.0.0.1']

const dev = spawn(process.execPath, devArgs, {
  cwd: appRoot,
  env: process.env,
  stdio: 'inherit',
})

let warmupStarted = false
let warmupCompleted = false

async function warmupWhenReady() {
  while (!warmupStarted) {
    warmupStarted = true
    try {
      const response = await fetch(`${baseUrl}/`, { redirect: 'manual' })
      if (response.status > 0) {
        break
      }
    } catch {
      warmupStarted = false
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }

  if (warmupCompleted) return

  const warmup = spawn(process.execPath, ['scripts/warmup-dev-routes.mjs'], {
    cwd: appRoot,
    env: process.env,
    stdio: 'inherit',
  })

  warmup.on('exit', (code) => {
    warmupCompleted = true
    if (code && code !== 0) {
      console.error(`[dev:warm] warmup exited with code ${code}`)
    }
  })
}

void warmupWhenReady()

dev.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 0)
})
