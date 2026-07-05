import { spawnSync } from 'node:child_process'

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const args = new Set(process.argv.slice(2))

const skipDiffCheck = args.has('--skip-diff-check')
const skipRuntime = args.has('--skip-runtime')
const skipWeb = args.has('--skip-web')
const skipAdmin = args.has('--skip-admin')
const skipDockerBuild = args.has('--skip-docker-build')

function run(name, command, commandArgs, options = {}) {
  if (options.skip) {
    console.log(`\n==> ${name} (skipped)`)
    return
  }

  console.log(`\n==> ${name}`)
  const result = spawnSync(command, commandArgs, {
    stdio: 'inherit',
    env: {
      ...process.env,
      CI: process.env.CI || 'true',
      NEXT_TELEMETRY_DISABLED: process.env.NEXT_TELEMETRY_DISABLED || '1',
      ...(options.env || {}),
    },
    windowsHide: true,
  })

  if (result.error) {
    console.error(result.error.message)
    process.exit(1)
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

function npm(name, script, extraArgs = [], options = {}) {
  run(name, npmCommand, ['run', script, ...extraArgs], options)
}

function npmWorkspace(name, workspace, script, extraArgs = [], options = {}) {
  run(name, npmCommand, ['run', script, '--workspace', workspace, ...extraArgs], options)
}

run('workspace diff check', 'git', ['diff', '--check'], { skip: skipDiffCheck })
npm('verify package scripts', 'verify:package-scripts')

npmWorkspace('build contracts package', 'packages/contracts', 'build')
npmWorkspace('build canvas shared package', 'packages/canvas-shared', 'build')
npmWorkspace('build ui package', 'packages/ui', 'build')
npmWorkspace('test canvas shared package', 'packages/canvas-shared', 'test')

npmWorkspace('typecheck backend', 'apps/backend', 'typecheck')
npmWorkspace('test backend', 'apps/backend', 'test')
npmWorkspace('build backend', 'apps/backend', 'build')

npmWorkspace('lint web', 'apps/web', 'lint', [], { skip: skipWeb })
npmWorkspace('build web', 'apps/web', 'build', [], { skip: skipWeb })

npmWorkspace('lint admin', 'apps/admin', 'lint', [], { skip: skipAdmin })
npmWorkspace('build admin', 'apps/admin', 'build', [], { skip: skipAdmin })

npm('verify docker runtime', 'runtime:verify', ['--', '--cleanup-app', ...(skipDockerBuild ? ['--no-build'] : [])], {
  skip: skipRuntime,
})

console.log('\nRelease gates passed.')
