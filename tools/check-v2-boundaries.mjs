import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const runtimeRoots = [
  path.join(repoRoot, 'apps', 'web', 'src'),
  path.join(repoRoot, 'apps', 'admin', 'src'),
]

const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])

const importRules = [
  {
    label: 'runtime frontend must not import drizzle runtime',
    regex: /\b(?:from|import\s*\(|require\s*\()\s*['"]drizzle-orm(?:\/[^'"]*)?['"]/,
  },
  {
    label: 'runtime frontend must not import postgres client',
    regex: /\b(?:from|import\s*\(|require\s*\()\s*['"]pg['"]/,
  },
  {
    label: 'runtime frontend must not import better-sqlite3',
    regex: /\b(?:from|import\s*\(|require\s*\()\s*['"]better-sqlite3['"]/,
  },
  {
    label: 'runtime frontend must not import server/db modules',
    regex: /\b(?:from|import\s*\(|require\s*\()\s*['"][^'"]*server\/db(?:\/[^'"]*)?['"]/,
  },
]

const forbiddenPaths = [
  {
    label: 'legacy next-app workspace must stay removed',
    target: path.join(repoRoot, 'next-app'),
  },
  {
    label: 'legacy web auth compatibility routes must stay removed',
    target: path.join(repoRoot, 'apps', 'web', 'src', 'app', 'api', 'auth'),
  },
  {
    label: 'legacy web static proxy route must stay removed',
    target: path.join(repoRoot, 'apps', 'web', 'src', 'app', 'static'),
  },
  {
    label: 'legacy web auth callback fallback must stay removed',
    target: path.join(repoRoot, 'apps', 'web', 'src', 'app', 'auth', 'callback'),
  },
  {
    label: 'legacy web sqlite backfill script must stay removed',
    target: path.join(repoRoot, 'apps', 'web', 'scripts', 'backfill_assets.py'),
  },
  {
    label: 'legacy shared compatibility package must stay removed',
    target: path.join(repoRoot, 'packages', 'shared'),
  },
]

const exactFileSetRules = [
  {
    label: 'web server shell must stay minimal',
    root: path.join(repoRoot, 'apps', 'web', 'src', 'server'),
    files: [
      'backend.ts',
    ],
  },
  {
    label: 'web route handlers must stay limited to backend proxy shell',
    root: path.join(repoRoot, 'apps', 'web', 'src', 'app'),
    files: [
      'api/v1/[[...path]]/route.ts',
    ],
    filter: (relativePath) => relativePath.endsWith('/route.ts'),
  },
  {
    label: 'admin route handlers must stay limited to auth proxy shell',
    root: path.join(repoRoot, 'apps', 'admin', 'src', 'app'),
    files: [
      'api/admin/login/route.ts',
      'api/admin/logout/route.ts',
    ],
    filter: (relativePath) => relativePath.endsWith('/route.ts'),
  },
]

function walkFiles(dir) {
  if (!fs.existsSync(dir)) return []
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath))
      continue
    }
    if (!sourceExtensions.has(path.extname(entry.name))) continue
    files.push(fullPath)
  }

  return files
}

function normalizePathForCompare(target) {
  return target.split(path.sep).join('/')
}

function relativePath(target) {
  return path.relative(repoRoot, target) || '.'
}

const violations = []

for (const root of runtimeRoots) {
  for (const filePath of walkFiles(root)) {
    const content = fs.readFileSync(filePath, 'utf8')
    const lines = content.split(/\r?\n/)
    lines.forEach((line, index) => {
      for (const rule of importRules) {
        if (!rule.regex.test(line)) continue
        violations.push(`${relativePath(filePath)}:${index + 1} ${rule.label}`)
      }
    })
  }
}

for (const item of forbiddenPaths) {
  if (!fs.existsSync(item.target)) continue
  violations.push(`${relativePath(item.target)} ${item.label}`)
}

for (const rule of exactFileSetRules) {
  const actualFiles = walkFiles(rule.root)
    .map((filePath) => normalizePathForCompare(path.relative(rule.root, filePath)))
    .filter((relativeFile) => (rule.filter ? rule.filter(relativeFile) : true))
    .sort()
  const expectedFiles = [...rule.files].sort()

  if (JSON.stringify(actualFiles) === JSON.stringify(expectedFiles)) continue

  violations.push(
    `${relativePath(rule.root)} ${rule.label}; expected [${expectedFiles.join(', ')}] but found [${actualFiles.join(', ')}]`,
  )
}

if (violations.length > 0) {
  console.error('V2 boundary check failed:')
  for (const violation of violations) {
    console.error(`- ${violation}`)
  }
  process.exit(1)
}

console.log('V2 boundary check passed.')
