import { Module } from "@nestjs/common";

import { AiConfigsModule } from "../ai-configs/ai-configs.module";
import { AssetsModule } from "../assets/assets.module";
import { AuthModule } from "../auth/auth.module";
import { CanvasModule } from "../canvas/canvas.module";
import { AudioModule } from "../audio/audio.module";
import { ImagesModule } from "../images/images.module";
import { MergeModule } from "../merge/merge.module";
import { TasksModule } from "../tasks/tasks.module";
import { VideosModule } from "../videos/videos.module";
import { DramaCanvasController } from "./drama-canvas.controller";
import { DramaCanvasProjectionService } from "./drama-canvas-projection.service";
import { DramaEpisodeContinuityController } from "./drama-episode-continuity.controller";
import { DramaEpisodeContinuityService } from "./drama-episode-continuity.service";
import { DramaDefaultSettingsController } from "./drama-default-settings.controller";
import { DramaDefaultSettingsService } from "./drama-default-settings.service";
import { DramaProductionBackfillModule } from "./drama-production-backfill.module";
import { DramaProjectAssetsController } from "./drama-project-assets.controller";
import { DramaProjectAssetsService } from "./drama-project-assets.service";
import { DramaProjectTasksController } from "./drama-project-tasks.controller";
import { DramaReviewController } from "./drama-review.controller";
import { DramaReviewService } from "./drama-review.service";
import { DramaShotProductionController } from "./drama-shot-production.controller";
import { DramaShotProductionService } from "./drama-shot-production.service";

@Module({
  imports: [
    AuthModule,
    CanvasModule,
    AssetsModule,
    AiConfigsModule,
    DramaProductionBackfillModule,
    ImagesModule,
    VideosModule,
    AudioModule,
    MergeModule,
    TasksModule,
  ],
  controllers: [
    DramaCanvasController,
    DramaProjectAssetsController,
    DramaDefaultSettingsController,
    DramaProjectTasksController,
    DramaReviewController,
    DramaShotProductionController,
    DramaEpisodeContinuityController,
  ],
  providers: [
    DramaCanvasProjectionService,
    DramaProjectAssetsService,
    DramaReviewService,
    DramaDefaultSettingsService,
    DramaShotProductionService,
    DramaEpisodeContinuityService,
  ],
  exports: [
    DramaCanvasProjectionService,
    DramaProjectAssetsService,
    DramaDefaultSettingsService,
    DramaShotProductionService,
    DramaEpisodeContinuityService,
  ],
})
export class DramaWorkspaceModule {}
