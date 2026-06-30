#!/usr/bin/env node
/**
 * 在 next dev / next build 前检查当前 distDir 是否处于「半截」状态（进程被杀、并发写同一目录、
 * 清理工具删了部分文件等），避免 Next 仍监听端口但 routes-manifest 缺失导致异常。
 * 若出现「缺 chunk / API 返回 HTML 500」，请用 `npm run dev:clean` 清缓存。
 *
 * 与「每次强制删产物目录」不同：仅在检测到异常时才 rm，正常重启保持增量编译速度。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.resolve(__dirname, '..')
const distDir = process.env.NEXT_DIST_DIR || '.next'
const nextDir = path.join(appRoot, distDir)

function wipe(reason) {
  console.warn(`[web] ${reason}`)
  console.warn(`[web] removed ${path.relative(appRoot, nextDir) || distDir}/ — next will do a clean compile`)
  fs.rmSync(nextDir, { recursive: true, force: true })
}

function safeJson(pathname) {
  try {
    const raw = fs.readFileSync(pathname, 'utf8')
    JSON.parse(raw)
    return true
  } catch {
    return false
  }
}

function routeModuleExists(importPath, fromFile) {
  const resolved = path.resolve(path.dirname(fromFile), importPath)
  if (fs.existsSync(resolved)) return true

  const extension = path.extname(resolved)
  if (!extension) return false

  const withoutExtension = resolved.slice(0, -extension.length)
  return ['.js', '.jsx', '.ts', '.tsx'].some((candidateExtension) =>
    fs.existsSync(`${withoutExtension}${candidateExtension}`),
  )
}

function findMissingRouteModuleReference(validatorPath) {
  if (!fs.existsSync(validatorPath)) return null

  const raw = fs.readFileSync(validatorPath, 'utf8')
  const importPattern = /typeof import\("([^"]+)"\)/g

  for (const match of raw.matchAll(importPattern)) {
    const importPath = match[1]
    if (!routeModuleExists(importPath, validatorPath)) {
      return importPath
    }
  }

  return null
}

function main() {
  if (!fs.existsSync(nextDir)) return

  const routesManifest = path.join(nextDir, 'routes-manifest.json')
  const buildManifest = path.join(nextDir, 'build-manifest.json')
  const serverDir = path.join(nextDir, 'server')
  const typeValidator = path.join(nextDir, 'types', 'validator.ts')

  const hasRoutes = fs.existsSync(routesManifest)
  const hasBuild = fs.existsSync(buildManifest)
  const hasServer =
    fs.existsSync(serverDir) && fs.statSync(serverDir).isDirectory()

  if (hasServer && !hasRoutes) {
    return wipe('Incomplete Next.js cache: server/ exists but routes-manifest.json is missing')
  }
  if (hasServer && !hasBuild) {
    return wipe('Incomplete Next.js cache: server/ exists but build-manifest.json is missing')
  }

  if (hasRoutes && !safeJson(routesManifest)) {
    return wipe('Corrupt Next.js cache: routes-manifest.json is not valid JSON')
  }
  if (hasBuild && !safeJson(buildManifest)) {
    return wipe('Corrupt Next.js cache: build-manifest.json is not valid JSON')
  }

  const missingRouteModuleReference = findMissingRouteModuleReference(typeValidator)
  if (missingRouteModuleReference) {
    return wipe(`Stale Next.js cache: generated type validator references missing source module ${missingRouteModuleReference}`)
  }
}

main()
