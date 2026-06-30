import { spawnSync } from 'node:child_process'

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const objectStorageEnv = {
  STORAGE_DRIVER: 's3',
  STORAGE_PUBLIC_BASE_URL: process.env.STORAGE_PUBLIC_BASE_URL || 'http://127.0.0.1:9000/xiaochuang-media',
  S3_ENDPOINT: process.env.S3_ENDPOINT || 'http://127.0.0.1:9000',
  S3_REGION: process.env.S3_REGION || 'us-east-1',
  S3_BUCKET: process.env.S3_BUCKET || 'xiaochuang-media',
  S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID || process.env.MINIO_ROOT_USER || 'minioadmin',
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY || process.env.MINIO_ROOT_PASSWORD || 'minioadmin123',
}

function requireDockerCompose() {
  const docker = spawnSync('docker', ['--version'], { encoding: 'utf8', windowsHide: true })
  if (docker.status !== 0) {
    console.error('Docker is required for npm run audit:v2-runtime.')
    console.error('Install/start Docker Desktop, then rerun this command.')
    process.exit(docker.status ?? 1)
  }

  const compose = spawnSync('docker', ['compose', 'version'], { encoding: 'utf8', windowsHide: true })
  if (compose.status !== 0) {
    console.error('Docker Compose is required for npm run audit:v2-runtime.')
    console.error(String(compose.stderr || compose.stdout || '').trim())
    process.exit(compose.status ?? 1)
  }
}

function run(name, args, options = {}) {
  console.log(`\n==> ${name}`)
  const result = spawnSync(npmCommand, args, {
    stdio: 'inherit',
    env: { ...process.env, ...(options.env || {}) },
    windowsHide: true,
  })
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

requireDockerCompose()
run('runtime:up', ['run', 'runtime:up'])
run('check:v2-runtime', ['run', 'check:v2-runtime', '--', '--wait', '--require-docker'])
run('db:init', ['run', 'db:init'])
run('audit:v2-completion:local', ['run', 'audit:v2-completion:local'])
run('audit:v2-completion', ['run', 'audit:v2-completion'], { env: objectStorageEnv })
