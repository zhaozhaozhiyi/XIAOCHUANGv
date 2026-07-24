import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const lockPath = path.join(repoRoot, 'deploy/hermes/upstream.lock.json')
const buildRoot = path.join(repoRoot, 'deploy/hermes/.build')
const preparedSource = path.join(buildRoot, 'hermes-agent')
const metadataFile = path.join(preparedSource, '.xiaochuang-source.json')
const args = new Set(process.argv.slice(2))
const GENERATED_ARTIFACT_NAMES = new Set([
  '.mypy_cache',
  '.pytest-cache',
  '.pytest_cache',
  '.ruff_cache',
  '.venv',
  '__pycache__',
])

if ([...args].some((arg) => arg !== '--check')) {
  throw new Error('Usage: node tools/prepare-hermes-source.mjs [--check]')
}

function sha256(contents) {
  return createHash('sha256').update(contents).digest('hex')
}

function run(command, commandArgs, options = {}) {
  const result = execFileSync(command, commandArgs, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
    timeout: options.timeout,
  })
  return options.capture ? result.trim() : result
}

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds)
}

function fetchPinnedRevision(directory, lock) {
  let lastError
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      run('git', [
        '-C',
        directory,
        '-c',
        'http.version=HTTP/1.1',
        'fetch',
        '--depth=1',
        '--no-tags',
        'origin',
        lock.source.revision,
      ], { timeout: 30_000 })
      return
    } catch (error) {
      lastError = error
      if (attempt < 3) {
        console.warn(`Hermes source fetch attempt ${attempt} failed; retrying...`)
        sleep(attempt * 1_500)
      }
    }
  }
  throw lastError
}

function isSafeRelativePath(value) {
  return typeof value === 'string'
    && value.length > 0
    && !path.isAbsolute(value)
    && !value.split('/').includes('..')
    && value === value.replaceAll('\\', '/')
}

function resolveInside(root, relativePath) {
  if (!isSafeRelativePath(relativePath)) {
    throw new Error(`Unsafe overlay path: ${String(relativePath)}`)
  }
  const resolved = path.resolve(root, relativePath)
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Overlay path escapes root: ${relativePath}`)
  }
  return resolved
}

function walkFiles(root, current = root) {
  const entries = fs.readdirSync(current, { withFileTypes: true })
  return entries.flatMap((entry) => {
    const target = path.join(current, entry.name)
    if (entry.isDirectory()) return walkFiles(root, target)
    if (!entry.isFile()) {
      throw new Error(`Overlay contains a non-file entry: ${target}`)
    }
    return [path.relative(root, target).replaceAll(path.sep, '/')]
  })
}

function generatedArtifactPaths(root, current = root) {
  if (!fs.existsSync(root)) return []
  const entries = fs.readdirSync(current, { withFileTypes: true })
  return entries.flatMap((entry) => {
    const target = path.join(current, entry.name)
    const relative = path.relative(root, target).replaceAll(path.sep, '/')
    if (
      GENERATED_ARTIFACT_NAMES.has(entry.name)
      || entry.name.endsWith('.egg-info')
    ) {
      return [relative]
    }
    if (entry.isDirectory()) return generatedArtifactPaths(root, target)
    return []
  })
}

function removeGeneratedArtifacts(root) {
  for (const relativePath of generatedArtifactPaths(root)) {
    fs.rmSync(path.join(root, relativePath), { recursive: true, force: true })
  }
}

function loadLock() {
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
  if (lock?.schemaVersion !== 1) {
    throw new Error('Unsupported Hermes upstream lock schema')
  }
  if (
    typeof lock?.source?.repository !== 'string'
    || !/^https:\/\/github\.com\/NousResearch\/hermes-agent\.git$/.test(lock.source.repository)
    || typeof lock.source.revision !== 'string'
    || !/^[0-9a-f]{40}$/.test(lock.source.revision)
    || typeof lock.source.projectVersion !== 'string'
  ) {
    throw new Error('Invalid Hermes upstream source lock')
  }
  if (
    !isSafeRelativePath(lock?.overlay?.directory)
    || !/^[0-9a-f]{64}$/.test(lock?.overlay?.sha256 || '')
    || !Array.isArray(lock.overlay.files)
    || lock.overlay.files.length === 0
  ) {
    throw new Error('Invalid Hermes overlay lock')
  }
  return lock
}

function validateOverlay(lock) {
  const overlayRoot = resolveInside(repoRoot, lock.overlay.directory)
  const files = lock.overlay.files.map((entry) => {
    if (
      !isSafeRelativePath(entry?.path)
      || !/^[0-9a-f]{64}$/.test(entry?.sha256 || '')
    ) {
      throw new Error('Invalid Hermes overlay entry')
    }
    const file = resolveInside(overlayRoot, entry.path)
    const stat = fs.lstatSync(file)
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`Overlay entry must be a regular file: ${entry.path}`)
    }
    const digest = sha256(fs.readFileSync(file))
    if (digest !== entry.sha256) {
      throw new Error(`Overlay hash mismatch: ${entry.path}`)
    }
    return { path: entry.path, sha256: digest, file }
  }).sort((left, right) => left.path.localeCompare(right.path))

  if (new Set(files.map((entry) => entry.path)).size !== files.length) {
    throw new Error('Hermes overlay lock has duplicate paths')
  }

  const actualPaths = walkFiles(overlayRoot).sort()
  const lockedPaths = files.map((entry) => entry.path)
  if (JSON.stringify(actualPaths) !== JSON.stringify(lockedPaths)) {
    throw new Error('Hermes overlay files and lock manifest differ')
  }

  const digest = sha256(
    files.map((entry) => `${entry.path}\0${entry.sha256}\n`).join(''),
  )
  if (digest !== lock.overlay.sha256) {
    throw new Error('Hermes overlay aggregate hash mismatch')
  }

  return { overlayRoot, files, digest }
}

function verifyPreparedSource(lock, overlay) {
  if (!fs.existsSync(metadataFile)) {
    throw new Error('Prepared Hermes source is missing; run npm run hermes:prepare')
  }

  const generatedArtifacts = generatedArtifactPaths(preparedSource)
  if (generatedArtifacts.length) {
    throw new Error(
      `Prepared Hermes source contains generated artifacts; run npm run hermes:prepare: ${generatedArtifacts.join(', ')}`,
    )
  }

  const metadata = JSON.parse(fs.readFileSync(metadataFile, 'utf8'))
  if (
    metadata?.source?.repository !== lock.source.repository
    || metadata?.source?.revision !== lock.source.revision
    || metadata?.source?.projectVersion !== lock.source.projectVersion
    || metadata?.overlay?.sha256 !== overlay.digest
  ) {
    throw new Error('Prepared Hermes source does not match upstream.lock.json')
  }

  for (const entry of overlay.files) {
    const target = resolveInside(preparedSource, entry.path)
    if (!fs.existsSync(target) || sha256(fs.readFileSync(target)) !== entry.sha256) {
      throw new Error(`Prepared Hermes source is missing overlay: ${entry.path}`)
    }
  }

  const project = fs.readFileSync(path.join(preparedSource, 'pyproject.toml'), 'utf8')
  const version = /^version\s*=\s*"([^"]+)"/m.exec(project)?.[1]
  if (version !== lock.source.projectVersion) {
    throw new Error(
      `Prepared Hermes project version ${version || 'unknown'} does not match ${lock.source.projectVersion}`,
    )
  }
}

function prepare(lock, overlay) {
  const temporarySource = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaochuang-hermes-'))
  try {
    run('git', ['init', '-q', temporarySource])
    run('git', ['-C', temporarySource, 'remote', 'add', 'origin', lock.source.repository])
    fetchPinnedRevision(temporarySource, lock)
    const revision = run('git', ['-C', temporarySource, 'rev-parse', 'FETCH_HEAD'], { capture: true })
    if (revision !== lock.source.revision) {
      throw new Error(`Fetched unexpected Hermes revision: ${revision}`)
    }
    run('git', ['-C', temporarySource, 'checkout', '-q', '--detach', 'FETCH_HEAD'])
    fs.rmSync(path.join(temporarySource, '.git'), { recursive: true, force: true })
    removeGeneratedArtifacts(temporarySource)

    for (const entry of overlay.files) {
      const target = resolveInside(temporarySource, entry.path)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.copyFileSync(entry.file, target)
    }

    fs.writeFileSync(
      path.join(temporarySource, '.xiaochuang-source.json'),
      `${JSON.stringify({
        source: lock.source,
        overlay: { sha256: overlay.digest, files: overlay.files.map(({ path, sha256 }) => ({ path, sha256 })) },
      }, null, 2)}\n`,
      'utf8',
    )

    fs.rmSync(buildRoot, { recursive: true, force: true })
    fs.mkdirSync(buildRoot, { recursive: true })
    fs.renameSync(temporarySource, preparedSource)
    verifyPreparedSource(lock, overlay)
  } catch (error) {
    fs.rmSync(temporarySource, { recursive: true, force: true })
    throw error
  }
}

const lock = loadLock()
const overlay = validateOverlay(lock)

if (args.has('--check')) {
  verifyPreparedSource(lock, overlay)
  console.log(`Hermes source verified: ${lock.source.revision} + ${overlay.digest}`)
} else {
  prepare(lock, overlay)
  console.log(`Hermes source prepared: ${lock.source.revision} + ${overlay.digest}`)
}
