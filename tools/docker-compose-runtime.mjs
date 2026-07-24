import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)

if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
  console.log('Usage: node tools/docker-compose-runtime.mjs <docker compose args...>')
  console.log('')
  console.log('Examples:')
  console.log('  npm run runtime:up')
  console.log('  npm run runtime:down')
  process.exit(args.length === 0 ? 1 : 0)
}

const requiresHermesSource = args.includes('build') || args.includes('up')
if (requiresHermesSource) {
  const prepare = spawnSync(process.execPath, ['tools/prepare-hermes-source.mjs'], {
    cwd: repoRoot,
    stdio: 'inherit',
    windowsHide: true,
  })
  if (prepare.error) {
    console.error(prepare.error.message)
    process.exit(1)
  }
  if (prepare.status !== 0) {
    process.exit(prepare.status ?? 1)
  }
}

const profileArgs = []
if (args[0] === 'down' && !args.includes('--profile')) {
  profileArgs.push('--profile', 'app', '--profile', 'agent')
}

const result = spawnSync('docker', ['compose', '-f', 'docker-compose.runtime.yml', ...profileArgs, ...args], {
  cwd: repoRoot,
  stdio: 'inherit',
  windowsHide: true,
})

if (result.error) {
  console.error(result.error.message)
}

process.exit(result.status ?? 1)
