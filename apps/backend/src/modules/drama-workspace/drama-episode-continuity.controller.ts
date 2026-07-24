import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";

import { CurrentUser } from "../auth/current-user.decorator";
import type { CurrentUser as CurrentUserType } from "../auth/auth.types";
import { SessionAuthGuard } from "../auth/session-auth.guard";
import { DramaEpisodeContinuityService } from "./drama-episode-continuity.service";

function parsePositiveId(value: string, code: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new BadRequestException(code);
  }
  return parsed;
}

@ApiTags("drama-workspace")
@Controller("episodes/:episodeId/continuity")
@UseGuards(SessionAuthGuard)
export class DramaEpisodeContinuityController {
  constructor(
    @Inject(DramaEpisodeContinuityService)
    private readonly continuityService: DramaEpisodeContinuityService,
  ) {}

  @Get()
  async get(
    @Param("episodeId") episodeIdValue: string,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    return this.continuityService.getContinuity(
      parsePositiveId(episodeIdValue, "invalid_episode_id"),
      currentUser.id,
    );
  }

  @Post("preflight")
  async preflight(
    @Param("episodeId") episodeIdValue: string,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    return this.continuityService.preflight(
      parsePositiveId(episodeIdValue, "invalid_episode_id"),
      currentUser.id,
    );
  }

  @Post("runs/preview")
  async previewRun(
    @Param("episodeId") episodeIdValue: string,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    return this.continuityService.previewRun(
      parsePositiveId(episodeIdValue, "invalid_episode_id"),
      currentUser.id,
    );
  }

  @Post("runs")
  async createRun(
    @Param("episodeId") episodeIdValue: string,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    return this.continuityService.createRun(
      parsePositiveId(episodeIdValue, "invalid_episode_id"),
      currentUser.id,
    );
  }

  @Get("runs/latest")
  async getLatestRun(
    @Param("episodeId") episodeIdValue: string,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    return this.continuityService.getLatestRun(
      parsePositiveId(episodeIdValue, "invalid_episode_id"),
      currentUser.id,
    );
  }

  @Get("runs/:runId")
  async getRun(
    @Param("episodeId") episodeIdValue: string,
    @Param("runId") runIdValue: string,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    return this.continuityService.getRun(
      parsePositiveId(episodeIdValue, "invalid_episode_id"),
      parsePositiveId(runIdValue, "invalid_continuity_run_id"),
      currentUser.id,
    );
  }

  @Post("runs/:runId/cancel")
  async cancelRun(
    @Param("episodeId") episodeIdValue: string,
    @Param("runId") runIdValue: string,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    return this.continuityService.cancelRun(
      parsePositiveId(episodeIdValue, "invalid_episode_id"),
      parsePositiveId(runIdValue, "invalid_continuity_run_id"),
      currentUser.id,
    );
  }

  @Post("runs/:runId/retry")
  async retryRun(
    @Param("episodeId") episodeIdValue: string,
    @Param("runId") runIdValue: string,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    return this.continuityService.retryRun(
      parsePositiveId(episodeIdValue, "invalid_episode_id"),
      parsePositiveId(runIdValue, "invalid_continuity_run_id"),
      currentUser.id,
    );
  }

  @Patch("boundaries/:boundaryId")
  async update(
    @Param("episodeId") episodeIdValue: string,
    @Param("boundaryId") boundaryIdValue: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    return this.continuityService.updateBoundary(
      parsePositiveId(episodeIdValue, "invalid_episode_id"),
      parsePositiveId(boundaryIdValue, "invalid_boundary_id"),
      currentUser.id,
      body,
    );
  }

  @Post("boundaries/:boundaryId/review")
  async review(
    @Param("episodeId") episodeIdValue: string,
    @Param("boundaryId") boundaryIdValue: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    return this.continuityService.reviewBoundary(
      parsePositiveId(episodeIdValue, "invalid_episode_id"),
      parsePositiveId(boundaryIdValue, "invalid_boundary_id"),
      currentUser.id,
      body,
    );
  }

  @Get("dialogue-takes")
  async getDialogueTakes(
    @Param("episodeId") episodeIdValue: string,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    return this.continuityService.getDialogueTakes(
      parsePositiveId(episodeIdValue, "invalid_episode_id"),
      currentUser.id,
    );
  }

  @Post("dialogue-takes/preview")
  async previewDialogueTakes(
    @Param("episodeId") episodeIdValue: string,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    return this.continuityService.previewDialogueTakes(
      parsePositiveId(episodeIdValue, "invalid_episode_id"),
      currentUser.id,
    );
  }

  @Post("dialogue-takes")
  async createDialogueTakes(
    @Param("episodeId") episodeIdValue: string,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    return this.continuityService.createDialogueTakes(
      parsePositiveId(episodeIdValue, "invalid_episode_id"),
      currentUser.id,
    );
  }

  @Post("dialogue-takes/:takeId/regenerate")
  async regenerateDialogueTake(
    @Param("episodeId") episodeIdValue: string,
    @Param("takeId") takeIdValue: string,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    return this.continuityService.regenerateDialogueTake(
      parsePositiveId(episodeIdValue, "invalid_episode_id"),
      parsePositiveId(takeIdValue, "invalid_dialogue_take_id"),
      currentUser.id,
    );
  }

  @Patch("dialogue-cues/:cueId")
  async updateDialogueCue(
    @Param("episodeId") episodeIdValue: string,
    @Param("cueId") cueIdValue: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    return this.continuityService.updateDialogueCue(
      parsePositiveId(episodeIdValue, "invalid_episode_id"),
      parsePositiveId(cueIdValue, "invalid_dialogue_cue_id"),
      currentUser.id,
      body,
    );
  }

  @Get("edit-revisions")
  async getEditRevisions(
    @Param("episodeId") episodeIdValue: string,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    return this.continuityService.getEditRevisions(
      parsePositiveId(episodeIdValue, "invalid_episode_id"),
      currentUser.id,
    );
  }

  @Post("edit-revisions/preview")
  async previewEditRevision(
    @Param("episodeId") episodeIdValue: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    return this.continuityService.previewEditRevision(
      parsePositiveId(episodeIdValue, "invalid_episode_id"),
      currentUser.id,
      body,
    );
  }

  @Post("edit-revisions")
  async createEditRevision(
    @Param("episodeId") episodeIdValue: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    return this.continuityService.createEditRevision(
      parsePositiveId(episodeIdValue, "invalid_episode_id"),
      currentUser.id,
      body,
    );
  }

  @Post("edit-revisions/:revisionId/approve")
  async approveEditRevision(
    @Param("episodeId") episodeIdValue: string,
    @Param("revisionId") revisionIdValue: string,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    return this.continuityService.approveEditRevision(
      parsePositiveId(episodeIdValue, "invalid_episode_id"),
      parsePositiveId(revisionIdValue, "invalid_episode_edit_revision_id"),
      currentUser.id,
    );
  }

  @Post("edit-revisions/:revisionId/render")
  async renderEditRevision(
    @Param("episodeId") episodeIdValue: string,
    @Param("revisionId") revisionIdValue: string,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    return this.continuityService.renderEditRevision(
      parsePositiveId(episodeIdValue, "invalid_episode_id"),
      parsePositiveId(revisionIdValue, "invalid_episode_edit_revision_id"),
      currentUser.id,
    );
  }
}
