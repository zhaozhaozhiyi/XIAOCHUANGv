import 'reflect-metadata'

import { mkdir, writeFile } from 'node:fs/promises'
import fs from 'node:fs'
import path from 'node:path'

import { Logger } from '@nestjs/common'
import { SwaggerModule } from '@nestjs/swagger'

import { createBackendApp } from './app.factory'
import { openApiDocumentConfig } from './openapi'

function findWorkspaceRoot(startDir: string) {
  let currentDir = path.resolve(startDir)

  while (true) {
    const packageJsonPath = path.join(currentDir, 'package.json')
    if (fs.existsSync(packageJsonPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
          workspaces?: string[]
        }
        if (Array.isArray(pkg.workspaces) && pkg.workspaces.includes('apps/*') && pkg.workspaces.includes('packages/*')) {
          return currentDir
        }
      } catch {
        // Ignore invalid package.json while walking upward.
      }
    }

    const parentDir = path.dirname(currentDir)
    if (parentDir === currentDir) {
      return path.resolve(startDir)
    }
    currentDir = parentDir
  }
}

function resolveOutputPath() {
  const outputFlagIndex = process.argv.indexOf('--output')
  if (outputFlagIndex === -1) {
    return path.join(findWorkspaceRoot(process.cwd()), 'packages/contracts/openapi.json')
  }

  const outputArg = process.argv[outputFlagIndex + 1]
  if (!outputArg) {
    throw new Error('Missing value for --output')
  }

  return path.resolve(process.cwd(), outputArg)
}

async function main() {
  const logger = new Logger('OpenApiExport')
  const outputPath = resolveOutputPath()
  const { app } = await createBackendApp()

  try {
    const document = SwaggerModule.createDocument(
      app as any,
      openApiDocumentConfig,
    )
    await mkdir(path.dirname(outputPath), { recursive: true })
    await writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8')
    logger.log(`OpenAPI exported to ${outputPath}`)
  } finally {
    await app.close()
  }
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
