import http from 'node:http'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = new Set(process.argv.slice(2))
const cleanupApp = args.has('--cleanup-app')
const down = args.has('--down')
const noBuild = args.has('--no-build')
const timeoutMs = Number(process.env.XIAOCHUANG_DOCKER_VERIFY_TIMEOUT_MS || 180_000)
const intervalMs = Number(process.env.XIAOCHUANG_DOCKER_VERIFY_POLL_MS || 2_000)
const backendPort = process.env.BACKEND_PORT || '3011'

const composeEnv = {
  ...process.env,
  POSTGRES_PORT: process.env.POSTGRES_PORT || '5432',
  REDIS_PORT: process.env.REDIS_PORT || '6380',
  MINIO_API_PORT: process.env.MINIO_API_PORT || '9000',
  MINIO_CONSOLE_PORT: process.env.MINIO_CONSOLE_PORT || '9001',
  BACKEND_PORT: backendPort,
  TASK_QUEUE_NAME: process.env.TASK_QUEUE_NAME || 'backend-tasks-runtime-smoke',
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: composeEnv,
    encoding: options.capture ? 'utf8' : undefined,
    stdio: options.capture ? 'pipe' : 'inherit',
    timeout: options.timeout,
    windowsHide: true,
  })

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0 && !options.allowFailure) {
    const output = String(result.stderr || result.stdout || '').trim()
    throw new Error(output || `${command} ${args.join(' ')} failed with status ${result.status}`)
  }

  return result
}

function docker(args, options) {
  return run('docker', args, options)
}

function compose(args, options) {
  return docker(['compose', '-f', 'docker-compose.runtime.yml', '--profile', 'app', ...args], options)
}

function requestJson(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, { timeout: 2_000 }, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => {
        body += chunk
      })
      response.on('end', () => {
        if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
          try {
            resolve(JSON.parse(body))
          } catch (error) {
            reject(error)
          }
          return
        }

        reject(new Error(`HTTP ${response.statusCode}: ${body}`))
      })
    })
    request.on('timeout', () => {
      request.destroy(new Error('request timed out'))
    })
    request.on('error', reject)
  })
}

async function waitFor(label, check) {
  const deadline = Date.now() + timeoutMs
  let lastError = null

  while (Date.now() < deadline) {
    try {
      const result = await check()
      console.log(`[PASS] ${label}`)
      return result
    } catch (error) {
      lastError = error
      console.log(`Waiting for ${label}: ${error instanceof Error ? error.message : String(error)}`)
      await sleep(intervalMs)
    }
  }

  throw new Error(`${label} did not become ready: ${lastError instanceof Error ? lastError.message : String(lastError)}`)
}

function readWorkerReadiness() {
  const result = compose(['exec', '-T', 'worker', 'sh', '-lc', 'cat /tmp/task-worker-ready.json'], {
    capture: true,
    allowFailure: true,
    timeout: 10_000,
  })

  if (result.status !== 0) {
    throw new Error(String(result.stderr || result.stdout || 'readiness file is not available').trim())
  }

  const readiness = JSON.parse(String(result.stdout || '{}'))
  if (readiness.status !== 'ready') {
    throw new Error(`worker status is ${readiness.status || 'unknown'}`)
  }

  return readiness
}

function readContainerHealth(containerName) {
  const result = docker(['inspect', '--format', '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}', containerName], {
    capture: true,
    allowFailure: true,
    timeout: 10_000,
  })

  if (result.status !== 0) {
    throw new Error(String(result.stderr || result.stdout || `${containerName} is not inspectable`).trim())
  }

  const status = String(result.stdout || '').trim()
  if (status !== 'healthy') {
    throw new Error(`${containerName} health is ${status || 'unknown'}`)
  }

  return status
}

function printComposeStatus() {
  compose(['ps'], { allowFailure: true })
}

async function main() {
  docker(['--version'], { capture: true })
  docker(['compose', 'version'], { capture: true })

  console.log('Starting Docker runtime stack...')
  const upArgs = ['up', '-d']
  if (!noBuild) upArgs.push('--build')
  upArgs.push('backend', 'worker')
  compose(upArgs)

  const backendHealth = await waitFor('backend health', () => requestJson(`http://127.0.0.1:${backendPort}/api/v1/health`))
  const workerReadiness = await waitFor('worker readiness', () => readWorkerReadiness())
  await waitFor('worker container health', () => readContainerHealth('xiaochuang-worker'))

  console.log('')
  console.log('Docker runtime verification passed.')
  console.log(`Backend: http://127.0.0.1:${backendPort}/api/v1/health -> ${backendHealth.status}`)
  console.log(`Worker: ${workerReadiness.component} ${workerReadiness.status} on ${workerReadiness.queue}`)
  printComposeStatus()
}

try {
  await main()
} finally {
  if (cleanupApp) {
    console.log('\nCleaning up app containers...')
    compose(['rm', '--stop', '--force', 'backend', 'worker'], { allowFailure: true })
  } else if (down) {
    console.log('\nStopping Docker runtime stack...')
    compose(['down'], { allowFailure: true })
  }
}
