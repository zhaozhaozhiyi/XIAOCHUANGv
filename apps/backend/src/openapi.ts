import { Logger } from '@nestjs/common'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'

import { hasFastifyStaticPackage } from './app.factory'

export const openApiDocumentConfig = new DocumentBuilder()
  .setTitle('XIAOCHUANG Backend API')
  .setDescription('V2.0 unified backend for web and admin clients')
  .setVersion('2.0.0')
  .build()

export function createOpenApiDocument(app: NestFastifyApplication) {
  return SwaggerModule.createDocument(app, openApiDocumentConfig)
}

export function setupOpenApiDocs(
  app: NestFastifyApplication,
  document = createOpenApiDocument(app),
) {
  const enableSwaggerUi = hasFastifyStaticPackage()
  SwaggerModule.setup('api/docs', app, document, {
    ui: enableSwaggerUi,
    raw: ['json', 'yaml'],
  })

  if (!enableSwaggerUi) {
    Logger.warn(
      'Swagger UI disabled because @fastify/static is not installed; raw OpenAPI docs remain available at /api/docs-json and /api/docs-yaml.',
      'Bootstrap',
    )
  }
}
