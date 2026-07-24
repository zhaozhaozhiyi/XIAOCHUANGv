import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";

import { DatabaseService } from "../../db/database.service";
import {
  characters,
  dramas,
  episodeEditRevisions,
  episodeMediaProductionRuns,
  episodeMediaRunItems,
  episodes,
  scenes,
  storyboardBoundaries,
  storyboards,
} from "../../db/schema";
import { AiConfigResolverService } from "../ai-configs/ai-configs.resolver";
import { DialogueContinuityService } from "../audio/dialogue-continuity.service";
import { resolveProjectConfigId } from "../dramas/drama-metadata";
import { EpisodeEditPlanService } from "../merge/episode-edit-plan.service";
import { MergeService } from "../merge/merge.service";
import { TasksService } from "../tasks/tasks.service";
import { getVideoProviderCapabilities } from "../videos/videos.providers.registry";
import { ContinuityProductionService } from "../videos/continuity-production.service";
import { VideosService } from "../videos/videos.service";

type JsonObject = Record<string, unknown>;
type BoundaryReviewDecision = "approve" | "rework";

function parseJsonObject(value: string | null | undefined): JsonObject {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as JsonObject)
      : {};
  } catch {
    return {};
  }
}

function requireJsonObject(value: unknown, code: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException(code);
  }
  return value as JsonObject;
}

function toIdArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((item) => Number(item))
        .filter((item) => Number.isInteger(item) && item > 0),
    ),
  );
}

function hasVisualReference(
  imageUrl: string | null,
  referenceImages: string | null,
) {
  if (String(imageUrl || "").trim()) return true;
  try {
    return (
      Array.isArray(JSON.parse(referenceImages || "[]")) &&
      JSON.parse(referenceImages || "[]").some(Boolean)
    );
  } catch {
    return false;
  }
}

function normalizedRelationType(value: unknown) {
  return value === "continuous" || value === "intentional_cut" ? value : null;
}

function normalizedTransitionType(value: unknown) {
  return ["hard_cut", "match_cut", "dissolve", "fade"].includes(String(value))
    ? String(value)
    : null;
}

function requiresAudioDrivenLipSync(
  boundary: typeof storyboardBoundaries.$inferSelect,
) {
  const handoff = parseJsonObject(boundary.handoffJson);
  const dialogueHandoff =
    handoff.dialogue_handoff &&
    typeof handoff.dialogue_handoff === "object" &&
    !Array.isArray(handoff.dialogue_handoff)
      ? (handoff.dialogue_handoff as JsonObject)
      : {};
  return dialogueHandoff.sync_policy === "required";
}

function collectBoundaryContractValidationErrors(input: {
  relationType: string;
  openingState: JsonObject;
  closingState: JsonObject;
  handoff: JsonObject;
  assetLock: JsonObject;
}) {
  const errors: string[] = [];
  if (!String(input.handoff.action_handoff || "").trim()) {
    errors.push(
      input.relationType === "continuous"
        ? "continuity_action_handoff_missing"
        : "continuity_cut_intent_missing",
    );
  }
  if (input.relationType !== "continuous") return errors;

  if (!Object.keys(input.closingState).length) {
    errors.push("continuity_closing_state_missing");
  }
  if (!Object.keys(input.openingState).length) {
    errors.push("continuity_opening_state_missing");
  }
  if (
    !toIdArray(input.assetLock.character_ids).length &&
    !toIdArray(input.assetLock.scene_ids).length
  ) {
    errors.push("continuity_asset_lock_missing");
  }
  return errors;
}

function boundaryValidationMessage(
  code: string,
  fromStoryboardNumber: number,
  toStoryboardNumber: number,
) {
  const prefix = `镜头 ${fromStoryboardNumber} 到镜头 ${toStoryboardNumber}`;
  switch (code) {
    case "continuity_action_handoff_missing":
      return `${prefix} 缺少动作交接说明。`;
    case "continuity_cut_intent_missing":
      return `${prefix} 缺少有意跳转的叙事或剪辑意图。`;
    case "continuity_closing_state_missing":
      return `${prefix} 缺少上一镜结束状态。`;
    case "continuity_opening_state_missing":
      return `${prefix} 缺少下一镜起始状态。`;
    case "continuity_asset_lock_missing":
      return `${prefix} 缺少角色、场景或关键道具的视觉锁定。`;
    default:
      return `${prefix} 的连续性合同尚未补全。`;
  }
}

function block(code: string, message: string, boundaryId?: number) {
  return {
    boundary_id: boundaryId ?? null,
    code,
    message,
  };
}

@Injectable()
export class DramaEpisodeContinuityService {
  constructor(
    @Inject(DatabaseService) private readonly databaseService: DatabaseService,
    @Inject(AiConfigResolverService)
    private readonly aiConfigResolver: AiConfigResolverService,
    @Optional()
    @Inject(ContinuityProductionService)
    private readonly continuityProductionService?: ContinuityProductionService,
    @Optional()
    @Inject(VideosService)
    private readonly videosService?: VideosService,
    @Optional()
    @Inject(DialogueContinuityService)
    private readonly dialogueContinuityService?: DialogueContinuityService,
    @Optional()
    @Inject(EpisodeEditPlanService)
    private readonly episodeEditPlanService?: EpisodeEditPlanService,
    @Optional()
    @Inject(MergeService)
    private readonly mergeService?: MergeService,
    @Optional()
    @Inject(TasksService)
    private readonly tasksService?: TasksService,
  ) {}

  private now() {
    return new Date();
  }

  private async requireOwnedEpisode(episodeId: number, userId: number) {
    const [episode] = await this.databaseService.db
      .select()
      .from(episodes)
      .where(
        and(
          eq(episodes.id, episodeId),
          eq(episodes.userId, userId),
          isNull(episodes.deletedAt),
        ),
      );
    if (!episode) throw new NotFoundException("episode_not_found");

    const [drama] = await this.databaseService.db
      .select()
      .from(dramas)
      .where(
        and(
          eq(dramas.id, episode.dramaId),
          eq(dramas.userId, userId),
          isNull(dramas.deletedAt),
        ),
      );
    if (!drama) throw new NotFoundException("drama_not_found");
    return { episode, drama };
  }

  private async loadEpisodeState(episodeId: number, userId: number) {
    const ownership = await this.requireOwnedEpisode(episodeId, userId);
    const storyboardRows = await this.databaseService.db
      .select()
      .from(storyboards)
      .where(
        and(
          eq(storyboards.episodeId, episodeId),
          eq(storyboards.userId, userId),
          isNull(storyboards.deletedAt),
        ),
      )
      .orderBy(asc(storyboards.storyboardNumber));
    const storyboardSetIds = Array.from(
      new Set(
        storyboardRows
          .map((storyboard) => storyboard.storyboardSetId)
          .filter((id): id is number => id != null),
      ),
    );
    const boundaryRows = storyboardRows.length
      ? await this.databaseService.db
          .select()
          .from(storyboardBoundaries)
          .where(
            and(
              eq(storyboardBoundaries.episodeId, episodeId),
              eq(storyboardBoundaries.userId, userId),
              inArray(
                storyboardBoundaries.fromStoryboardId,
                storyboardRows.map((storyboard) => storyboard.id),
              ),
              isNull(storyboardBoundaries.deletedAt),
            ),
          )
      : [];

    return {
      ...ownership,
      storyboardRows,
      storyboardSetIds,
      boundaryRows:
        storyboardSetIds.length === 1
          ? boundaryRows.filter(
              (boundary) =>
                boundary.sourceStoryboardSetId === storyboardSetIds[0],
            )
          : boundaryRows,
    };
  }

  private async buildRunInput(episodeId: number, userId: number) {
    const state = await this.loadEpisodeState(episodeId, userId);
    if (state.storyboardSetIds.length !== 1 || !state.storyboardSetIds[0]) {
      throw new ConflictException("continuity_storyboard_set_inconsistent");
    }
    return {
      userId,
      dramaId: state.drama.id,
      episodeId,
      storyboardSetId: state.storyboardSetIds[0],
      storyboards: state.storyboardRows,
      boundaries: state.boundaryRows,
    };
  }

  private async markDraftEditRevisionsStale(
    episodeId: number,
    userId: number,
    reason: string,
  ) {
    await this.databaseService.db
      .update(episodeEditRevisions)
      .set({
        status: "stale",
        failureCode: "episode_edit_revision_stale",
        failureDetail: reason,
        updatedAt: this.now(),
      })
      .where(
        and(
          eq(episodeEditRevisions.episodeId, episodeId),
          eq(episodeEditRevisions.userId, userId),
          eq(episodeEditRevisions.status, "draft"),
          isNull(episodeEditRevisions.deletedAt),
        ),
      );
  }

  private async findReviewEvidence(
    boundary: typeof storyboardBoundaries.$inferSelect,
    userId: number,
  ) {
    const [latestRun] = await this.databaseService.db
      .select()
      .from(episodeMediaProductionRuns)
      .where(
        and(
          eq(episodeMediaProductionRuns.episodeId, boundary.episodeId),
          eq(episodeMediaProductionRuns.userId, userId),
        ),
      )
      .orderBy(desc(episodeMediaProductionRuns.id))
      .limit(1);
    if (
      !latestRun ||
      latestRun.status !== "completed" ||
      latestRun.storyboardSetId !== boundary.sourceStoryboardSetId
    ) {
      return null;
    }

    const runItems = await this.databaseService.db
      .select()
      .from(episodeMediaRunItems)
      .where(eq(episodeMediaRunItems.productionRunId, latestRun.id));
    const from = runItems.find(
      (item) =>
        item.storyboardId === boundary.fromStoryboardId &&
        item.status === "completed" &&
        Boolean(item.videoGenerationId) &&
        Boolean(item.actualTailFrameUrl),
    );
    const to = runItems.find(
      (item) =>
        item.storyboardId === boundary.toStoryboardId &&
        item.status === "completed" &&
        Boolean(item.videoGenerationId) &&
        Boolean(item.actualFirstFrameUrl),
    );
    if (!from || !to) return null;
    if (
      boundary.relationType === "continuous" &&
      (to.predecessorItemId !== from.id ||
        to.startAnchorUrl !== from.actualTailFrameUrl ||
        !to.actualFirstFrameUrl)
    ) {
      return null;
    }
    return { run: latestRun, from, to };
  }

  private requireProductionServices() {
    if (!this.continuityProductionService || !this.videosService) {
      throw new ConflictException("continuity_production_unavailable");
    }
    return {
      continuityProductionService: this.continuityProductionService,
      videosService: this.videosService,
    };
  }

  private requireM3Services() {
    if (
      !this.dialogueContinuityService ||
      !this.episodeEditPlanService ||
      !this.mergeService
    ) {
      throw new ConflictException("continuity_editing_unavailable");
    }
    return {
      dialogueContinuityService: this.dialogueContinuityService,
      episodeEditPlanService: this.episodeEditPlanService,
      mergeService: this.mergeService,
    };
  }

  private requireTaskService() {
    if (!this.tasksService) {
      throw new ConflictException("continuity_production_unavailable");
    }
    return this.tasksService;
  }

  private async assertNoActiveRun(episodeId: number, userId: number) {
    const [activeRun] = await this.databaseService.db
      .select({ id: episodeMediaProductionRuns.id })
      .from(episodeMediaProductionRuns)
      .where(
        and(
          eq(episodeMediaProductionRuns.episodeId, episodeId),
          eq(episodeMediaProductionRuns.userId, userId),
          inArray(episodeMediaProductionRuns.status, ["queued", "running"]),
        ),
      )
      .limit(1);
    if (activeRun) {
      throw new ConflictException("continuity_production_run_active");
    }
  }

  private serializeBoundary(
    boundary: typeof storyboardBoundaries.$inferSelect,
    storyboardById: Map<number, typeof storyboards.$inferSelect>,
  ) {
    const from = storyboardById.get(boundary.fromStoryboardId);
    const to = storyboardById.get(boundary.toStoryboardId);
    return {
      id: boundary.id,
      episode_id: boundary.episodeId,
      source_storyboard_set_id: boundary.sourceStoryboardSetId,
      from_storyboard_id: boundary.fromStoryboardId,
      to_storyboard_id: boundary.toStoryboardId,
      from_storyboard_number: from?.storyboardNumber ?? null,
      to_storyboard_number: to?.storyboardNumber ?? null,
      from_title: from?.title ?? null,
      to_title: to?.title ?? null,
      relation_type: boundary.relationType,
      transition_type: boundary.transitionType,
      opening_state: parseJsonObject(boundary.openingStateJson),
      closing_state: parseJsonObject(boundary.closingStateJson),
      handoff: parseJsonObject(boundary.handoffJson),
      asset_lock: parseJsonObject(boundary.assetLockJson),
      status: boundary.status,
      review: parseJsonObject(boundary.reviewJson),
      updated_at: boundary.updatedAt,
    };
  }

  async getContinuity(episodeId: number, userId: number) {
    const { storyboardRows, storyboardSetIds, boundaryRows } =
      await this.loadEpisodeState(episodeId, userId);
    const storyboardById = new Map(
      storyboardRows.map((storyboard) => [storyboard.id, storyboard]),
    );
    const expectedCount = Math.max(storyboardRows.length - 1, 0);
    return {
      episode_id: episodeId,
      storyboard_set_id:
        storyboardSetIds.length === 1 ? storyboardSetIds[0] : null,
      storyboard_count: storyboardRows.length,
      expected_boundary_count: expectedCount,
      boundaries: boundaryRows
        .sort((left, right) => {
          const leftNumber =
            storyboardById.get(left.fromStoryboardId)?.storyboardNumber ?? 0;
          const rightNumber =
            storyboardById.get(right.fromStoryboardId)?.storyboardNumber ?? 0;
          return leftNumber - rightNumber;
        })
        .map((boundary) => this.serializeBoundary(boundary, storyboardById)),
    };
  }

  private async resolveVideoProvider(
    episode: typeof episodes.$inferSelect,
    drama: typeof dramas.$inferSelect,
    userId: number,
  ) {
    const configuredId =
      episode.videoConfigId ??
      resolveProjectConfigId(drama.metadata, "video") ??
      null;
    try {
      const config = await this.aiConfigResolver.resolveConfig(
        "video",
        configuredId,
        userId,
      );
      return config.provider;
    } catch {
      return null;
    }
  }

  async preflight(episodeId: number, userId: number) {
    const { episode, drama, storyboardRows, storyboardSetIds, boundaryRows } =
      await this.loadEpisodeState(episodeId, userId);
    const blocks: Array<ReturnType<typeof block>> = [];
    const expectedPairs = storyboardRows
      .slice(0, -1)
      .map((storyboard, index) => ({
        from: storyboard,
        to: storyboardRows[index + 1],
      }));
    const boundaryByPair = new Map(
      boundaryRows.map((boundary) => [
        `${boundary.fromStoryboardId}:${boundary.toStoryboardId}`,
        boundary,
      ]),
    );

    if (!storyboardRows.length) {
      blocks.push(block("storyboards_missing", "请先生成并确认本集分镜。"));
    }

    for (const [index, storyboard] of storyboardRows.entries()) {
      const previous = storyboardRows[index - 1];
      const boundary =
        previous == null
          ? null
          : boundaryByPair.get(`${previous.id}:${storyboard.id}`);
      const needsOwnAnchor =
        index === 0 || boundary?.relationType === "intentional_cut";
      if (
        needsOwnAnchor &&
        !String(
          storyboard.firstFrameImage || storyboard.composedImage || "",
        ).trim()
      ) {
        blocks.push(
          block(
            index === 0
              ? "continuity_first_anchor_missing"
              : "continuity_start_anchor_missing",
            index === 0
              ? `镜头 ${storyboard.storyboardNumber} 缺少可用首帧，无法启动连续视频生产。`
              : `镜头 ${storyboard.storyboardNumber} 是有意跳转，缺少独立首帧。`,
            boundary?.id,
          ),
        );
      }
    }
    if (storyboardSetIds.length !== 1 && storyboardRows.length) {
      blocks.push(
        block(
          "storyboard_set_inconsistent",
          "当前分镜版本不完整，请重新确认分镜后再检查连续性。",
        ),
      );
    }

    const continuousBoundaries = expectedPairs
      .map((pair) => boundaryByPair.get(`${pair.from.id}:${pair.to.id}`))
      .filter(
        (boundary): boundary is typeof storyboardBoundaries.$inferSelect =>
          Boolean(boundary && boundary.relationType === "continuous"),
      );
    const requiredLipSyncBoundaries = expectedPairs
      .map((pair) => boundaryByPair.get(`${pair.from.id}:${pair.to.id}`))
      .filter(
        (boundary): boundary is typeof storyboardBoundaries.$inferSelect =>
          Boolean(boundary && requiresAudioDrivenLipSync(boundary)),
      );
    const characterIds = new Set<number>();
    const sceneIds = new Set<number>();

    for (const pair of expectedPairs) {
      const boundary = boundaryByPair.get(`${pair.from.id}:${pair.to.id}`);
      if (!boundary) {
        blocks.push(
          block(
            "continuity_contract_missing",
            `镜头 ${pair.from.storyboardNumber} 到镜头 ${pair.to.storyboardNumber} 尚未声明交接关系。`,
          ),
        );
        continue;
      }

      const validationErrors = collectBoundaryContractValidationErrors({
        relationType: boundary.relationType,
        openingState: parseJsonObject(boundary.openingStateJson),
        closingState: parseJsonObject(boundary.closingStateJson),
        handoff: parseJsonObject(boundary.handoffJson),
        assetLock: parseJsonObject(boundary.assetLockJson),
      });
      for (const error of validationErrors) {
        blocks.push(
          block(
            error,
            boundaryValidationMessage(
              error,
              pair.from.storyboardNumber,
              pair.to.storyboardNumber,
            ),
            boundary.id,
          ),
        );
      }

      if (boundary.status === "blocked" && !validationErrors.length) {
        blocks.push(
          block(
            "continuity_contract_blocked",
            `镜头 ${pair.from.storyboardNumber} 到镜头 ${pair.to.storyboardNumber} 需要先完善交接说明。`,
            boundary.id,
          ),
        );
      }
      if (boundary.relationType !== "continuous") continue;

      const assetLock = parseJsonObject(boundary.assetLockJson);
      for (const id of toIdArray(assetLock.character_ids)) characterIds.add(id);
      for (const id of toIdArray(assetLock.scene_ids)) sceneIds.add(id);
      if (
        !toIdArray(assetLock.character_ids).length &&
        !toIdArray(assetLock.scene_ids).length
      ) {
        blocks.push(
          block(
            "continuity_asset_lock_missing",
            `镜头 ${pair.from.storyboardNumber} 到镜头 ${pair.to.storyboardNumber} 缺少角色、场景或关键道具的视觉锁定。`,
            boundary.id,
          ),
        );
      }
    }

    const [characterRows, sceneRows, provider] = await Promise.all([
      characterIds.size
        ? this.databaseService.db
            .select()
            .from(characters)
            .where(
              and(
                inArray(characters.id, Array.from(characterIds)),
                eq(characters.dramaId, drama.id),
                eq(characters.userId, userId),
                isNull(characters.deletedAt),
              ),
            )
        : Promise.resolve([]),
      sceneIds.size
        ? this.databaseService.db
            .select()
            .from(scenes)
            .where(
              and(
                inArray(scenes.id, Array.from(sceneIds)),
                eq(scenes.dramaId, drama.id),
                eq(scenes.userId, userId),
                isNull(scenes.deletedAt),
              ),
            )
        : Promise.resolve([]),
      continuousBoundaries.length || requiredLipSyncBoundaries.length
        ? this.resolveVideoProvider(episode, drama, userId)
        : Promise.resolve(null),
    ]);

    const charactersById = new Map(
      characterRows.map((character) => [character.id, character]),
    );
    for (const characterId of characterIds) {
      const character = charactersById.get(characterId);
      if (
        !character ||
        !hasVisualReference(character.imageUrl, character.referenceImages)
      ) {
        blocks.push(
          block(
            "continuity_character_asset_missing",
            `连续镜头缺少已确认的角色视觉参考图（角色 ${characterId}）。`,
          ),
        );
      }
    }
    const scenesById = new Map(sceneRows.map((scene) => [scene.id, scene]));
    for (const sceneId of sceneIds) {
      if (!scenesById.get(sceneId)?.imageUrl) {
        blocks.push(
          block(
            "continuity_scene_asset_missing",
            `连续镜头缺少已确认的场景视觉参考图（场景 ${sceneId}）。`,
          ),
        );
      }
    }

    if (continuousBoundaries.length) {
      if (!provider) {
        blocks.push(
          block(
            "continuity_video_provider_missing",
            "请先配置可用于连续镜头的视频模型。",
          ),
        );
      } else {
        const capabilities = getVideoProviderCapabilities(provider);
        if (!capabilities.supportsStartAnchor) {
          blocks.push(
            block(
              "continuity_provider_start_anchor_unsupported",
              "当前视频模型不能使用上一镜尾帧承接下一镜，请切换兼容模型或将边界改为有意跳转。",
            ),
          );
        }
        if (!capabilities.supportsMultipleIdentityRefs) {
          for (const boundary of continuousBoundaries) {
            blocks.push(
              block(
                "continuity_provider_asset_lock_unsupported",
                "当前视频模型无法同时接收真实尾帧和锁定的角色/场景参考图，请切换兼容模型后再生成。",
                boundary.id,
              ),
            );
          }
        }
      }
    }
    if (requiredLipSyncBoundaries.length) {
      if (!provider) {
        for (const boundary of requiredLipSyncBoundaries) {
          blocks.push(
            block(
              "dialogue_sync_video_provider_missing",
              "该处镜头要求口型同步，请先配置实际支持音频驱动的视频模型。",
              boundary.id,
            ),
          );
        }
      } else if (
        !getVideoProviderCapabilities(provider).supportsAudioDrivenLipSync
      ) {
        for (const boundary of requiredLipSyncBoundaries) {
          blocks.push(
            block(
              "dialogue_sync_provider_unsupported",
              "该处镜头要求口型同步，但当前视频模型未声明支持可验证的音频驱动。请切换兼容模型，或将同步要求改为“优先同步/无需同步”。",
              boundary.id,
            ),
          );
        }
      }
    }

    return {
      ready: blocks.length === 0,
      episode_id: episodeId,
      storyboard_set_id:
        storyboardSetIds.length === 1 ? storyboardSetIds[0] : null,
      boundaries: {
        total: expectedPairs.length,
        continuous: continuousBoundaries.length,
        intentional_cuts: boundaryRows.filter(
          (boundary) => boundary.relationType === "intentional_cut",
        ).length,
        blocked: boundaryRows.filter(
          (boundary) => boundary.status === "blocked",
        ).length,
      },
      blocks,
    };
  }

  async updateBoundary(
    episodeId: number,
    boundaryId: number,
    userId: number,
    body: Record<string, unknown>,
  ) {
    const { episode } = await this.requireOwnedEpisode(episodeId, userId);
    await this.assertNoActiveRun(episodeId, userId);
    const [boundary] = await this.databaseService.db
      .select()
      .from(storyboardBoundaries)
      .where(
        and(
          eq(storyboardBoundaries.id, boundaryId),
          eq(storyboardBoundaries.episodeId, episode.id),
          eq(storyboardBoundaries.userId, userId),
          isNull(storyboardBoundaries.deletedAt),
        ),
      );
    if (!boundary) throw new NotFoundException("continuity_boundary_not_found");

    const relationType = Object.prototype.hasOwnProperty.call(
      body,
      "relation_type",
    )
      ? normalizedRelationType(body.relation_type)
      : boundary.relationType;
    if (!relationType)
      throw new BadRequestException("invalid_continuity_relation_type");
    const transitionType = Object.prototype.hasOwnProperty.call(
      body,
      "transition_type",
    )
      ? normalizedTransitionType(body.transition_type)
      : boundary.transitionType;
    if (!transitionType)
      throw new BadRequestException("invalid_continuity_transition_type");
    const openingState = Object.prototype.hasOwnProperty.call(
      body,
      "opening_state",
    )
      ? requireJsonObject(
          body.opening_state,
          "invalid_continuity_opening_state",
        )
      : parseJsonObject(boundary.openingStateJson);
    const closingState = Object.prototype.hasOwnProperty.call(
      body,
      "closing_state",
    )
      ? requireJsonObject(
          body.closing_state,
          "invalid_continuity_closing_state",
        )
      : parseJsonObject(boundary.closingStateJson);
    const handoff = Object.prototype.hasOwnProperty.call(body, "handoff")
      ? requireJsonObject(body.handoff, "invalid_continuity_handoff")
      : parseJsonObject(boundary.handoffJson);
    const assetLock = Object.prototype.hasOwnProperty.call(body, "asset_lock")
      ? requireJsonObject(body.asset_lock, "invalid_continuity_asset_lock")
      : parseJsonObject(boundary.assetLockJson);

    const validationErrors = collectBoundaryContractValidationErrors({
      relationType,
      openingState,
      closingState,
      handoff,
      assetLock,
    });
    const missing = validationErrors.length > 0;
    const timestamp = this.now();
    const review = {
      ...parseJsonObject(boundary.reviewJson),
      last_edited_by_user_id: userId,
      last_edited_at: timestamp.toISOString(),
      validation_errors: validationErrors,
    };
    await this.databaseService.db
      .update(storyboardBoundaries)
      .set({
        relationType,
        transitionType,
        openingStateJson: JSON.stringify(openingState),
        closingStateJson: JSON.stringify(closingState),
        handoffJson: JSON.stringify(handoff),
        assetLockJson: JSON.stringify(assetLock),
        status: missing ? "blocked" : "ready",
        reviewJson: JSON.stringify(review),
        updatedAt: timestamp,
      })
      .where(eq(storyboardBoundaries.id, boundary.id));
    await this.markDraftEditRevisionsStale(
      episodeId,
      userId,
      "镜头交接方案已修改，请重新检查并创建剪辑版本。",
    );

    return this.getContinuity(episodeId, userId);
  }

  async reviewBoundary(
    episodeId: number,
    boundaryId: number,
    userId: number,
    body: Record<string, unknown>,
  ) {
    await this.requireOwnedEpisode(episodeId, userId);
    const decision = String(
      body.decision || "",
    ).trim() as BoundaryReviewDecision;
    if (decision !== "approve" && decision !== "rework") {
      throw new BadRequestException("invalid_continuity_review_decision");
    }
    const [boundary] = await this.databaseService.db
      .select()
      .from(storyboardBoundaries)
      .where(
        and(
          eq(storyboardBoundaries.id, boundaryId),
          eq(storyboardBoundaries.episodeId, episodeId),
          eq(storyboardBoundaries.userId, userId),
          isNull(storyboardBoundaries.deletedAt),
        ),
      );
    if (!boundary) throw new NotFoundException("continuity_boundary_not_found");
    if (decision === "approve" && boundary.status === "blocked") {
      throw new ConflictException("continuity_boundary_blocked");
    }
    const evidence =
      decision === "approve"
        ? await this.findReviewEvidence(boundary, userId)
        : null;
    if (decision === "approve" && !evidence) {
      throw new ConflictException("continuity_boundary_video_not_ready");
    }

    const review = {
      ...parseJsonObject(boundary.reviewJson),
      human_decision: decision,
      human_note:
        typeof body.note === "string" ? body.note.trim() || null : null,
      reviewed_by_user_id: userId,
      reviewed_at: this.now().toISOString(),
      reviewed_production_run_id: evidence?.run.id ?? null,
      reviewed_from_run_item_id: evidence?.from.id ?? null,
      reviewed_to_run_item_id: evidence?.to.id ?? null,
    };
    await this.databaseService.db
      .update(storyboardBoundaries)
      .set({
        status: decision === "approve" ? "approved" : "rework_required",
        reviewJson: JSON.stringify(review),
        updatedAt: this.now(),
      })
      .where(eq(storyboardBoundaries.id, boundary.id));
    if (decision === "rework") {
      await this.markDraftEditRevisionsStale(
        episodeId,
        userId,
        "镜头交接被标记为需要重做，请重新检查并创建剪辑版本。",
      );
    }
    return this.getContinuity(episodeId, userId);
  }

  async previewRun(episodeId: number, userId: number) {
    const preflight = await this.preflight(episodeId, userId);
    if (!preflight.ready) {
      return {
        ...preflight,
        will_generate: [],
        will_wait: [],
      };
    }
    const { continuityProductionService } = this.requireProductionServices();
    return {
      ...preflight,
      ...continuityProductionService.previewRun(
        await this.buildRunInput(episodeId, userId),
      ),
    };
  }

  async createRun(episodeId: number, userId: number) {
    await this.assertNoActiveRun(episodeId, userId);
    const preflight = await this.preflight(episodeId, userId);
    if (!preflight.ready) {
      throw new ConflictException({
        code: "continuity_run_preflight_failed",
        blocks: preflight.blocks,
      });
    }
    const { continuityProductionService, videosService } =
      this.requireProductionServices();
    const created = await continuityProductionService.createRun(
      await this.buildRunInput(episodeId, userId),
    );
    const videoGenerationIds: number[] = [];
    const enqueueFailures: Array<{
      storyboard_id: number;
      code: string;
    }> = [];
    for (const instruction of created.readyInstructions) {
      try {
        videoGenerationIds.push(
          await videosService.enqueueContinuityRunItem(instruction),
        );
      } catch {
        enqueueFailures.push({
          storyboard_id: instruction.storyboardId,
          code: "continuity_video_enqueue_failed",
        });
      }
    }

    return {
      run: await continuityProductionService.getRun(created.run.id, userId),
      video_generation_ids: videoGenerationIds,
      enqueue_failures: enqueueFailures,
    };
  }

  async getRun(episodeId: number, runId: number, userId: number) {
    const { continuityProductionService } = this.requireProductionServices();
    const run = await continuityProductionService.getRun(runId, userId);
    if (run.episode_id !== episodeId) {
      throw new NotFoundException("continuity_production_run_not_found");
    }
    return run;
  }

  async getLatestRun(episodeId: number, userId: number) {
    await this.requireOwnedEpisode(episodeId, userId);
    const { continuityProductionService } = this.requireProductionServices();
    return continuityProductionService.getLatestRunForEpisode(
      episodeId,
      userId,
    );
  }

  async cancelRun(episodeId: number, runId: number, userId: number) {
    const run = await this.getRun(episodeId, runId, userId);
    if (run.status === "completed" || run.status === "failed") {
      throw new ConflictException("continuity_production_run_terminal");
    }
    const { continuityProductionService, videosService } =
      this.requireProductionServices();
    const activeVideoGenerationIds: number[] = [];
    for (const item of run.items) {
      const videoGenerationId =
        item.status === "generating" ? item.video_generation_id : null;
      if (
        typeof videoGenerationId === "number" &&
        Number.isInteger(videoGenerationId) &&
        videoGenerationId > 0
      ) {
        activeVideoGenerationIds.push(videoGenerationId);
      }
    }

    const canceledRun = await continuityProductionService.cancelRun(
      runId,
      userId,
    );
    for (const videoGenerationId of activeVideoGenerationIds) {
      try {
        await videosService.cancelVideoGeneration(
          videoGenerationId,
          "Canceled with continuity production run",
        );
      } catch (error) {
        console.error(
          "[DramaEpisodeContinuityService] Failed to cancel run video generation",
          { runId, videoGenerationId, error },
        );
      }
    }
    return canceledRun;
  }

  async retryRun(episodeId: number, runId: number, userId: number) {
    const run = await this.getRun(episodeId, runId, userId);
    if (run.status === "canceled") {
      throw new ConflictException("continuity_production_run_canceled");
    }
    if (run.status === "completed") {
      throw new ConflictException("continuity_production_run_terminal");
    }

    const videoGenerationIds = run.items
      .filter(
        (item) =>
          ["failed", "canceled"].includes(item.status) &&
          typeof item.video_generation_id === "number" &&
          item.video_generation_id > 0,
      )
      .map((item) => item.video_generation_id as number);
    const evidenceRecoveryItems = run.items.filter(
      (item) =>
        item.status === "blocked" &&
        typeof item.video_generation_id === "number" &&
        item.video_generation_id > 0 &&
        [
          "continuity_tail_frame_failed",
          "continuity_first_frame_failed",
        ].includes(String(item.failure_code || "")),
    );
    if (!videoGenerationIds.length && !evidenceRecoveryItems.length) {
      throw new ConflictException("continuity_retry_not_available");
    }

    const taskIds: number[] = [];
    if (videoGenerationIds.length) {
      const taskService = this.requireTaskService();
      for (const videoGenerationId of videoGenerationIds) {
        const task = await taskService.findRetryableVideoGenerationTask(
          videoGenerationId,
          userId,
        );
        if (!task) {
          throw new ConflictException("continuity_retry_not_available");
        }
        taskIds.push(task.id);
      }
    }
    for (const taskId of taskIds) {
      const taskService = this.requireTaskService();
      await taskService.retryTask(taskId, { id: userId });
    }
    if (evidenceRecoveryItems.length) {
      const { continuityProductionService, videosService } =
        this.requireProductionServices();
      for (const item of evidenceRecoveryItems) {
        const generation = await videosService.loadOwnedVideoGeneration(
          item.video_generation_id as number,
          userId,
        );
        if (!generation?.videoUrl) {
          throw new ConflictException("continuity_retry_not_available");
        }
        await continuityProductionService.completeVideoGeneration(
          generation.id,
          generation.videoUrl,
        );
      }
    }
    return this.getRun(episodeId, runId, userId);
  }

  async previewDialogueTakes(episodeId: number, userId: number) {
    const { dialogueContinuityService } = this.requireM3Services();
    return dialogueContinuityService.previewDialogueTakes(episodeId, userId);
  }

  async getDialogueTakes(episodeId: number, userId: number) {
    const { dialogueContinuityService } = this.requireM3Services();
    return dialogueContinuityService.getDialogueTakes(episodeId, userId);
  }

  async createDialogueTakes(episodeId: number, userId: number) {
    const { dialogueContinuityService } = this.requireM3Services();
    return dialogueContinuityService.createDialogueTakes(episodeId, userId);
  }

  async regenerateDialogueTake(
    episodeId: number,
    takeId: number,
    userId: number,
  ) {
    const { dialogueContinuityService } = this.requireM3Services();
    return dialogueContinuityService.regenerateDialogueTake(
      episodeId,
      takeId,
      userId,
    );
  }

  async updateDialogueCue(
    episodeId: number,
    cueId: number,
    userId: number,
    body: Record<string, unknown>,
  ) {
    const { dialogueContinuityService } = this.requireM3Services();
    return dialogueContinuityService.updateDialogueCue(
      episodeId,
      cueId,
      userId,
      body,
    );
  }

  async previewEditRevision(
    episodeId: number,
    userId: number,
    body: Record<string, unknown>,
  ) {
    const { episodeEditPlanService } = this.requireM3Services();
    return episodeEditPlanService.previewEditRevision(
      episodeId,
      userId,
      body,
    );
  }

  async createEditRevision(
    episodeId: number,
    userId: number,
    body: Record<string, unknown>,
  ) {
    const { episodeEditPlanService } = this.requireM3Services();
    return episodeEditPlanService.createEditRevision(
      episodeId,
      userId,
      body,
    );
  }

  async getEditRevisions(episodeId: number, userId: number) {
    const { episodeEditPlanService } = this.requireM3Services();
    return episodeEditPlanService.listEditRevisions(episodeId, userId);
  }

  async approveEditRevision(
    episodeId: number,
    revisionId: number,
    userId: number,
  ) {
    const { episodeEditPlanService } = this.requireM3Services();
    return episodeEditPlanService.approveEditRevision(
      episodeId,
      revisionId,
      userId,
    );
  }

  async renderEditRevision(
    episodeId: number,
    revisionId: number,
    userId: number,
  ) {
    const { episodeEditPlanService, mergeService } = this.requireM3Services();
    const revision = await episodeEditPlanService.getEditRevision(
      episodeId,
      revisionId,
      userId,
    );
    if (revision.status !== "approved") {
      throw new ConflictException("episode_edit_revision_not_approved");
    }
    const mergeId = await mergeService.enqueueEditRevision(
      revisionId,
      userId,
    );
    return { revision_id: revisionId, merge_id: mergeId, status: "queued" };
  }
}
