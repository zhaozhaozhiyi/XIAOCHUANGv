import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = new Set(process.argv.slice(2))
const outputJson = args.has('--json')

const mode = args.has('--quick')
  ? 'quick'
  : args.has('--local')
    ? 'local'
    : 'full'

const runLocalRuntime = mode === 'local' || mode === 'full'
const runObjectStorage = mode === 'full'
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const npmCliPath = process.env.npm_execpath || path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
const nodeMajor = Number.parseInt(process.versions.node.split('.')[0] || '0', 10)
const defaultCommandTimeoutMs = Number(process.env.XIAOCHUANG_AUDIT_COMMAND_TIMEOUT_MS || 180_000)

if (nodeMajor !== 22 && !process.env.XIAOCHUANG_AUDIT_NODE22_REEXEC) {
  const reexecNpmCliPath = process.env.npm_execpath || path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
  const node22Args = [
    reexecNpmCliPath,
    'exec',
    '--yes',
    '--package',
    'node@22',
    '--',
    'node',
    fileURLToPath(import.meta.url),
    ...process.argv.slice(2),
  ]
  const result = spawnSync(process.execPath, node22Args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: 'inherit',
    env: {
      ...process.env,
      XIAOCHUANG_AUDIT_NODE22_REEXEC: '1',
    },
  })
  process.exit(result.status ?? 1)
}

function npmSpec(args) {
  return [process.execPath, [npmCliPath, ...args]]
}

const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])
const ignoredDirs = new Set(['.git', 'node_modules', '.next', 'dist'])

function normalizePath(value) {
  return value.split(path.sep).join('/')
}

function relativePath(target) {
  return normalizePath(path.relative(repoRoot, target) || '.')
}

function pathExists(relativeTarget) {
  return fs.existsSync(path.join(repoRoot, relativeTarget))
}

function readText(relativeTarget) {
  return fs.readFileSync(path.join(repoRoot, relativeTarget), 'utf8')
}

function readJson(relativeTarget) {
  return JSON.parse(readText(relativeTarget))
}

function walkFiles(root) {
  if (!fs.existsSync(root)) return []

  const results = []
  const entries = fs.readdirSync(root, { withFileTypes: true })
  for (const entry of entries) {
    if (ignoredDirs.has(entry.name)) continue
    const fullPath = path.join(root, entry.name)
    if (entry.isDirectory()) {
      results.push(...walkFiles(fullPath))
      continue
    }
    if (!sourceExtensions.has(path.extname(entry.name))) continue
    results.push(fullPath)
  }

  return results
}

function findPatternMatches(roots, patterns) {
  const matches = []

  for (const root of roots) {
    const files = walkFiles(path.join(repoRoot, root))
    for (const filePath of files) {
      const content = fs.readFileSync(filePath, 'utf8')
      const lines = content.split(/\r?\n/)
      lines.forEach((line, index) => {
        for (const pattern of patterns) {
          if (!pattern.regex.test(line)) continue
          matches.push(`${relativePath(filePath)}:${index + 1} ${pattern.label}`)
        }
      })
    }
  }

  return matches
}

function listRouteFiles(relativeRoot) {
  const absoluteRoot = path.join(repoRoot, relativeRoot)
  const files = walkFiles(absoluteRoot)
  return files
    .map((filePath) => path.relative(absoluteRoot, filePath))
    .map(normalizePath)
    .filter((relativeFile) => relativeFile.endsWith('/route.ts') || relativeFile.endsWith('/route.js'))
    .sort()
}

function buildObjectStorageEnv() {
  const minioPort = String(process.env.MINIO_API_PORT || '9000')
  const bucket = String(process.env.MINIO_BUCKET || process.env.S3_BUCKET || 'xiaochuang-media')
  const endpoint = String(process.env.S3_ENDPOINT || `http://127.0.0.1:${minioPort}`)
  const accessKey = String(process.env.MINIO_ROOT_USER || process.env.S3_ACCESS_KEY_ID || 'minioadmin')
  const secretKey = String(process.env.MINIO_ROOT_PASSWORD || process.env.S3_SECRET_ACCESS_KEY || 'minioadmin123')

  return {
    STORAGE_DRIVER: 's3',
    STORAGE_PUBLIC_BASE_URL: String(process.env.STORAGE_PUBLIC_BASE_URL || `${endpoint}/${bucket}`),
    S3_ENDPOINT: endpoint,
    S3_REGION: String(process.env.S3_REGION || 'us-east-1'),
    S3_BUCKET: bucket,
    S3_ACCESS_KEY_ID: accessKey,
    S3_SECRET_ACCESS_KEY: secretKey,
  }
}

function parsePortFromUrl(value, fallback) {
  try {
    const parsed = new URL(value)
    if (parsed.port) return Number(parsed.port)
    if (parsed.protocol === 'https:') return 443
    if (parsed.protocol === 'http:') return 80
  } catch {
    // ignore
  }
  return fallback
}

function canConnect(port, host = '127.0.0.1', timeoutMs = 750) {
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

function runPreflight(name, checks) {
  const missing = []
  for (const check of checks) {
    const probeScript = `const net=require('net');const s=net.createConnection({host:${JSON.stringify(check.host || '127.0.0.1')},port:${Number(check.port)}});const done=(ok)=>{s.destroy();process.exit(ok?0:1)};s.setTimeout(750);s.once('connect',()=>done(true));s.once('timeout',()=>done(false));s.once('error',()=>done(false));`
    const result = spawnSync(process.execPath, ['-e', probeScript], {
      cwd: repoRoot,
      encoding: 'utf8',
      timeout: 2_000,
    })
    if (result.status !== 0) missing.push(`${check.label}(${check.host || '127.0.0.1'}:${check.port})`)
  }

  if (!missing.length) {
    return { ok: true, missing }
  }

  const message = `${name} preflight failed: missing ${missing.join(', ')}. Start local dependencies with: npm run runtime:up`
  commandResults.push({
    name,
    ok: false,
    status: 1,
    durationMs: 0,
    stdout: '',
    stderr: message,
    command: `${name}:preflight`,
  })
  commandMap.set(name, commandResults.at(-1))
  return { ok: false, missing }
}

function runCommand(command, commandArgs, options = {}) {
  const startedAt = Date.now()
  const env = { ...process.env, ...(options.env || {}) }
  env.npm_node_execpath = process.execPath
  env.NODE = process.execPath
  const result = spawnSync(command, commandArgs, {
    cwd: repoRoot,
    encoding: 'utf8',
    env,
    maxBuffer: 16 * 1024 * 1024,
    timeout: options.timeoutMs || defaultCommandTimeoutMs,
  })

  return {
    ok: result.status === 0,
    status: result.status ?? 1,
    durationMs: Date.now() - startedAt,
    stdout: result.stdout || '',
    stderr: result.error?.message || result.stderr || '',
    command: [command, ...commandArgs].join(' '),
  }
}

function formatTail(output) {
  return output
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-8)
}

function makeCriterion(id, label, status, evidence, checks = []) {
  return { id, label, status, evidence, checks }
}

const commandResults = []
const commandMap = new Map()

function runNamedCommand(name, command, commandArgs, options = {}) {
  const result = runCommand(command, commandArgs, options)
  commandResults.push({ name, ...result })
  commandMap.set(name, result)
  return result
}

const frontendImportPatterns = [
  {
    label: 'imports drizzle runtime',
    regex: /\b(?:from|import\s*\(|require\s*\()\s*['"]drizzle-orm(?:\/[^'"]*)?['"]/,
  },
  {
    label: 'imports postgres client',
    regex: /\b(?:from|import\s*\(|require\s*\()\s*['"]pg['"]/,
  },
  {
    label: 'imports better-sqlite3',
    regex: /\b(?:from|import\s*\(|require\s*\()\s*['"]better-sqlite3['"]/,
  },
  {
    label: 'imports server/db modules',
    regex: /\b(?:from|import\s*\(|require\s*\()\s*['"][^'"]*server\/db(?:\/[^'"]*)?['"]/,
  },
]

const frontendAuthPatterns = [
  {
    label: 'imports next-auth',
    regex: /\b(?:from|import\s*\(|require\s*\()\s*['"]next-auth(?:\/[^'"]*)?['"]/,
  },
  {
    label: 'imports lucia',
    regex: /\b(?:from|import\s*\(|require\s*\()\s*['"]lucia(?:\/[^'"]*)?['"]/,
  },
  {
    label: 'imports better-auth',
    regex: /\b(?:from|import\s*\(|require\s*\()\s*['"]better-auth(?:\/[^'"]*)?['"]/,
  },
  {
    label: 'imports iron-session',
    regex: /\b(?:from|import\s*\(|require\s*\()\s*['"]iron-session(?:\/[^'"]*)?['"]/,
  },
  {
    label: 'imports bcrypt',
    regex: /\b(?:from|import\s*\(|require\s*\()\s*['"]bcrypt(?:\/[^'"]*)?['"]/,
  },
]

const schemaPatterns = [
  {
    label: 'declares pgTable schema',
    regex: /\bpgTable\s*\(/,
  },
  {
    label: 'imports drizzle pg-core',
    regex: /\b(?:from|import\s*\(|require\s*\()\s*['"]drizzle-orm\/pg-core['"]/,
  },
  {
    label: 'imports drizzle sqlite-core',
    regex: /\b(?:from|import\s*\(|require\s*\()\s*['"]drizzle-orm\/sqlite-core['"]/,
  },
]

const frontendDbMatches = findPatternMatches(['apps/web/src', 'apps/admin/src'], frontendImportPatterns)
const frontendAuthMatches = findPatternMatches(['apps/web/src', 'apps/admin/src'], frontendAuthPatterns)
const schemaMatchesOutsideBackend = findPatternMatches(['apps/web', 'apps/admin', 'packages'], schemaPatterns)
const adminOnlyDbMatches = findPatternMatches(['apps/admin/src'], frontendImportPatterns)
const adminOnlyAuthMatches = findPatternMatches(['apps/admin/src'], frontendAuthPatterns)

const webRouteFiles = listRouteFiles('apps/web/src/app')
const adminRouteFiles = listRouteFiles('apps/admin/src/app')

const expectedWebRouteFiles = ['api/v1/[[...path]]/route.ts']
const expectedAdminRouteFiles = ['api/admin/login/route.ts', 'api/admin/logout/route.ts']

const adminPackage = readJson('apps/admin/package.json')
const webPackage = readJson('apps/web/package.json')
const adminLoginRouteText = readText('apps/admin/src/app/api/admin/login/route.ts')
const adminLogoutRouteText = readText('apps/admin/src/app/api/admin/logout/route.ts')
const adminSessionText = readText('apps/admin/src/lib/session.ts')
const webBackendShellText = readText('apps/web/src/server/backend.ts')

const riskyDeps = ['pg', 'drizzle-orm', 'better-sqlite3', 'bcrypt', 'next-auth', 'lucia', 'better-auth', 'iron-session']

function collectRiskDeps(pkg) {
  const combined = {
    ...(pkg.dependencies || {}),
    ...(pkg.devDependencies || {}),
  }
  return riskyDeps.filter((dep) => dep in combined)
}

const adminRiskDeps = collectRiskDeps(adminPackage)
const webRiskDeps = collectRiskDeps(webPackage)
const adminLoginProxyOk = adminLoginRouteText.includes('/api/v1/auth/login/password-session')
const adminLogoutProxyOk = adminLogoutRouteText.includes('/api/v1/auth/logout')
const adminSessionBackendFirst = adminSessionText.includes('/api/v1/auth/session') && adminSessionText.includes('backendFetch')
const webSessionBackendFirst = webBackendShellText.includes('/api/v1/auth/session') && webBackendShellText.includes('backendFetch')

const storageEnvText = readText('apps/backend/src/config/env.ts')
const productionStorageGuard =
  storageEnvText.includes('production requires STORAGE_DRIVER=s3') &&
  storageEnvText.includes('STORAGE_PUBLIC_BASE_URL is required for s3 or production storage')
const databasePort = parsePortFromUrl(process.env.DATABASE_URL || 'postgresql://zhaoxiaogang:xiaochuang@localhost:5432/xiaochuang?schema=public', 5432)
const redisPort = parsePortFromUrl(process.env.REDIS_URL || 'redis://127.0.0.1:6379', 6379)
const minioPort = Number(process.env.MINIO_API_PORT || parsePortFromUrl(process.env.S3_ENDPOINT || 'http://127.0.0.1:9000', 9000))
let localRuntimePreflight = { ok: true, missing: [] }
let objectStoragePreflight = { ok: true, missing: [] }

const staticCommandNames = [
  ['verify:v2-boundaries', npmSpec(['run', 'verify:v2-boundaries'])],
  ['build:backend', npmSpec(['run', 'build:backend'])],
  ['build:web', npmSpec(['run', 'build:web'])],
  ['build:admin', npmSpec(['run', 'build:admin'])],
  ['build:contracts', npmSpec(['run', 'build:contracts'])],
]

for (const [name, [command, commandArgs]] of staticCommandNames) {
  runNamedCommand(name, command, commandArgs)
}

if (runLocalRuntime) {
  localRuntimePreflight = runPreflight('local-runtime', [
    { label: 'PostgreSQL', port: databasePort },
    { label: 'Redis', port: redisPort },
  ])
  if (localRuntimePreflight.ok) {
    for (const scriptName of ['storage:smoke', 'upload:smoke', 'queue:smoke', 'queue:smoke:ai']) {
      runNamedCommand(scriptName, ...npmSpec(['run', scriptName]))
    }
  }
}

if (runObjectStorage) {
  const objectStorageEnv = buildObjectStorageEnv()
  objectStoragePreflight = runPreflight('object-storage-runtime', [
    { label: 'MinIO/S3', port: minioPort },
  ])
  if (localRuntimePreflight.ok && objectStoragePreflight.ok) {
    for (const scriptName of [
      'storage:smoke:object-storage',
      'upload:smoke:object-storage',
      'queue:smoke:object-storage',
      'queue:smoke:ai:object-storage',
      'audit:object-storage',
    ]) {
      runNamedCommand(scriptName, ...npmSpec(['run', scriptName]), { env: objectStorageEnv })
    }
  }
}

function commandPassed(name) {
  return commandMap.get(name)?.ok === true
}

const criteria = [
  makeCriterion(
    1,
    '用户端和后台端都不再直接读写数据库',
    commandPassed('verify:v2-boundaries') && frontendDbMatches.length === 0 && webRiskDeps.filter((dep) => dep === 'pg' || dep === 'drizzle-orm' || dep === 'better-sqlite3').length === 0 && adminOnlyDbMatches.length === 0
      ? 'passed'
      : 'failed',
    [
      '`verify:v2-boundaries` 已通过',
      frontendDbMatches.length === 0 ? '未发现 web/admin runtime 直连数据库导入' : `发现越界导入: ${frontendDbMatches.join('; ')}`,
    ],
    ['verify:v2-boundaries', 'build:web', 'build:admin'],
  ),
  makeCriterion(
    2,
    '所有业务 API 都由 apps/backend 提供',
    commandPassed('verify:v2-boundaries') &&
      JSON.stringify(webRouteFiles) === JSON.stringify(expectedWebRouteFiles) &&
      JSON.stringify(adminRouteFiles) === JSON.stringify(expectedAdminRouteFiles)
      ? 'passed'
      : 'failed',
    [
      `web route handlers: ${webRouteFiles.join(', ') || '(empty)'}`,
      `admin route handlers: ${adminRouteFiles.join(', ') || '(empty)'}`,
    ],
    ['verify:v2-boundaries', 'build:web', 'build:admin', 'build:backend'],
  ),
  makeCriterion(
    3,
    '认证、角色、会话只有一套实现',
    !pathExists('apps/web/src/app/api/auth') &&
      !pathExists('apps/web/src/app/auth/callback') &&
      adminOnlyAuthMatches.length === 0 &&
      frontendAuthMatches.length === 0 &&
      adminRiskDeps.length === 0 &&
      adminLoginProxyOk &&
      adminLogoutProxyOk &&
      adminSessionBackendFirst &&
      webSessionBackendFirst
      ? 'passed'
      : 'failed',
    [
      pathExists('apps/web/src/app/api/auth') ? 'web 兼容 auth route 仍存在' : 'web 兼容 auth route 已移除',
      pathExists('apps/web/src/app/auth/callback') ? 'web auth callback fallback 仍存在' : 'web auth callback fallback 已移除',
      adminRiskDeps.length === 0 ? 'admin package 未携带自有 auth/db 风险依赖' : `admin 风险依赖: ${adminRiskDeps.join(', ')}`,
      adminLoginProxyOk ? 'admin login route 直接代理 backend `/api/v1/auth/login/password-session`' : 'admin login route 未直接代理 backend auth',
      adminLogoutProxyOk ? 'admin logout route 直接代理 backend `/api/v1/auth/logout`' : 'admin logout route 未直接代理 backend auth',
      adminSessionBackendFirst ? 'admin session 读取直接走 backend `/api/v1/auth/session`' : 'admin session 读取未直接走 backend auth session',
      webSessionBackendFirst ? 'web session 读取直接走 backend `/api/v1/auth/session`' : 'web session 读取未直接走 backend auth session',
      frontendAuthMatches.length === 0 ? '未发现 web/admin 引入第二套 auth 实现' : `发现额外 auth 痕迹: ${frontendAuthMatches.join('; ')}`,
    ],
    ['verify:v2-boundaries', 'build:web', 'build:admin', 'build:backend'],
  ),
  makeCriterion(
    4,
    '数据库 schema 只有一份真相源',
    pathExists('apps/backend/src/db/schema.ts') &&
      !pathExists('packages/shared') &&
      schemaMatchesOutsideBackend.length === 0
      ? 'passed'
      : 'failed',
    [
      pathExists('apps/backend/src/db/schema.ts') ? 'backend schema 真相源存在: `apps/backend/src/db/schema.ts`' : 'backend schema 真相源缺失',
      pathExists('packages/shared') ? '`packages/shared` 仍存在' : '`packages/shared` 已删除',
      schemaMatchesOutsideBackend.length === 0 ? '未发现 backend 外的 schema 定义' : `发现重复 schema 痕迹: ${schemaMatchesOutsideBackend.join('; ')}`,
    ],
    ['build:backend', 'build:contracts'],
  ),
  makeCriterion(
    5,
    '图片、视频、TTS、合成都已进入统一任务队列',
    runLocalRuntime
      ? commandPassed('queue:smoke') && commandPassed('queue:smoke:ai')
        ? 'passed'
        : 'failed'
      : 'skipped',
    runLocalRuntime
      ? [
          localRuntimePreflight.ok
            ? 'local runtime preflight 已通过（PostgreSQL + Redis 可连接）'
            : `local runtime preflight 未通过：${localRuntimePreflight.missing.join(', ')}`,
          commandPassed('queue:smoke') ? '`queue:smoke` 已通过（compose + merge）' : '`queue:smoke` 未通过',
          commandPassed('queue:smoke:ai') ? '`queue:smoke:ai` 已通过（image + video + TTS）' : '`queue:smoke:ai` 未通过',
        ]
      : ['quick 模式未执行运行时队列 smoke'],
    runLocalRuntime ? ['queue:smoke', 'queue:smoke:ai'] : [],
  ),
  makeCriterion(
    6,
    '对象存储替代本地文件成为主存储路径',
    runObjectStorage
      ? commandPassed('storage:smoke:object-storage') &&
        commandPassed('upload:smoke:object-storage') &&
        commandPassed('queue:smoke:object-storage') &&
        commandPassed('queue:smoke:ai:object-storage') &&
        commandPassed('audit:object-storage') &&
        productionStorageGuard
        ? 'passed'
        : 'failed'
      : 'skipped',
    runObjectStorage
      ? [
          objectStoragePreflight.ok
            ? 'object storage preflight 已通过（MinIO/S3 可连接）'
            : `object storage preflight 未通过：${objectStoragePreflight.missing.join(', ')}`,
          productionStorageGuard
            ? 'production/s3 存储环境校验已存在'
            : '缺少 production/s3 存储环境校验',
          commandPassed('storage:smoke:object-storage') ? '`storage:smoke:object-storage` 已通过' : '`storage:smoke:object-storage` 未通过',
          commandPassed('upload:smoke:object-storage') ? '`upload:smoke:object-storage` 已通过' : '`upload:smoke:object-storage` 未通过',
          commandPassed('queue:smoke:object-storage') ? '`queue:smoke:object-storage` 已通过' : '`queue:smoke:object-storage` 未通过',
          commandPassed('queue:smoke:ai:object-storage') ? '`queue:smoke:ai:object-storage` 已通过' : '`queue:smoke:ai:object-storage` 未通过',
          commandPassed('audit:object-storage') ? '`audit:object-storage` 已通过' : '`audit:object-storage` 未通过',
        ]
      : ['quick/local 模式未执行对象存储 gate'],
    runObjectStorage
      ? [
          'storage:smoke:object-storage',
          'upload:smoke:object-storage',
          'queue:smoke:object-storage',
          'queue:smoke:ai:object-storage',
          'audit:object-storage',
        ]
      : [],
  ),
  makeCriterion(
    7,
    '`admin` 不再保留自己的 schema/auth 体系',
    JSON.stringify(adminRouteFiles) === JSON.stringify(expectedAdminRouteFiles) &&
      adminOnlyDbMatches.length === 0 &&
      adminOnlyAuthMatches.length === 0 &&
      adminRiskDeps.length === 0 &&
      adminLoginProxyOk &&
      adminLogoutProxyOk &&
      adminSessionBackendFirst
      ? 'passed'
      : 'failed',
    [
      `admin route handlers: ${adminRouteFiles.join(', ') || '(empty)'}`,
      adminOnlyDbMatches.length === 0 ? 'admin 未发现 DB/schema runtime 越界导入' : `admin DB/schema 越界: ${adminOnlyDbMatches.join('; ')}`,
      adminOnlyAuthMatches.length === 0 ? 'admin 未发现第二套 auth 实现' : `admin auth 越界: ${adminOnlyAuthMatches.join('; ')}`,
      adminLoginProxyOk ? 'admin login route 直接代理 backend auth' : 'admin login route 未直接代理 backend auth',
      adminLogoutProxyOk ? 'admin logout route 直接代理 backend auth' : 'admin logout route 未直接代理 backend auth',
      adminSessionBackendFirst ? 'admin session 读取直接走 backend auth session' : 'admin session 读取未直接走 backend auth session',
      adminRiskDeps.length === 0 ? 'admin package 未携带 schema/auth 风险依赖' : `admin 风险依赖: ${adminRiskDeps.join(', ')}`,
    ],
    ['verify:v2-boundaries', 'build:admin'],
  ),
  makeCriterion(
    8,
    'next-app 风格的前后端耦合代码不再新增',
    commandPassed('verify:v2-boundaries') && !pathExists('next-app')
      ? 'passed'
      : 'failed',
    [
      pathExists('next-app') ? '`next-app/` 仍存在' : '`next-app/` 已删除',
      commandPassed('verify:v2-boundaries') ? '仓库级边界护栏已通过' : '仓库级边界护栏未通过',
    ],
    ['verify:v2-boundaries'],
  ),
]

const executedFailures = commandResults.filter((item) => !item.ok)
const completionGatePassed = criteria.every((item) => item.status === 'passed')
const executedChecksPassed = executedFailures.length === 0 && criteria.every((item) => item.status !== 'failed')
const exitOk = mode === 'full' ? completionGatePassed : executedChecksPassed

const report = {
  ok: exitOk,
  completion_gate_passed: completionGatePassed,
  mode,
  run_local_runtime: runLocalRuntime,
  run_object_storage: runObjectStorage,
  criteria,
  commands: commandResults.map((item) => ({
    name: item.name,
    ok: item.ok,
    status: item.status,
    duration_ms: item.durationMs,
    command: item.command,
    stdout_tail: formatTail(item.stdout),
    stderr_tail: formatTail(item.stderr),
  })),
}

if (outputJson) {
  console.log(JSON.stringify(report, null, 2))
} else {
  console.log(`V2.0 completion audit (${mode})`)
  for (const criterion of criteria) {
    const prefix =
      criterion.status === 'passed'
        ? '[PASS]'
        : criterion.status === 'failed'
          ? '[FAIL]'
          : '[SKIP]'
    console.log(`${prefix} ${criterion.id}. ${criterion.label}`)
    for (const line of criterion.evidence) {
      console.log(`  - ${line}`)
    }
  }

  if (executedFailures.length > 0) {
    console.log('')
    console.log('Failed commands:')
    for (const failure of executedFailures) {
      console.log(`- ${failure.name} (${failure.command})`)
      for (const line of formatTail(`${failure.stdout}\n${failure.stderr}`)) {
        console.log(`  ${line}`)
      }
    }
  }

  console.log('')
  console.log(`completion_gate_passed=${completionGatePassed}`)
  console.log(`mode=${mode}`)
  if (mode !== 'full') {
    console.log('note=quick/local mode does not cover the full object-storage completion gate')
  }
}

process.exit(exitOk ? 0 : 1)
