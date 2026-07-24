import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";

import { DatabaseService } from "../../db/database.service";
import {
  characters,
  episodeMediaProductionRuns,
  episodeMediaRunItems,
  scenes,
  storyboardBoundaries,
  storyboards,
} from "../../db/schema";
import { ContinuityTailFrameService } from "./continuity-tail-frame.service";

type RunStoryboard = Pick<
  typeof storyboards.$inferSelect,
  | "id"
  | "storyboardNumber"
  | "firstFrameImage"
  | "composedImage"
  | "lastFrameImage"
>;

type RunBoundary = Pick<
  typeof storyboardBoundaries.$inferSelect,
  "id" | "fromStoryboardId" | "toStoryboardId" | "relationType"
>;

export type ContinuityRunInput = {
  userId: number;
  dramaId: number;
  episodeId: number;
  storyboardSetId: number;
  storyboards: RunStoryboard[];
  boundaries: RunBoundary[];
};

export type ContinuityRunInstruction = {
  runId: number;
  runItemId: number;
  userId: number;
  dramaId: number;
  episodeId: number;
  storyboardId: number;
  startAnchorUrl: string;
  plannedEndAnchorUrl: string | null;
  referenceImageUrls: string[];
};

type PlannedItem = {
  storyboard: RunStoryboard;
  boundaryId: number | null;
  predecessorIndex: number | null;
  initialStartAnchorUrl: string | null;
};

function now() {
  return new Date();
}

function isTerminalItemStatus(status: string | null | undefined) {
  return ["completed", "failed", "blocked", "canceled"].includes(
    String(status || "").toLowerCase(),
  );
}

function parseJsonObject(value: string | null | undefined) {
  if (!value) return {} as Record<string, unknown>;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function toPositiveIdArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((item) => Number(item))
        .filter((item) => Number.isInteger(item) && item > 0),
    ),
  );
}

function parseUrlArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || "").trim()).filter(Boolean);
}

function parseReferenceImages(value: string | null | undefined) {
  if (!value) return [];
  try {
    return parseUrlArray(JSON.parse(value));
  } catch {
    return [];
  }
}

@Injectable()
export class ContinuityProductionService {
  constructor(
    @Inject(DatabaseService) private readonly databaseService: DatabaseService,
    @Inject(ContinuityTailFrameService)
    private readonly tailFrameService: ContinuityTailFrameService,
  ) {}

  private plan(input: ContinuityRunInput) {
    const storyboards = input.storyboards
      .slice()
      .sort((left, right) => left.storyboardNumber - right.storyboardNumber);
    const boundaries = new Map(
      input.boundaries.map((boundary) => [
        `${boundary.fromStoryboardId}:${boundary.toStoryboardId}`,
        boundary,
      ]),
    );
    const blocks: Array<{
      storyboard_id: number;
      code: string;
      message: string;
    }> = [];
    const items: PlannedItem[] = storyboards.map((storyboard, index) => {
      if (index === 0) {
        const startAnchor =
          storyboard.firstFrameImage || storyboard.composedImage || null;
        if (!startAnchor) {
          blocks.push({
            storyboard_id: storyboard.id,
            code: "continuity_first_anchor_missing",
            message: `镜头 ${storyboard.storyboardNumber} 缺少可用首帧，无法启动连续视频生产。`,
          });
        }
        return {
          storyboard,
          boundaryId: null,
          predecessorIndex: null,
          initialStartAnchorUrl: startAnchor,
        };
      }

      const predecessor = storyboards[index - 1];
      const boundary = boundaries.get(`${predecessor.id}:${storyboard.id}`);
      if (!boundary) {
        blocks.push({
          storyboard_id: storyboard.id,
          code: "continuity_contract_missing",
          message: `镜头 ${predecessor.storyboardNumber} 到镜头 ${storyboard.storyboardNumber} 缺少连续性合同。`,
        });
      }
      const waitsForTail = boundary?.relationType === "continuous";
      const startAnchor = waitsForTail
        ? null
        : storyboard.firstFrameImage || storyboard.composedImage || null;
      if (!waitsForTail && !startAnchor) {
        blocks.push({
          storyboard_id: storyboard.id,
          code: "continuity_start_anchor_missing",
          message: `镜头 ${storyboard.storyboardNumber} 缺少可用首帧，无法启动视频生产。`,
        });
      }
      return {
        storyboard,
        boundaryId: boundary?.id ?? null,
        predecessorIndex: waitsForTail ? index - 1 : null,
        initialStartAnchorUrl: startAnchor,
      };
    });

    return { storyboards, items, blocks };
  }

  previewRun(input: ContinuityRunInput) {
    const plan = this.plan(input);
    return {
      blocked: plan.blocks,
      will_generate: plan.items
        .filter(
          (item) => item.predecessorIndex == null && item.initialStartAnchorUrl,
        )
        .map((item) => ({
          storyboard_id: item.storyboard.id,
          mode: "anchor_from_assets",
        })),
      will_wait: plan.items
        .filter((item) => item.predecessorIndex != null)
        .map((item) => ({
          storyboard_id: item.storyboard.id,
          depends_on_storyboard_id:
            plan.items[item.predecessorIndex!].storyboard.id,
          reason: "等待上一镜的真实尾帧",
        })),
    };
  }

  async createRun(input: ContinuityRunInput) {
    const plan = this.plan(input);
    if (plan.blocks.length) {
      throw new ConflictException("continuity_run_preflight_failed");
    }
    const timestamp = now();
    const result = await this.databaseService.db.transaction(async (tx) => {
      const [run] = await tx
        .insert(episodeMediaProductionRuns)
        .values({
          userId: input.userId,
          dramaId: input.dramaId,
          episodeId: input.episodeId,
          storyboardSetId: input.storyboardSetId,
          status: "queued",
          runPlanJson: JSON.stringify({
            version: 1,
            storyboard_set_id: input.storyboardSetId,
            items: plan.items.map((item) => ({
              storyboard_id: item.storyboard.id,
              storyboard_number: item.storyboard.storyboardNumber,
              boundary_id: item.boundaryId,
              predecessor_storyboard_id:
                item.predecessorIndex == null
                  ? null
                  : plan.items[item.predecessorIndex].storyboard.id,
            })),
          }),
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .returning();

      const createdItems: Array<typeof episodeMediaRunItems.$inferSelect> = [];
      for (const [index, item] of plan.items.entries()) {
        const predecessor =
          item.predecessorIndex == null
            ? null
            : createdItems[item.predecessorIndex];
        const [created] = await tx
          .insert(episodeMediaRunItems)
          .values({
            productionRunId: run.id,
            storyboardId: item.storyboard.id,
            boundaryId: item.boundaryId,
            sequenceIndex: index + 1,
            predecessorItemId: predecessor?.id ?? null,
            status: predecessor ? "waiting_dependency" : "ready",
            startAnchorUrl: item.initialStartAnchorUrl,
            plannedEndAnchorUrl: item.storyboard.lastFrameImage ?? null,
            createdAt: timestamp,
            updatedAt: timestamp,
          })
          .returning();
        createdItems.push(created);
      }

      return { run, items: createdItems };
    });

    const readyInstructions = await Promise.all(
      result.items
        .filter((item) => item.status === "ready")
        .map((item) => this.getInstruction(item.id)),
    );
    return {
      run: result.run,
      readyInstructions: readyInstructions.filter(
        (instruction): instruction is ContinuityRunInstruction =>
          instruction != null,
      ),
    };
  }

  async getInstruction(
    runItemId: number,
  ): Promise<ContinuityRunInstruction | null> {
    const [item] = await this.databaseService.db
      .select()
      .from(episodeMediaRunItems)
      .where(eq(episodeMediaRunItems.id, runItemId));
    if (!item || item.status !== "ready" || !item.startAnchorUrl) return null;

    const runRows = await this.databaseService.db
      .select()
      .from(episodeMediaProductionRuns)
      .where(eq(episodeMediaProductionRuns.id, item.productionRunId));
    const storyboardRows = await this.databaseService.db
      .select()
      .from(storyboards)
      .where(
        and(
          eq(storyboards.id, item.storyboardId),
          isNull(storyboards.deletedAt),
        ),
      );
    const run = runRows[0];
    const storyboard = storyboardRows[0];
    if (!run || run.status === "canceled" || !storyboard) return null;

    return {
      runId: run.id,
      runItemId: item.id,
      userId: run.userId,
      dramaId: run.dramaId,
      episodeId: run.episodeId,
      storyboardId: storyboard.id,
      startAnchorUrl: item.startAnchorUrl,
      plannedEndAnchorUrl: item.plannedEndAnchorUrl,
      referenceImageUrls: await this.resolveLockedReferenceUrls(run, item),
    };
  }

  private async resolveLockedReferenceUrls(
    run: typeof episodeMediaProductionRuns.$inferSelect,
    item: typeof episodeMediaRunItems.$inferSelect,
  ) {
    if (!item.boundaryId) return [] as string[];
    const [boundary] = await this.databaseService.db
      .select()
      .from(storyboardBoundaries)
      .where(
        and(
          eq(storyboardBoundaries.id, item.boundaryId),
          eq(storyboardBoundaries.userId, run.userId),
          eq(storyboardBoundaries.dramaId, run.dramaId),
          eq(storyboardBoundaries.episodeId, run.episodeId),
          isNull(storyboardBoundaries.deletedAt),
        ),
      );
    if (!boundary) return [];

    const assetLock = parseJsonObject(boundary.assetLockJson);
    const characterIds = toPositiveIdArray(assetLock.character_ids);
    const sceneIds = toPositiveIdArray(assetLock.scene_ids);
    const [characterRows, sceneRows] = await Promise.all([
      characterIds.length
        ? this.databaseService.db
            .select()
            .from(characters)
            .where(
              and(
                eq(characters.userId, run.userId),
                eq(characters.dramaId, run.dramaId),
                inArray(characters.id, characterIds),
                isNull(characters.deletedAt),
              ),
            )
        : Promise.resolve([]),
      sceneIds.length
        ? this.databaseService.db
            .select()
            .from(scenes)
            .where(
              and(
                eq(scenes.userId, run.userId),
                eq(scenes.dramaId, run.dramaId),
                inArray(scenes.id, sceneIds),
                isNull(scenes.deletedAt),
              ),
            )
        : Promise.resolve([]),
    ]);

    return Array.from(
      new Set(
        [
          ...parseUrlArray(assetLock.reference_image_urls),
          ...characterRows.flatMap((character) => [
            String(character.imageUrl || "").trim(),
            ...parseReferenceImages(character.referenceImages),
          ]),
          ...sceneRows.map((scene) => String(scene.imageUrl || "").trim()),
        ].filter(Boolean),
      ),
    );
  }

  async bindVideoGeneration(runItemId: number, videoGenerationId: number) {
    const timestamp = now();
    const [item] = await this.databaseService.db
      .update(episodeMediaRunItems)
      .set({
        videoGenerationId,
        status: "generating",
        failureCode: null,
        failureDetail: null,
        updatedAt: timestamp,
      })
      .where(
        and(
          eq(episodeMediaRunItems.id, runItemId),
          eq(episodeMediaRunItems.status, "ready"),
        ),
      )
      .returning();
    if (!item) throw new ConflictException("continuity_run_item_not_ready");

    await this.databaseService.db
      .update(episodeMediaProductionRuns)
      .set({
        status: "running",
        currentStoryboardId: item.storyboardId,
        startedAt: timestamp,
        updatedAt: timestamp,
      })
      .where(eq(episodeMediaProductionRuns.id, item.productionRunId));
  }

  async markEnqueueFailed(runItemId: number, error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const [item] = await this.databaseService.db
      .select()
      .from(episodeMediaRunItems)
      .where(eq(episodeMediaRunItems.id, runItemId));
    if (!item) return;

    await this.databaseService.db
      .update(episodeMediaRunItems)
      .set({
        status: "failed",
        failureCode: "continuity_video_enqueue_failed",
        failureDetail: message.slice(0, 1000),
        updatedAt: now(),
      })
      .where(eq(episodeMediaRunItems.id, item.id));
    await this.blockDescendants(
      item.id,
      item.productionRunId,
      "continuity_upstream_enqueue_failed",
    );
    await this.finishRunIfComplete(item.productionRunId);
  }

  async completeVideoGeneration(videoGenerationId: number, videoUrl: string) {
    const [item] = await this.databaseService.db
      .select()
      .from(episodeMediaRunItems)
      .where(
        and(
          eq(episodeMediaRunItems.videoGenerationId, videoGenerationId),
          eq(episodeMediaRunItems.status, "generating"),
        ),
      );
    if (!item) return [] as ContinuityRunInstruction[];

    const [run] = await this.databaseService.db
      .select()
      .from(episodeMediaProductionRuns)
      .where(eq(episodeMediaProductionRuns.id, item.productionRunId));
    if (!run || run.status === "canceled") return [];

    let tailFrameUrl: string;
    try {
      tailFrameUrl = (await this.tailFrameService.extractTailFrame(videoUrl))
        .url;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.databaseService.db
        .update(episodeMediaRunItems)
        .set({
          status: "blocked",
          failureCode: "continuity_tail_frame_failed",
          failureDetail: message.slice(0, 1000),
          updatedAt: now(),
        })
        .where(eq(episodeMediaRunItems.id, item.id));
      await this.blockDescendants(
        item.id,
        item.productionRunId,
        "continuity_upstream_tail_frame_failed",
      );
      await this.finishRunIfComplete(item.productionRunId);
      return [];
    }

    let actualFirstFrameUrl: string;
    try {
      actualFirstFrameUrl =
        (await this.tailFrameService.extractFirstFrame(videoUrl)).url;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.databaseService.db
        .update(episodeMediaRunItems)
        .set({
          status: "blocked",
          failureCode: "continuity_first_frame_failed",
          failureDetail: message.slice(0, 1000),
          updatedAt: now(),
        })
        .where(eq(episodeMediaRunItems.id, item.id));
      await this.blockDescendants(
        item.id,
        item.productionRunId,
        "continuity_upstream_first_frame_failed",
      );
      await this.finishRunIfComplete(item.productionRunId);
      return [];
    }

    await this.databaseService.db
      .update(episodeMediaRunItems)
      .set({
        status: "completed",
        actualFirstFrameUrl,
        actualTailFrameUrl: tailFrameUrl,
        updatedAt: now(),
      })
      .where(eq(episodeMediaRunItems.id, item.id));
    if (item.boundaryId) {
      await this.databaseService.db
        .update(storyboardBoundaries)
        .set({
          status: "review_required",
          updatedAt: now(),
        })
        .where(eq(storyboardBoundaries.id, item.boundaryId));
    }

    const children = await this.databaseService.db
      .select()
      .from(episodeMediaRunItems)
      .where(
        and(
          eq(episodeMediaRunItems.predecessorItemId, item.id),
          eq(episodeMediaRunItems.status, "waiting_dependency"),
        ),
      );
    for (const child of children) {
      await this.databaseService.db
        .update(episodeMediaRunItems)
        .set({
          status: "ready",
          startAnchorUrl: tailFrameUrl,
          updatedAt: now(),
        })
        .where(eq(episodeMediaRunItems.id, child.id));
    }

    const instructions = await Promise.all(
      children.map((child) => this.getInstruction(child.id)),
    );
    await this.finishRunIfComplete(item.productionRunId);
    return instructions.filter(
      (instruction): instruction is ContinuityRunInstruction =>
        instruction != null,
    );
  }

  async markVideoGenerationFailed(videoGenerationId: number, error: unknown) {
    const [item] = await this.databaseService.db
      .select()
      .from(episodeMediaRunItems)
      .where(
        and(
          eq(episodeMediaRunItems.videoGenerationId, videoGenerationId),
          eq(episodeMediaRunItems.status, "generating"),
        ),
      );
    if (!item) return;
    const message = error instanceof Error ? error.message : String(error);
    await this.databaseService.db
      .update(episodeMediaRunItems)
      .set({
        status: "failed",
        failureCode: "continuity_video_generation_failed",
        failureDetail: message.slice(0, 1000),
        updatedAt: now(),
      })
      .where(eq(episodeMediaRunItems.id, item.id));
    await this.blockDescendants(
      item.id,
      item.productionRunId,
      "continuity_upstream_video_failed",
    );
    await this.finishRunIfComplete(item.productionRunId);
  }

  async markVideoGenerationCanceled(videoGenerationId: number, reason: unknown) {
    const [item] = await this.databaseService.db
      .select()
      .from(episodeMediaRunItems)
      .where(
        and(
          eq(episodeMediaRunItems.videoGenerationId, videoGenerationId),
          eq(episodeMediaRunItems.status, "generating"),
        ),
      );
    if (!item) return;

    const message =
      reason instanceof Error ? reason.message : String(reason || "Canceled");
    await this.databaseService.db
      .update(episodeMediaRunItems)
      .set({
        status: "canceled",
        failureCode: "continuity_video_generation_canceled",
        failureDetail: message.slice(0, 1000),
        updatedAt: now(),
      })
      .where(eq(episodeMediaRunItems.id, item.id));
    await this.blockDescendants(
      item.id,
      item.productionRunId,
      "continuity_upstream_video_canceled",
    );
    await this.finishRunIfComplete(item.productionRunId);
  }

  async retryVideoGeneration(input: {
    videoGenerationId: number;
    runId: number;
    userId: number;
    episodeId: number;
  }) {
    const [item] = await this.databaseService.db
      .select()
      .from(episodeMediaRunItems)
      .where(
        and(
          eq(episodeMediaRunItems.videoGenerationId, input.videoGenerationId),
          eq(episodeMediaRunItems.productionRunId, input.runId),
        ),
      );
    const [run] = await this.databaseService.db
      .select()
      .from(episodeMediaProductionRuns)
      .where(
        and(
          eq(episodeMediaProductionRuns.id, input.runId),
          eq(episodeMediaProductionRuns.userId, input.userId),
          eq(episodeMediaProductionRuns.episodeId, input.episodeId),
        ),
      );
    if (!item || !run || run.status === "canceled") {
      throw new ConflictException("continuity_run_required");
    }

    const timestamp = now();
    await this.databaseService.db
      .update(episodeMediaRunItems)
      .set({
        status: "generating",
        failureCode: null,
        failureDetail: null,
        updatedAt: timestamp,
      })
      .where(eq(episodeMediaRunItems.id, item.id));
    await this.databaseService.db
      .update(episodeMediaProductionRuns)
      .set({
        status: "running",
        currentStoryboardId: item.storyboardId,
        completedAt: null,
        updatedAt: timestamp,
      })
      .where(eq(episodeMediaProductionRuns.id, run.id));

    let predecessorItemIds = [item.id];
    while (predecessorItemIds.length) {
      const children = await this.databaseService.db
        .select()
        .from(episodeMediaRunItems)
        .where(
          and(
            eq(episodeMediaRunItems.productionRunId, run.id),
            inArray(
              episodeMediaRunItems.predecessorItemId,
              predecessorItemIds,
            ),
            eq(episodeMediaRunItems.status, "blocked"),
            inArray(episodeMediaRunItems.failureCode, [
              "continuity_upstream_video_failed",
              "continuity_upstream_video_canceled",
              "continuity_upstream_tail_frame_failed",
              "continuity_upstream_first_frame_failed",
              "continuity_upstream_enqueue_failed",
            ]),
            isNull(episodeMediaRunItems.videoGenerationId),
          ),
        );
      if (!children.length) break;

      await this.databaseService.db
        .update(episodeMediaRunItems)
        .set({
          status: "waiting_dependency",
          failureCode: null,
          failureDetail: null,
          updatedAt: timestamp,
        })
        .where(
          inArray(
            episodeMediaRunItems.id,
            children.map((child) => child.id),
          ),
        );
      predecessorItemIds = children.map((child) => child.id);
    }
  }

  private async blockDescendants(
    rootItemId: number,
    productionRunId: number,
    failureCode: string,
  ) {
    let parentIds = [rootItemId];
    while (parentIds.length) {
      const children = await this.databaseService.db
        .select()
        .from(episodeMediaRunItems)
        .where(
          and(
            eq(episodeMediaRunItems.productionRunId, productionRunId),
            inArray(episodeMediaRunItems.predecessorItemId, parentIds),
            eq(episodeMediaRunItems.status, "waiting_dependency"),
          ),
        );
      if (!children.length) return;
      await this.databaseService.db
        .update(episodeMediaRunItems)
        .set({
          status: "blocked",
          failureCode,
          updatedAt: now(),
        })
        .where(
          inArray(
            episodeMediaRunItems.id,
            children.map((child) => child.id),
          ),
        );
      parentIds = children.map((child) => child.id);
    }
  }

  private async finishRunIfComplete(runId: number) {
    const [runRows, items] = await Promise.all([
      this.databaseService.db
        .select()
        .from(episodeMediaProductionRuns)
        .where(eq(episodeMediaProductionRuns.id, runId)),
      this.databaseService.db
        .select()
        .from(episodeMediaRunItems)
        .where(eq(episodeMediaRunItems.productionRunId, runId)),
    ]);
    const run = runRows[0];
    if (!run || run.status === "canceled") return;
    if (
      !items.length ||
      !items.every((item) => isTerminalItemStatus(item.status))
    )
      return;
    const hasFailure = items.some((item) => item.status !== "completed");
    await this.databaseService.db
      .update(episodeMediaProductionRuns)
      .set({
        status: hasFailure ? "failed" : "completed",
        completedAt: now(),
        updatedAt: now(),
      })
      .where(eq(episodeMediaProductionRuns.id, runId));
  }

  async getRun(runId: number, userId: number) {
    const [run] = await this.databaseService.db
      .select()
      .from(episodeMediaProductionRuns)
      .where(
        and(
          eq(episodeMediaProductionRuns.id, runId),
          eq(episodeMediaProductionRuns.userId, userId),
        ),
      );
    if (!run)
      throw new NotFoundException("continuity_production_run_not_found");
    const items = await this.databaseService.db
      .select()
      .from(episodeMediaRunItems)
      .where(eq(episodeMediaRunItems.productionRunId, run.id))
      .orderBy(episodeMediaRunItems.sequenceIndex);
    return {
      id: run.id,
      episode_id: run.episodeId,
      storyboard_set_id: run.storyboardSetId,
      status: run.status,
      current_storyboard_id: run.currentStoryboardId,
      started_at: run.startedAt,
      completed_at: run.completedAt,
      items: items.map((item) => ({
        id: item.id,
        storyboard_id: item.storyboardId,
        boundary_id: item.boundaryId,
        sequence_index: item.sequenceIndex,
        predecessor_item_id: item.predecessorItemId,
        status: item.status,
        start_anchor_url: item.startAnchorUrl,
        planned_end_anchor_url: item.plannedEndAnchorUrl,
        actual_first_frame_url: item.actualFirstFrameUrl,
        actual_tail_frame_url: item.actualTailFrameUrl,
        video_generation_id: item.videoGenerationId,
        failure_code: item.failureCode,
        failure_detail: item.failureDetail,
      })),
    };
  }

  async getLatestRunForEpisode(episodeId: number, userId: number) {
    const runs = await this.databaseService.db
      .select()
      .from(episodeMediaProductionRuns)
      .where(
        and(
          eq(episodeMediaProductionRuns.episodeId, episodeId),
          eq(episodeMediaProductionRuns.userId, userId),
        ),
      )
      .orderBy(
        desc(episodeMediaProductionRuns.updatedAt),
        desc(episodeMediaProductionRuns.id),
      )
      .limit(1);
    const run = runs[0];
    return run ? this.getRun(run.id, userId) : null;
  }

  async cancelRun(runId: number, userId: number) {
    const [run] = await this.databaseService.db
      .select()
      .from(episodeMediaProductionRuns)
      .where(
        and(
          eq(episodeMediaProductionRuns.id, runId),
          eq(episodeMediaProductionRuns.userId, userId),
        ),
      );
    if (!run)
      throw new NotFoundException("continuity_production_run_not_found");
    const timestamp = now();
    await this.databaseService.db
      .update(episodeMediaProductionRuns)
      .set({
        status: "canceled",
        canceledAt: timestamp,
        completedAt: timestamp,
        updatedAt: timestamp,
      })
      .where(eq(episodeMediaProductionRuns.id, run.id));
    await this.databaseService.db
      .update(episodeMediaRunItems)
      .set({
        status: "canceled",
        failureCode: "continuity_run_canceled",
        failureDetail: "Canceled by user",
        updatedAt: timestamp,
      })
      .where(
        and(
          eq(episodeMediaRunItems.productionRunId, run.id),
          inArray(episodeMediaRunItems.status, [
            "waiting_dependency",
            "ready",
            "generating",
          ]),
        ),
      );
    return this.getRun(run.id, userId);
  }
}
