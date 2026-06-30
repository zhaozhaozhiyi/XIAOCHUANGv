import { Module } from '@nestjs/common'

import { AuthModule } from '../auth/auth.module'
import { AudioModule } from '../audio/audio.module'
import { ImagesModule } from '../images/images.module'
import { VideosModule } from '../videos/videos.module'
import { BusinessActionService } from './business-action/business-action.service'
import { CanvasBusinessActionController } from './business-action/business-action.controller'
import { CanvasAssetService } from './canvas-asset.service'
import { CanvasChatAgentService } from './canvas-chat-agent.service'
import { CanvasController } from './canvas.controller'
import { CanvasFeaturesController } from './canvas-features.controller'
import { CanvasNodeResultService } from './canvas-node-result.service'
import { CanvasRunService } from './canvas-run.service'
import { CanvasSaveService } from './canvas-save.service'
import { CanvasService } from './canvas.service'
import { CanvasSkillService } from './canvas-skill.service'
import { CanvasUploadService } from './canvas-upload.service'
import { CanvasConcatService } from './execution/canvas-concat.service'
import { CanvasExecutionService } from './execution/canvas-execution.service'
import { CanvasInputResolverService } from './execution/canvas-input-resolver.service'
import { CanvasModuleRouterService } from './execution/canvas-module-router.service'
import { CanvasResultBackfillService } from './execution/canvas-result-backfill.service'
import { CanvasRunOrchestratorService } from './execution/canvas-run-orchestrator.service'
import { ExecutionPlanEngine } from './execution-plan/execution-plan.engine'
import { ExecutionPlanService } from './execution-plan/execution-plan.service'
import { CanvasRunController } from './run/run.controller'

@Module({
  imports: [AuthModule, ImagesModule, VideosModule, AudioModule],
  controllers: [
    CanvasController,
    CanvasRunController,
    CanvasBusinessActionController,
    CanvasFeaturesController,
  ],
  providers: [
    CanvasService,
    CanvasSaveService,
    CanvasRunService,
    CanvasNodeResultService,
    CanvasAssetService,
    CanvasUploadService,
    CanvasSkillService,
    CanvasChatAgentService,
    BusinessActionService,
    ExecutionPlanEngine,
    ExecutionPlanService,
    CanvasInputResolverService,
    CanvasModuleRouterService,
    CanvasConcatService,
    CanvasResultBackfillService,
    CanvasExecutionService,
    CanvasRunOrchestratorService,
  ],
  exports: [
    CanvasService,
    CanvasSaveService,
    CanvasRunService,
    CanvasNodeResultService,
    CanvasAssetService,
    BusinessActionService,
    CanvasExecutionService,
    CanvasRunOrchestratorService,
  ],
})
export class CanvasModule {}
