import { Global, Module } from '@nestjs/common'

import { TaskQueueService } from './task-queue.service'

@Global()
@Module({
  providers: [TaskQueueService],
  exports: [TaskQueueService],
})
export class QueueModule {}
