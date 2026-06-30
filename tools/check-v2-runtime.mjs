import net from 'node:net'
import { spawnSync } from 'node:child_process'

const args = new Set(process.argv.slice(2))
const wait = args.has('--wait')
const requireDocker = args.has('--require-docker')
const timeoutMs = Number(process.env.XIAOCHUANG_RUNTIME_WAIT_MS || (wait ? 120_000 : 0))
const intervalMs = Number(process.env.XIAOCHUANG_RUNTIME_POLL_MS || 2_000)

function parsePortFromUrl(value, fallback) {
  try {
    const parsed = new URL(value)
    if (parsed.port) return Number(parsed.port)
    if (parsed.protocol === 'https:') return 443
    if (parsed.protocol === 'http:') return 80
  } catch {
    // Ignore invalid or empty URLs and use the fallback.
  }
  return fallback
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function canConnect({ host, port, timeoutMs = 750 }) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port })
    const finish = (ok) => {
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

function runDocker(args) {
  const result = spawnSync('docker', args, {
    encoding: 'utf8',
    timeout: 10_000,
    windowsHide: true,
  })
  return {
    ok: result.status === 0,
    output: String(result.stdout || result.stderr || result.error?.message || '').trim(),
  }
}

async function runServiceChecks(checks) {
  const results = []
  for (const check of checks) {
    const ok = await canConnect(check)
    results.push({ ...check, ok })
  }
  return results
}

function printResults({ dockerVersion, dockerComposeVersion, results }) {
  console.log(`[${dockerVersion.ok ? 'PASS' : 'MISS'}] Docker${dockerVersion.output ? ` - ${dockerVersion.output}` : ''}`)
  console.log(`[${dockerComposeVersion.ok ? 'PASS' : 'MISS'}] Docker Compose${dockerComposeVersion.output ? ` - ${dockerComposeVersion.output}` : ''}`)

  for (const result of results) {
    const status = result.ok ? 'PASS' : 'MISS'
    console.log(`[${status}] ${result.name} ${result.host}:${result.port} (${result.requiredFor.join(', ')})`)
  }
}

const checks = [
  {
    name: 'PostgreSQL',
    host: process.env.POSTGRES_HOST || '127.0.0.1',
    port: parsePortFromUrl(process.env.DATABASE_URL || 'postgresql://zhaoxiaogang:xiaochuang@localhost:5432/xiaochuang?schema=public', 5432),
    requiredFor: ['audit:v2-completion:local', 'audit:v2-completion'],
  },
  {
    name: 'Redis',
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: parsePortFromUrl(process.env.REDIS_URL || 'redis://127.0.0.1:6379', 6379),
    requiredFor: ['audit:v2-completion:local', 'audit:v2-completion'],
  },
  {
    name: 'MinIO/S3',
    host: process.env.MINIO_HOST || '127.0.0.1',
    port: Number(process.env.MINIO_API_PORT || parsePortFromUrl(process.env.S3_ENDPOINT || 'http://127.0.0.1:9000', 9000)),
    requiredFor: ['audit:v2-completion'],
  },
]

const dockerVersion = runDocker(['--version'])
const dockerComposeVersion = dockerVersion.ok ? runDocker(['compose', 'version']) : { ok: false, output: 'docker is not available' }
let results = await runServiceChecks(checks)

if (wait && results.some((result) => !result.ok)) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline && results.some((result) => !result.ok)) {
    const missing = results.filter((result) => !result.ok).map((result) => result.name).join(', ')
    console.log(`Waiting for runtime services: ${missing}`)
    await sleep(intervalMs)
    results = await runServiceChecks(checks)
  }
}

printResults({ dockerVersion, dockerComposeVersion, results })

const missingServices = results.filter((result) => !result.ok)
const missingTools = [
  requireDocker && !dockerVersion.ok ? 'Docker' : null,
  requireDocker && !dockerComposeVersion.ok ? 'Docker Compose' : null,
].filter(Boolean)

if (missingTools.length || missingServices.length) {
  console.log('')
  if (missingTools.length) {
    console.log(`Missing local tooling: ${missingTools.join(', ')}`)
  }
  if (missingServices.length) {
    console.log(`Missing runtime services: ${missingServices.map((item) => item.name).join(', ')}`)
  }
  console.log('Start local dependencies with: npm run runtime:up')
  console.log('Stop them with: npm run runtime:down')
  process.exitCode = 1
}
