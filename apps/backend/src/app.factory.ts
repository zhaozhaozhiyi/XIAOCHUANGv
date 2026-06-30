import 'reflect-metadata'

import path from 'node:path'

import cookie from '@fastify/cookie'
import type { FastifyRequest } from 'fastify'
import { Logger } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'

import { AppModule } from './app.module'
import { loadEnv } from './config/env'
import { registerStorageStaticRoutes } from './modules/storage/storage.static'

const MULTIPART_BODY_LIMIT_BYTES = 25 * 1024 * 1024

export function hasFastifyStaticPackage() {
  try {
    require.resolve('@fastify/static')
    return true
  } catch {
    return false
  }
}

export async function createBackendApp() {
  const env = loadEnv()
  const adapter = new FastifyAdapter({
    logger: true,
    bodyLimit: MULTIPART_BODY_LIMIT_BYTES,
  })
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    adapter,
  )

  const fastify = app.getHttpAdapter().getInstance()
  fastify.addContentTypeParser(
    /^multipart\/form-data/i,
    { parseAs: 'buffer' },
    (
      _request: FastifyRequest,
      body: Buffer,
      done: (error: Error | null, value?: unknown) => void,
    ) => {
      done(null, body)
    },
  )

  await app.register(cookie)
  if (env.STORAGE_DRIVER === 'local') {
    registerStorageStaticRoutes(fastify, path.resolve(process.cwd(), env.STORAGE_LOCAL_PATH))
  } else {
    Logger.log('Local /static media route disabled because STORAGE_DRIVER is not local.', 'Bootstrap')
  }

  const origins = env.CORS_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)

  app.enableCors({
    origin: origins,
    credentials: true,
  })

  app.setGlobalPrefix('api/v1')

  return { app, env }
}
