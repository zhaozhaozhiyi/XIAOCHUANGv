import { ConflictException } from "@nestjs/common";
import { and, eq, isNull } from "drizzle-orm";

import type { DatabaseService } from "../../db/database.service";
import {
  episodeMediaProductionRuns,
  episodeMediaRunItems,
  storyboardBoundaries,
  storyboardSets,
  storyboards,
} from "../../db/schema";

async function hasCurrentEpisodeContinuityContract(
  databaseService: DatabaseService,
  episodeId: number,
  userId: number,
) {
  const [boundary] = await databaseService.db
    .select({ id: storyboardBoundaries.id })
    .from(storyboardBoundaries)
    .innerJoin(
      storyboardSets,
      eq(
        storyboardBoundaries.sourceStoryboardSetId,
        storyboardSets.id,
      ),
    )
    .where(
      and(
        eq(storyboardBoundaries.episodeId, episodeId),
        eq(storyboardBoundaries.userId, userId),
        isNull(storyboardBoundaries.deletedAt),
        eq(storyboardSets.userId, userId),
        eq(storyboardSets.episodeId, episodeId),
        eq(storyboardSets.status, "ready"),
      ),
    )
    .limit(1);

  return Boolean(boundary);
}

export async function assertLegacyEpisodeProductionAllowed(
  databaseService: DatabaseService,
  episodeId: number,
  userId?: number | null,
) {
  if (userId == null) return;

  if (
    await hasCurrentEpisodeContinuityContract(
      databaseService,
      episodeId,
      userId,
    )
  ) {
    throw new ConflictException("continuity_edit_revision_required");
  }
}

function parsePositiveInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function assertContinuityVideoRetryAllowed(
  databaseService: DatabaseService,
  input: {
    episodeId: number | null | undefined;
    userId: number | null | undefined;
    videoGenerationId: number;
    storyboardId?: number | null;
    payload: Record<string, unknown>;
  },
) {
  let episodeId = input.episodeId;
  let userId = input.userId;
  if (input.storyboardId != null) {
    const [storyboard] = await databaseService.db
      .select({
        episodeId: storyboards.episodeId,
        userId: storyboards.userId,
      })
      .from(storyboards)
      .where(
        and(
          eq(storyboards.id, input.storyboardId),
          isNull(storyboards.deletedAt),
        ),
      )
      .limit(1);
    if (storyboard) {
      episodeId = storyboard.episodeId;
      userId = storyboard.userId;
    }
  }

  if (episodeId == null || userId == null) return null;

  const hasContinuity = await hasCurrentEpisodeContinuityContract(
    databaseService,
    episodeId,
    userId,
  );
  if (!hasContinuity) return null;

  const runId = parsePositiveInteger(input.payload.continuity_run_id);
  if (runId == null) {
    throw new ConflictException("continuity_run_required");
  }

  const [boundRunItem] = await databaseService.db
    .select({ id: episodeMediaRunItems.id })
    .from(episodeMediaRunItems)
    .innerJoin(
      episodeMediaProductionRuns,
      eq(
        episodeMediaRunItems.productionRunId,
        episodeMediaProductionRuns.id,
      ),
    )
    .where(
      and(
        eq(episodeMediaRunItems.videoGenerationId, input.videoGenerationId),
        eq(episodeMediaRunItems.productionRunId, runId),
        eq(episodeMediaProductionRuns.userId, userId),
        eq(episodeMediaProductionRuns.episodeId, episodeId),
      ),
    )
    .limit(1);

  if (!boundRunItem) {
    throw new ConflictException("continuity_run_required");
  }

  return { runId, userId, episodeId };
}
