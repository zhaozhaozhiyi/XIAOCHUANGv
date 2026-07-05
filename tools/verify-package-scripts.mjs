import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const executableExtensions = new Set(['.cjs', '.js', '.mjs', '.py', '.sh', '.ts', '.tsx'])
const generatedRoots = new Set(['.next', 'build', 'coverage', 'dist'])
const localRunners = new Set(['bash', 'node', 'python', 'python3', 'sh', 'tsx'])
const shellSeparators = new Set(['&&', '||', ';', '|'])

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'))
}

function normalizePath(target) {
  return target.split(path.sep).join('/')
}

function relativePath(target) {
  return normalizePath(path.relative(repoRoot, target) || '.')
}

function tokenize(command) {
  const tokens = []
  let current = ''
  let quote = null

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]
    const next = command[index + 1]

    if (quote) {
      if (char === quote) {
        quote = null
        continue
      }
      if (char === '\\' && next) {
        current += next
        index += 1
        continue
      }
      current += char
      continue
    }

    if (char === '"' || char === "'") {
      quote = char
      continue
    }

    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current)
        current = ''
      }
      continue
    }

    if ((char === '&' && next === '&') || (char === '|' && next === '|')) {
      if (current) {
        tokens.push(current)
        current = ''
      }
      tokens.push(`${char}${next}`)
      index += 1
      continue
    }

    if (char === ';' || char === '|') {
      if (current) {
        tokens.push(current)
        current = ''
      }
      tokens.push(char)
      continue
    }

    current += char
  }

  if (current) tokens.push(current)
  return tokens
}

function discoverWorkspacePackageFiles(rootPackage) {
  const packageFiles = ['package.json']

  for (const pattern of rootPackage.workspaces || []) {
    if (!pattern.endsWith('/*')) continue

    const base = path.join(repoRoot, pattern.slice(0, -2))
    if (!fs.existsSync(base)) continue

    for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const packageFile = path.join(base, entry.name, 'package.json')
      if (!fs.existsSync(packageFile)) continue
      packageFiles.push(relativePath(packageFile))
    }
  }

  return packageFiles.sort()
}

function isGeneratedTarget(packageDir, token) {
  const cleanToken = token.split(/[?#]/)[0]
  const resolved = path.resolve(packageDir, cleanToken)
  const relativeToPackage = normalizePath(path.relative(packageDir, resolved))
  const firstSegment = relativeToPackage.split('/')[0]
  return generatedRoots.has(firstSegment)
}

function isLocalFileToken(token) {
  if (!token || token.startsWith('-')) return false
  if (token.includes('=') && !token.startsWith('./') && !token.startsWith('../')) return false

  const cleanToken = token.split(/[?#]/)[0]
  if (!executableExtensions.has(path.extname(cleanToken))) return false

  return cleanToken.startsWith('./') || cleanToken.startsWith('../') || cleanToken.includes('/')
}

function scanLocalFileReferences(packageFile, scriptName, command, packageDir, failures) {
  const tokens = tokenize(command)

  for (let index = 0; index < tokens.length; index += 1) {
    if (!localRunners.has(tokens[index])) continue

    for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
      const token = tokens[cursor]
      if (shellSeparators.has(token)) break
      if (!isLocalFileToken(token)) continue
      if (isGeneratedTarget(packageDir, token)) continue

      const target = path.resolve(packageDir, token.split(/[?#]/)[0])
      if (fs.existsSync(target)) continue

      failures.push({
        packageFile,
        scriptName,
        reason: `missing local file ${normalizePath(path.relative(packageDir, target))}`,
      })
    }
  }
}

function findOptionValue(tokens, names) {
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    for (const name of names) {
      if (token === name) return tokens[index + 1]
      if (token.startsWith(`${name}=`)) return token.slice(name.length + 1)
    }
  }
  return null
}

function scriptNameAfterRun(tokens, runIndex) {
  for (let index = runIndex + 1; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (shellSeparators.has(token) || token === '--') break
    if (token === '--workspace' || token === '-w' || token === '--prefix') {
      index += 1
      continue
    }
    if (token.startsWith('--workspace=') || token.startsWith('--prefix=')) continue
    if (token.startsWith('-')) continue
    return token
  }
  return null
}

function packageFileForNpmRun(tokens, currentPackageDir) {
  const workspace = findOptionValue(tokens, ['--workspace', '-w'])
  const prefix = findOptionValue(tokens, ['--prefix'])
  const packageDir = workspace
    ? path.resolve(repoRoot, workspace)
    : prefix
      ? path.resolve(currentPackageDir, prefix)
      : currentPackageDir

  return path.join(packageDir, 'package.json')
}

function scanNpmRunReferences(packageFile, scriptName, command, packageDir, packageByAbsoluteFile, failures) {
  const tokens = tokenize(command)

  for (let index = 0; index < tokens.length; index += 1) {
    if (path.basename(tokens[index]) !== 'npm') continue

    const segment = []
    for (let cursor = index; cursor < tokens.length; cursor += 1) {
      if (cursor !== index && shellSeparators.has(tokens[cursor])) break
      segment.push(tokens[cursor])
    }

    const runIndex = segment.indexOf('run')
    if (runIndex === -1) continue

    const targetScript = scriptNameAfterRun(segment, runIndex)
    if (!targetScript) continue

    const targetPackageFile = packageFileForNpmRun(segment, packageDir)
    const targetPackage = packageByAbsoluteFile.get(targetPackageFile)
    if (!targetPackage) {
      failures.push({
        packageFile,
        scriptName,
        reason: `missing npm package ${relativePath(targetPackageFile)}`,
      })
      continue
    }

    if (targetPackage.scripts?.[targetScript]) continue

    failures.push({
      packageFile,
      scriptName,
      reason: `missing npm script ${targetScript} in ${relativePath(targetPackageFile)}`,
    })
  }
}

const rootPackage = readJson('package.json')
const packageFiles = discoverWorkspacePackageFiles(rootPackage)
const packages = packageFiles.map((packageFile) => {
  const absoluteFile = path.join(repoRoot, packageFile)
  return {
    packageFile,
    absoluteFile,
    packageDir: path.dirname(absoluteFile),
    manifest: JSON.parse(fs.readFileSync(absoluteFile, 'utf8')),
  }
})
const packageByAbsoluteFile = new Map(packages.map((item) => [item.absoluteFile, item.manifest]))
const failures = []

for (const item of packages) {
  for (const [scriptName, command] of Object.entries(item.manifest.scripts || {})) {
    scanLocalFileReferences(item.packageFile, scriptName, command, item.packageDir, failures)
    scanNpmRunReferences(item.packageFile, scriptName, command, item.packageDir, packageByAbsoluteFile, failures)
  }
}

if (failures.length) {
  console.error('Package script verification failed:')
  for (const failure of failures) {
    console.error(`- ${failure.packageFile}:${failure.scriptName}: ${failure.reason}`)
  }
  process.exit(1)
}

console.log(`Package script verification passed (${packages.length} package.json files).`)
