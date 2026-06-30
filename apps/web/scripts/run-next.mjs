#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.resolve(__dirname, '..')
// next may be hoisted to workspace root, so check current app, parent, then repo root
const nextInLocal = path.join(appRoot, 'node_modules', 'next')
const nextInRoot = path.join(appRoot, '..', 'node_modules', 'next')
const nextInWorkspaceRoot = path.join(appRoot, '..', '..', 'node_modules', 'next')
const nextBinCandidate = fs.existsSync(nextInLocal)
  ? nextInLocal
  : fs.existsSync(nextInRoot)
    ? nextInRoot
    : fs.existsSync(nextInWorkspaceRoot)
      ? nextInWorkspaceRoot
      : nextInLocal
const nextBin = path.join(nextBinCandidate, 'dist', 'bin', 'next')

const args = process.argv.slice(2)
const clean = args[0] === '--clean'
if (clean) args.shift()

const distDir = args.shift()
const nextCommand = args.shift()
const nextArgs = args

if (!distDir || !nextCommand) {
  console.error('Usage: node scripts/run-next.mjs [--clean] <distDir> <next-command> [...args]')
  process.exit(1)
}

const nodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10)
// 临时放宽：基线仍是 Node 22（CI / engines），但 24 上 Next 15 实测可跑，
// 用于本机无 nvm/fnm 时跑 PR1 验证。验证完应回退为 `!== 22`。
if (nodeMajor !== 22 && nodeMajor !== 24) {
  console.error(`Node 22 (or 24 temporarily) is required. Current: ${process.version}`)
  process.exit(1)
}
if (nodeMajor === 24) {
  console.warn(`[run-next] WARNING: running on Node ${process.version}; baseline is 22.x.`)
}

function parsePort(nextArgs) {
  for (let index = 0; index < nextArgs.length; index += 1) {
    const arg = nextArgs[index]
    if (arg === '-p' || arg === '--port') {
      const value = nextArgs[index + 1]
      return value ? Number.parseInt(value, 10) : null
    }
    if (arg.startsWith('--port=')) {
      return Number.parseInt(arg.slice('--port='.length), 10)
    }
  }
  return null
}

function findListeningPids(port) {
  const result = spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], {
    encoding: 'utf8',
  })
  if (result.error || result.status !== 0) return []
  return result.stdout
    .split(/\s+/)
    .map((pid) => pid.trim())
    .filter(Boolean)
}

function inspectProcess(pid) {
  const psResult = spawnSync('ps', ['-p', pid, '-o', 'command='], {
    encoding: 'utf8',
  })
  const lsofResult = spawnSync('lsof', ['-p', pid], {
    encoding: 'utf8',
  })
  const cwdLine = lsofResult.stdout
    .split('\n')
    .find((line) => /\scwd\s/.test(line))
  const cwd = cwdLine?.match(/\scwd\s+\S+\s+\S+\s+\S+\s+\S+\s+(.+)$/)?.[1]?.trim()

  return {
    pid,
    command: psResult.stdout.trim() || 'unknown',
    cwd: cwd || 'unknown',
  }
}

function assertPortAvailable() {
  if (!['dev', 'start'].includes(nextCommand)) return
  if (process.env.XIAOCHUANG_ALLOW_OCCUPIED_PORT === '1') return

  const port = parsePort(nextArgs)
  if (!Number.isInteger(port) || port <= 0) return

  const pids = findListeningPids(port)
  if (pids.length === 0) return

  console.error(`[run-next] Port ${port} is already in use. Refusing to start ${nextCommand}.`)
  console.error('[run-next] This prevents accidentally hitting a different local Next.js app.')
  for (const processInfo of pids.map(inspectProcess)) {
    console.error(`[run-next] PID ${processInfo.pid}`)
    console.error(`  cwd: ${processInfo.cwd}`)
    console.error(`  cmd: ${processInfo.command}`)
  }
  console.error('[run-next] Stop the process, choose another port, or set XIAOCHUANG_ALLOW_OCCUPIED_PORT=1 to bypass.')
  process.exit(1)
}

const env = {
  ...process.env,
  NEXT_DIST_DIR: distDir,
  WS_NO_BUFFER_UTIL: process.env.WS_NO_BUFFER_UTIL || '1',
  WS_NO_UTF_8_VALIDATE: process.env.WS_NO_UTF_8_VALIDATE || '1',
}

function syncTsconfigForDistDir() {
  const tsconfigPath = path.join(appRoot, 'tsconfig.json')
  if (!fs.existsSync(tsconfigPath)) return

  const raw = fs.readFileSync(tsconfigPath, 'utf8')
  const config = JSON.parse(raw)
  const include = Array.isArray(config.include) ? config.include : []
  const baseInclude = include.filter(
    (entry) => typeof entry !== 'string' || !/^\.next(?:-[^/\\]+)?(?:[/\\]|$)/.test(entry),
  )
  const currentDistTypes = `${distDir.replaceAll(path.win32.sep, path.posix.sep)}/types/**/*.ts`
  const stableDistTypes = [
    '.next-dev/types/**/*.ts',
    '.next-prod/types/**/*.ts',
    '.next-e2e/types/**/*.ts',
    currentDistTypes,
  ]
  config.include = Array.from(new Set([...baseInclude, ...stableDistTypes]))

  const nextRaw = `${JSON.stringify(config, null, 2)}\n`
  if (raw !== nextRaw) {
    fs.writeFileSync(tsconfigPath, nextRaw)
  }
}

assertPortAvailable()
syncTsconfigForDistDir()

if (clean) {
  fs.rmSync(path.join(appRoot, distDir), { recursive: true, force: true })
}

const ensureResult = spawnSync(process.execPath, ['scripts/ensure-next-dev-cache.mjs'], {
  cwd: appRoot,
  env,
  stdio: 'inherit',
})

if (ensureResult.status !== 0) {
  process.exit(ensureResult.status ?? 1)
}

const nextResult = spawnSync(process.execPath, [nextBin, nextCommand, ...args], {
  cwd: appRoot,
  env,
  stdio: 'inherit',
})

process.exit(nextResult.status ?? 1)
