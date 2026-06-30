import { Logger } from '@nestjs/common'

import { createBackendApp } from './app.factory'
import { setupOpenApiDocs } from './openapi'

async function bootstrap() {
  const { app, env } = await createBackendApp()
  setupOpenApiDocs(app)

  await app.listen(env.PORT, '127.0.0.1')

  const logger = new Logger('Bootstrap')
  logger.log(`Backend listening on http://localhost:${env.PORT}/api/v1`)
}

void bootstrap()
