import { ConflictException, Inject, Injectable } from '@nestjs/common'
import { eq } from 'drizzle-orm'

import { DatabaseService } from '../../db/database.service'
import { tasks } from '../../db/schema'
import { ImageGenerationTaskHandler } from './domain-handlers/image-generation-task.handler'
import { StoryboardComposeTaskHandler } from './domain-handlers/storyboard-compose-task.handler'
import { StoryboardTtsTaskHandler } from './domain-handlers/storyboard-tts-task.handler'
import type { TaskDomainHandler, TaskRecord } from './domain-handlers/task-domain-handler'
import { VideoGenerationTaskHandler } from './domain-handlers/video-generation-task.handler'
import { VideoMergeTaskHandler } from './domain-handlers/video-merge-task.handler'
import type { TaskActionResponse } from './tasks.types'

@Injectable()
export class TaskDomainRegistry {
  private readonly handlers: Map<string, TaskDomainHandler>

  constructor(
    @Inject(DatabaseService) private readonly databaseService: DatabaseService,
    @Inject(ImageGenerationTaskHandler) imageGenerationHandler: ImageGenerationTaskHandler,
    @Inject(VideoGenerationTaskHandler) videoGenerationHandler: VideoGenerationTaskHandler,
    @Inject(StoryboardTtsTaskHandler) storyboardTtsHandler: StoryboardTtsTaskHandler,
    @Inject(StoryboardComposeTaskHandler) storyboardComposeHandler: StoryboardComposeTaskHandler,
    @Inject(VideoMergeTaskHandler) videoMergeHandler: VideoMergeTaskHandler,
  ) {
    const handlers = [
      imageGenerationHandler,
      videoGenerationHandler,
      storyboardTtsHandler,
      storyboardComposeHandler,
      videoMergeHandler,
    ]
    this.handlers = new Map(handlers.map((handler) => [handler.domainTable, handler]))
  }

  private getHandler(task: TaskRecord) {
    return this.handlers.get(task.domainTable)
  }

  private requireHandler(task: TaskRecord, actionLabel: string) {
    const handler = this.getHandler(task)
    if (!handler) throw new ConflictException(`当前任务暂不支持${actionLabel}`)
    return handler
  }

  async retry(task: TaskRecord, payload: Record<string, unknown>): Promise<TaskActionResponse> {
    return this.requireHandler(task, '重试').retry(task, payload)
  }

  async cancel(task: TaskRecord, currentUserId: number): Promise<TaskActionResponse> {
    return this.requireHandler(task, '取消').cancel(task, currentUserId)
  }

  async refreshPresentation(taskId: number) {
    const [task] = await this.databaseService.db
      .select()
      .from(tasks)
      .where(eq(tasks.id, taskId))

    if (!task) return
    await this.getHandler(task)?.refreshPresentation(task)
  }

  async markCanceled(task: TaskRecord) {
    return await this.getHandler(task)?.markCanceled(task) ?? false
  }

  async markFailed(task: TaskRecord, error: unknown) {
    return await this.getHandler(task)?.markFailed(task, error) ?? false
  }

  async execute(task: TaskRecord) {
    return await this.getHandler(task)?.execute(task) ?? 'unknown'
  }
}
