import { ConflictException, Inject, Injectable } from '@nestjs/common'
import { eq } from 'drizzle-orm'

import { DatabaseService } from '../../db/database.service'
import { tasks } from '../../db/schema'
import { DramaAdaptationBriefsTaskHandler } from './domain-handlers/drama-adaptation-briefs-task.handler'
import { DramaEpisodeBlueprintsTaskHandler } from './domain-handlers/drama-episode-blueprints-task.handler'
import { DramaPilotScriptsTaskHandler } from './domain-handlers/drama-pilot-scripts-task.handler'
import { DramaSourceAnalysisTaskHandler } from './domain-handlers/drama-source-analysis-task.handler'
import { DramaStoryGraphBuildTaskHandler } from './domain-handlers/drama-story-graph-build-task.handler'
import { EpisodeDialogueTakeTaskHandler } from './domain-handlers/episode-dialogue-take-task.handler'
import { ImageGenerationTaskHandler } from './domain-handlers/image-generation-task.handler'
import { StoryboardComposeTaskHandler } from './domain-handlers/storyboard-compose-task.handler'
import { StoryboardBreakdownTaskHandler } from './domain-handlers/storyboard-breakdown-task.handler'
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
    @Inject(EpisodeDialogueTakeTaskHandler) episodeDialogueTakeHandler: EpisodeDialogueTakeTaskHandler,
    @Inject(StoryboardComposeTaskHandler) storyboardComposeHandler: StoryboardComposeTaskHandler,
    @Inject(StoryboardBreakdownTaskHandler) storyboardBreakdownHandler: StoryboardBreakdownTaskHandler,
    @Inject(VideoMergeTaskHandler) videoMergeHandler: VideoMergeTaskHandler,
    @Inject(DramaSourceAnalysisTaskHandler) dramaSourceAnalysisHandler: DramaSourceAnalysisTaskHandler,
    @Inject(DramaAdaptationBriefsTaskHandler) dramaAdaptationBriefsHandler: DramaAdaptationBriefsTaskHandler,
    @Inject(DramaEpisodeBlueprintsTaskHandler) dramaEpisodeBlueprintsHandler: DramaEpisodeBlueprintsTaskHandler,
    @Inject(DramaPilotScriptsTaskHandler) dramaPilotScriptsHandler: DramaPilotScriptsTaskHandler,
    @Inject(DramaStoryGraphBuildTaskHandler) dramaStoryGraphBuildHandler: DramaStoryGraphBuildTaskHandler,
  ) {
    const handlers = [
      imageGenerationHandler,
      videoGenerationHandler,
      storyboardTtsHandler,
      episodeDialogueTakeHandler,
      storyboardComposeHandler,
      storyboardBreakdownHandler,
      videoMergeHandler,
      dramaSourceAnalysisHandler,
      dramaAdaptationBriefsHandler,
      dramaEpisodeBlueprintsHandler,
      dramaPilotScriptsHandler,
      dramaStoryGraphBuildHandler,
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

  private now() {
    return new Date()
  }

  private unsupportedDomainMessage(task: TaskRecord, actionLabel: string) {
    return `Unsupported task domain "${task.domainTable}" for ${actionLabel}`
  }

  private async markUnsupportedDomainTask(
    task: TaskRecord,
    status: 'failed' | 'canceled',
    errorKind: string,
    message: string,
  ) {
    const timestamp = this.now()
    await this.databaseService.db
      .update(tasks)
      .set({
        status,
        errorKind,
        errorMessage: message,
        errorDetailsJson: JSON.stringify({
          error_kind: errorKind,
          domain_table: task.domainTable,
          domain_id: task.domainId,
          raw_error: message,
        }),
        completedAt: timestamp,
        updatedAt: timestamp,
        lockedBy: null,
        lockedAt: null,
        lockExpiresAt: null,
      })
      .where(eq(tasks.id, task.id))
  }

  async markCanceled(task: TaskRecord) {
    const handler = this.getHandler(task)
    if (handler) return handler.markCanceled(task)

    await this.markUnsupportedDomainTask(
      task,
      'canceled',
      'canceled',
      this.unsupportedDomainMessage(task, 'cancel'),
    )
    return true
  }

  async markFailed(task: TaskRecord, error: unknown) {
    const handler = this.getHandler(task)
    if (handler) return handler.markFailed(task, error)

    const message = error instanceof Error ? error.message : this.unsupportedDomainMessage(task, 'failure')
    await this.markUnsupportedDomainTask(
      task,
      'failed',
      'unsupported_domain',
      `${this.unsupportedDomainMessage(task, 'failure')}: ${message}`,
    )
    return true
  }

  async execute(task: TaskRecord) {
    const handler = this.getHandler(task)
    if (handler) return handler.execute(task)

    await this.markFailed(task, new Error(this.unsupportedDomainMessage(task, 'execute')))
    return 'unknown_domain_failed'
  }
}
