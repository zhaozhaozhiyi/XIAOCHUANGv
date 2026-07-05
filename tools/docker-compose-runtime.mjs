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

const result = spawnSync('docker', ['compose', '-f', 'docker-compose.runtime.yml', ...args], {
  cwd: repoRoot,
  stdio: 'inherit',
  windowsHide: true,
})

if (result.error) {
  console.error(result.error.message)
}

process.exit(result.status ?? 1)
