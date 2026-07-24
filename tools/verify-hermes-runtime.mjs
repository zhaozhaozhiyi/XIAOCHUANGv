import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dockerConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaochuang-docker-'))
fs.writeFileSync(path.join(dockerConfigDir, 'config.json'), '{}\n', 'utf8')
const userDockerConfigDir = process.env.DOCKER_CONFIG || path.join(os.homedir(), '.docker')
const userDockerCliPlugins = path.join(userDockerConfigDir, 'cli-plugins')
if (fs.existsSync(userDockerCliPlugins)) {
  fs.symlinkSync(userDockerCliPlugins, path.join(dockerConfigDir, 'cli-plugins'), 'dir')
}
const testImage = 'xiaochuang-hermes-runtime:test'
const runtimeImage = 'xiaochuang-hermes-runtime:verify'
const focusedTests = [
  'tests/tools/test_xiaochuang_drama_tool.py',
  'tests/gateway/test_xiaochuang_skill_bundle.py',
  'tests/gateway/test_api_server_toolset.py',
  'tests/gateway/test_api_server_runs.py',
  'tests/gateway/test_xiaochuang_source_profile_e2e.py',
  'tests/agent/test_xiaochuang_model_gateway_auxiliary.py',
  'tests/run_agent/test_provider_attribution_headers.py',
  'tests/tools/test_tool_result_storage.py',
]
const hermesPools = {
  'hermes-source': 'xiaochuang-drama-source',
  'hermes-plan': 'xiaochuang-drama-plan',
  'hermes-script': 'xiaochuang-drama-script',
  'hermes-graph': 'xiaochuang-drama-graph',
  'hermes-storyboard': 'xiaochuang-drama-storyboard',
}
const isolationOnly = process.argv.includes('--check-isolation')
const reusePreparedSource = process.argv.includes('--reuse-prepared-source')

function run(command, args, options = {}) {
  const result = execFileSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      DOCKER_CONFIG: dockerConfigDir,
    },
    stdio: options.capture ? 'pipe' : 'inherit',
  })
  return options.capture ? result.trim() : result
}

function assertRuntimeCondition(condition, message) {
  if (!condition) throw new Error(`Hermes runtime verification failed: ${message}`)
}

function verifyComposeIsolation() {
  const resolved = run(
    'docker',
    [
      'compose',
      '-f',
      'docker-compose.runtime.yml',
      '--profile',
      'agent',
      'config',
      '--format',
      'json',
      '--no-interpolate',
    ],
    { capture: true },
  )
  const compose = JSON.parse(resolved)
  assertRuntimeCondition(
    compose.networks?.['agent-runtime']?.internal === true,
    'agent-runtime network must remain internal',
  )

  for (const [serviceName, toolProfile] of Object.entries(hermesPools)) {
    const service = compose.services?.[serviceName]
    assertRuntimeCondition(service, `${serviceName} service is missing`)
    assertRuntimeCondition(
      !Array.isArray(service.ports) || service.ports.length === 0,
      `${serviceName} must not publish ports`,
    )
    assertRuntimeCondition(service.read_only === true, `${serviceName} must be read-only`)
    assertRuntimeCondition(service.user === '10000:10000', `${serviceName} must run as non-root`)
    assertRuntimeCondition(
      Array.isArray(service.cap_drop) && service.cap_drop.includes('ALL'),
      `${serviceName} must drop every Linux capability`,
    )
    assertRuntimeCondition(
      Array.isArray(service.security_opt) && service.security_opt.includes('no-new-privileges:true'),
      `${serviceName} must enable no-new-privileges`,
    )
    assertRuntimeCondition(
      service.pids_limit === 128,
      `${serviceName} must keep the process limit`,
    )
    assertRuntimeCondition(
      Array.isArray(service.tmpfs)
        && service.tmpfs.includes('/tmp:rw,nosuid,nodev,noexec,size=64m'),
      `${serviceName} must expose only the constrained tmpfs`,
    )
    assertRuntimeCondition(
      JSON.stringify(Object.keys(service.networks || {}).sort()) === JSON.stringify(['agent-runtime']),
      `${serviceName} must only join the internal agent-runtime network`,
    )
    assertRuntimeCondition(
      service.environment?.XIAOCHUANG_TOOL_PROFILE === toolProfile,
      `${serviceName} must pin ${toolProfile}`,
    )
    assertRuntimeCondition(
      service.environment?.HERMES_MODEL_GATEWAY_BASE_URL
        === 'http://backend:3010/api/v1/internal/agent-runtime/model-gateway/v1',
      `${serviceName} must use the internal Model Gateway`,
    )
    assertRuntimeCondition(
      !Object.keys(service.environment || {}).some((key) => /^(OPENAI|ANTHROPIC|GOOGLE|DEEPSEEK|MOONSHOT|ALI|MINIMAX)_API_KEY$/.test(key)),
      `${serviceName} must not receive a user Provider API key`,
    )
  }
}

verifyComposeIsolation()
if (isolationOnly) {
  console.log('Hermes Compose isolation verification passed')
  process.exit(0)
}

if (!reusePreparedSource) {
  run(process.execPath, ['tools/prepare-hermes-source.mjs'])
}
run(process.execPath, ['tools/prepare-hermes-source.mjs', '--check'])
run('docker', [
  'build',
  '--pull=false',
  '--target',
  'test',
  '--tag',
  testImage,
  '--file',
  'deploy/hermes/Dockerfile',
  '.',
])
run('docker', [
  'run',
  '--rm',
  '--entrypoint',
  'python',
  testImage,
  '-m',
  'pytest',
  ...focusedTests,
  '-q',
])
run('docker', [
  'build',
  '--pull=false',
  '--target',
  'runtime',
  '--tag',
  runtimeImage,
  '--file',
  'deploy/hermes/Dockerfile',
  '.',
])
run('docker', [
  'run',
  '--rm',
  '--read-only',
  '--user',
  '10000:10000',
  '--cap-drop',
  'ALL',
  '--security-opt',
  'no-new-privileges:true',
  '--pids-limit',
  '128',
  '--tmpfs',
  '/tmp:rw,nosuid,nodev,noexec,size=64m',
  '--entrypoint',
  'sh',
  runtimeImage,
  '-ec',
  [
    'test "$(id -u)" = "10000"',
    'test ! -w /opt/xiaochuang-skills',
    'test -r /opt/xiaochuang-skills/xiaochuang_runtime_policy/SKILL.md',
    'touch /tmp/xiaochuang-runtime-probe',
    'if touch /home/hermes/xiaochuang-runtime-probe 2>/dev/null; then exit 1; fi',
    'if touch /opt/xiaochuang-skills/xiaochuang-runtime-probe 2>/dev/null; then exit 1; fi',
  ].join('; '),
])

const imageId = run('docker', ['image', 'inspect', '--format', '{{.Id}}', runtimeImage], { capture: true })
if (!/^sha256:[0-9a-f]{64}$/.test(imageId)) {
  throw new Error(`Unexpected Hermes runtime image ID: ${imageId}`)
}

console.log(`Hermes runtime verification passed: ${imageId}`)
