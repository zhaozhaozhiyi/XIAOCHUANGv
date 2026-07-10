import { Logger } from '@nestjs/common'

import { createBackendApp } from './app.factory'
import { setupOpenApiDocs } from './openapi'

async function bootstrap() {
  const { app, env } = await createBackendApp()
  setupOpenApiDocs(app)

  const host = process.env.HOST || '127.0.0.1'
  await app.listen(env.PORT, host)

  const logger = new Logger('Bootstrap')
  logger.log(`Backend listening on http://${host}:${env.PORT}/api/v1`)
}

void bootstrap()
