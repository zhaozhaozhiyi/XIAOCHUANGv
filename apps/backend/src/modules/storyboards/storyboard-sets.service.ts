import { createHash } from "node:crypto";

import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, desc, eq, isNull } from "drizzle-orm";

import { DatabaseService } from "../../db/database.service";
import {
  characters,
  dramaStoryGraphs,
  episodeCharacters,
  episodes,
  episodeScenes,
  scenes,
  storyboardBoundaries,
  storyboardCharacters,
  storyboardSetItems,
  storyboardSets,
  storyboards,
} from "../../db/schema";
import type { StoryboardSaveInput } from "../agents/agents.types";

export type StoryboardSetDraftInput = {
  userId: number;
  dramaId: number;
  episodeId: number;
  sourceTaskId?: number | null;
  sourceExecutionId?: number | null;
  episodeScriptHash: string;
  storyGraphId?: number | null;
  storyGraphScriptHash?: string | null;
  baseRevision?: number | null;
  baseContentHash?: string | null;
  storyboards: StoryboardSaveInput[];
};

export type StoryboardBaseline = {
  activeSetId: number | null;
  revision: number | null;
  contentHash: string | null;
  storyboardCount: number;
  hasLegacyRows: boolean;
  hasMixedSets: boolean;
  humanEditedAt: Date | null;
  hasProducedMedia: boolean;
};

export type StoryboardSetPublishResult = {
  setId: number;
  revision: number;
  status: "ready" | "review_required";
  storyboardCount: number;
  requiresReview: boolean;
};

export type StoryboardDraftPreview = {
  id: number;
  dramaId: number;
  episodeId: number;
  revision: number;
  status: string;
  origin: string;
  sourceTaskId: number | null;
  sourceExecutionId: number | null;
  baseRevision: number | null;
  baseContentHash: string | null;
  createdAt: Date;
  updatedAt: Date;
  currentBaseline: StoryboardBaseline;
  items: NormalizedStoryboard[];
};

type NormalizedStoryboard = {
  shot_number: number;
  title?: string;
  shot_type?: string;
  angle?: string;
  movement?: string;
  location?: string;
  time?: string;
  action?: string;
  dialogue?: string;
  description?: string;
  result?: string;
  atmosphere?: string;
  image_prompt?: string;
  video_prompt?: string;
  bgm_prompt?: string;
  sound_effect?: string;
  duration: number;
  scene_id: number | null;
  character_ids: number[];
  opening_state?: Record<string, unknown>;
  closing_state?: Record<string, unknown>;
  continuity_to_next?: NormalizedContinuityToNext;
};

type NormalizedContinuityToNext = {
  relation_type?: "continuous" | "intentional_cut";
  transition_type?: "hard_cut" | "match_cut" | "dissolve" | "fade";
  action_handoff?: string;
  audio_bridge?: string;
  dialogue_handoff?: Record<string, unknown>;
  continuity_notes?: string[];
  asset_lock?: Record<string, unknown>;
};

type CompiledBoundary = {
  relationType: "continuous" | "intentional_cut";
  transitionType: "hard_cut" | "match_cut" | "dissolve" | "fade";
  openingState: Record<string, unknown>;
  closingState: Record<string, unknown>;
  handoff: Record<string, unknown>;
  assetLock: Record<string, unknown>;
  status: "ready" | "blocked";
  review: Record<string, unknown>;
};

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: unknown) {
  return createHash("sha256")
    .update(typeof value === "string" ? value : canonicalJson(value), "utf8")
    .digest("hex");
}

function asText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function optionalText(value: unknown) {
  const text = asText(value);
  return text || undefined;
}

function positiveInteger(value: unknown, label: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ConflictException(`storyboard_set_invalid_${label}`);
  }
  return parsed;
}

function optionalPositiveInteger(value: unknown, label: string) {
  if (value == null || value === "") return undefined;
  return positiveInteger(value, label);
}

function optionalJsonObject(value: unknown, label: string) {
  if (value == null) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ConflictException(`storyboard_set_invalid_${label}`);
  }
  return value as Record<string, unknown>;
}

function optionalTextArray(value: unknown, label: string) {
  if (value == null) return undefined;
  if (!Array.isArray(value)) {
    throw new ConflictException(`storyboard_set_invalid_${label}`);
  }
  return value
    .map((item) => optionalText(item))
    .filter((item): item is string => Boolean(item));
}

function normalizeContinuityToNext(
  value: unknown,
): NormalizedContinuityToNext | undefined {
  const raw = optionalJsonObject(value, "continuity_to_next");
  if (!raw) return undefined;

  const relationType = optionalText(raw.relation_type);
  if (
    relationType &&
    relationType !== "continuous" &&
    relationType !== "intentional_cut"
  ) {
    throw new ConflictException("storyboard_set_invalid_relation_type");
  }
  const transitionType = optionalText(raw.transition_type);
  if (
    transitionType &&
    !["hard_cut", "match_cut", "dissolve", "fade"].includes(transitionType)
  ) {
    throw new ConflictException("storyboard_set_invalid_transition_type");
  }

  return {
    relation_type: relationType as "continuous" | "intentional_cut" | undefined,
    transition_type: transitionType as
      | "hard_cut"
      | "match_cut"
      | "dissolve"
      | "fade"
      | undefined,
    action_handoff: optionalText(raw.action_handoff),
    audio_bridge: optionalText(raw.audio_bridge),
    dialogue_handoff: optionalJsonObject(
      raw.dialogue_handoff,
      "dialogue_handoff",
    ),
    continuity_notes: optionalTextArray(
      raw.continuity_notes,
      "continuity_notes",
    ),
    asset_lock: optionalJsonObject(raw.asset_lock, "asset_lock"),
  };
}

function parseStoryboardItem(value: string): StoryboardSaveInput {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as StoryboardSaveInput;
    }
  } catch {
    // The set is corrupted. Publishing it must not silently create partial
    // production rows.
  }
  throw new ConflictException("storyboard_set_item_invalid");
}

function normalizeStoryboard(value: StoryboardSaveInput): NormalizedStoryboard {
  const shotNumber = positiveInteger(value.shot_number, "shot_number");
  const description = optionalText(value.description);
  const action = optionalText(value.action);
  if (!description && !action) {
    throw new ConflictException("storyboard_set_item_content_required");
  }

  const characterIds = Array.from(
    new Set(
      (Array.isArray(value.character_ids) ? value.character_ids : [])
        .map((id) => optionalPositiveInteger(id, "character_id"))
        .filter((id): id is number => id != null),
    ),
  );

  return {
    shot_number: shotNumber,
    title: optionalText(value.title),
    shot_type: optionalText(value.shot_type),
    angle: optionalText(value.angle),
    movement: optionalText(value.movement),
    location: optionalText(value.location),
    time: optionalText(value.time),
    action,
    dialogue: optionalText(value.dialogue),
    description,
    result: optionalText(value.result),
    atmosphere: optionalText(value.atmosphere),
    image_prompt: optionalText(value.image_prompt),
    video_prompt: optionalText(value.video_prompt),
    bgm_prompt: optionalText(value.bgm_prompt),
    sound_effect: optionalText(value.sound_effect),
    duration: optionalPositiveInteger(value.duration, "duration") ?? 10,
    scene_id: optionalPositiveInteger(value.scene_id, "scene_id") ?? null,
    character_ids: characterIds,
    opening_state: optionalJsonObject(value.opening_state, "opening_state"),
    closing_state: optionalJsonObject(value.closing_state, "closing_state"),
    continuity_to_next: normalizeContinuityToNext(value.continuity_to_next),
  };
}

function normalizeStoryboards(values: StoryboardSaveInput[]) {
  if (!values.length) {
    throw new ConflictException("storyboard_set_items_required");
  }
  const items = values
    .map(normalizeStoryboard)
    .sort((left, right) => left.shot_number - right.shot_number);
  const numbers = new Set<number>();
  for (const item of items) {
    if (numbers.has(item.shot_number)) {
      throw new ConflictException("storyboard_set_shot_number_duplicate");
    }
    numbers.add(item.shot_number);
  }
  return items;
}

function currentStoryboardContentHash(
  values: Array<typeof storyboards.$inferSelect>,
) {
  return sha256(
    values
      .slice()
      .sort((left, right) => left.storyboardNumber - right.storyboardNumber)
      .map((storyboard) => ({
        storyboard_number: storyboard.storyboardNumber,
        title: storyboard.title,
        description: storyboard.description,
        action: storyboard.action,
        dialogue: storyboard.dialogue,
        duration: storyboard.duration,
        scene_id: storyboard.sceneId,
        status: storyboard.status,
        storyboard_set_id: storyboard.storyboardSetId,
      })),
  );
}

function hasProducedMedia(storyboard: typeof storyboards.$inferSelect) {
  return Boolean(
    storyboard.composedImage ||
    storyboard.firstFrameImage ||
    storyboard.lastFrameImage ||
    storyboard.videoUrl ||
    storyboard.ttsAudioUrl ||
    storyboard.subtitleUrl ||
    storyboard.composedVideoUrl,
  );
}

function compileBoundaryContract(
  current: NormalizedStoryboard,
  next: NormalizedStoryboard,
): CompiledBoundary {
  const continuity = current.continuity_to_next;
  const validationErrors: string[] = [];
  const relationType = continuity?.relation_type ?? "intentional_cut";
  const transitionType = continuity?.transition_type ?? "hard_cut";
  const openingState = next.opening_state ?? {};
  const closingState = current.closing_state ?? {};
  const inferredCharacterIds = Array.from(
    new Set([...current.character_ids, ...next.character_ids]),
  );
  const inferredSceneIds = Array.from(
    new Set(
      [current.scene_id, next.scene_id].filter(
        (id): id is number => id != null,
      ),
    ),
  );
  const assetLock = {
    ...(continuity?.asset_lock ?? {}),
    character_ids:
      Array.isArray(continuity?.asset_lock?.character_ids) &&
      continuity.asset_lock.character_ids.length
        ? continuity.asset_lock.character_ids
        : inferredCharacterIds,
    scene_ids:
      Array.isArray(continuity?.asset_lock?.scene_ids) &&
      continuity.asset_lock.scene_ids.length
        ? continuity.asset_lock.scene_ids
        : inferredSceneIds,
  };

  if (!continuity?.relation_type) {
    validationErrors.push("continuity_relation_missing");
  }
  if (!continuity?.action_handoff) {
    validationErrors.push(
      relationType === "continuous"
        ? "continuity_action_handoff_missing"
        : "continuity_cut_intent_missing",
    );
  }
  if (relationType === "continuous") {
    if (!Object.keys(closingState).length) {
      validationErrors.push("continuity_closing_state_missing");
    }
    if (!Object.keys(openingState).length) {
      validationErrors.push("continuity_opening_state_missing");
    }
    if (!inferredCharacterIds.length && !inferredSceneIds.length) {
      validationErrors.push("continuity_asset_lock_missing");
    }
  }

  return {
    relationType,
    transitionType,
    openingState,
    closingState,
    handoff: {
      action_handoff: continuity?.action_handoff ?? null,
      audio_bridge: continuity?.audio_bridge ?? null,
      dialogue_handoff: continuity?.dialogue_handoff ?? null,
      continuity_notes: continuity?.continuity_notes ?? [],
    },
    assetLock,
    status: validationErrors.length ? "blocked" : "ready",
    review: validationErrors.length
      ? {
          validation_errors: validationErrors,
          source: "storyboard_publish",
        }
      : {},
  };
}

@Injectable()
export class StoryboardSetsService {
  constructor(
    @Inject(DatabaseService)
    private readonly databaseService: DatabaseService,
  ) {}

  private now() {
    return new Date();
  }

  private async requireOwnedEpisode(
    userId: number,
    dramaId: number,
    episodeId: number,
  ) {
    const [episode] = await this.databaseService.db
      .select()
      .from(episodes)
      .where(
        and(
          eq(episodes.id, episodeId),
          eq(episodes.dramaId, dramaId),
          eq(episodes.userId, userId),
          isNull(episodes.deletedAt),
        ),
      )
      .limit(1);
    if (!episode) throw new NotFoundException("episode_not_found");
    return episode;
  }

  private async requireOwnedEpisodeById(userId: number, episodeId: number) {
    const [episode] = await this.databaseService.db
      .select()
      .from(episodes)
      .where(
        and(
          eq(episodes.id, episodeId),
          eq(episodes.userId, userId),
          isNull(episodes.deletedAt),
        ),
      )
      .limit(1);
    if (!episode) throw new NotFoundException("episode_not_found");
    return episode;
  }

  private async activeStoryboards(userId: number, episodeId: number) {
    return this.databaseService.db
      .select()
      .from(storyboards)
      .where(
        and(
          eq(storyboards.userId, userId),
          eq(storyboards.episodeId, episodeId),
          isNull(storyboards.deletedAt),
        ),
      )
      .orderBy(storyboards.storyboardNumber);
  }

  private async nextRevision(episodeId: number) {
    const [latest] = await this.databaseService.db
      .select({ revision: storyboardSets.revision })
      .from(storyboardSets)
      .where(eq(storyboardSets.episodeId, episodeId))
      .orderBy(desc(storyboardSets.revision))
      .limit(1);
    return (latest?.revision ?? 0) + 1;
  }

  async getEpisodeBaseline(input: {
    userId: number;
    dramaId: number;
    episodeId: number;
  }): Promise<StoryboardBaseline> {
    await this.requireOwnedEpisode(
      input.userId,
      input.dramaId,
      input.episodeId,
    );
    const active = await this.activeStoryboards(input.userId, input.episodeId);
    const activeSetIds = Array.from(
      new Set(
        active
          .map((storyboard) => storyboard.storyboardSetId)
          .filter((id): id is number => id != null),
      ),
    );
    const [activeSet] =
      activeSetIds.length === 1
        ? await this.databaseService.db
            .select()
            .from(storyboardSets)
            .where(
              and(
                eq(storyboardSets.id, activeSetIds[0]),
                eq(storyboardSets.userId, input.userId),
                eq(storyboardSets.dramaId, input.dramaId),
                eq(storyboardSets.episodeId, input.episodeId),
              ),
            )
            .limit(1)
        : [];
    return {
      activeSetId: activeSet?.id ?? null,
      revision: activeSet?.revision ?? null,
      contentHash: active.length ? currentStoryboardContentHash(active) : null,
      storyboardCount: active.length,
      hasLegacyRows: active.some(
        (storyboard) => storyboard.storyboardSetId == null,
      ),
      hasMixedSets: activeSetIds.length > 1,
      humanEditedAt: activeSet?.humanEditedAt ?? null,
      hasProducedMedia: active.some(hasProducedMedia),
    };
  }

  private async createDraftPreview(
    set: typeof storyboardSets.$inferSelect,
  ): Promise<StoryboardDraftPreview> {
    const [baseline, items] = await Promise.all([
      this.getEpisodeBaseline({
        userId: set.userId,
        dramaId: set.dramaId,
        episodeId: set.episodeId,
      }),
      this.databaseService.db
        .select()
        .from(storyboardSetItems)
        .where(eq(storyboardSetItems.storyboardSetId, set.id))
        .orderBy(storyboardSetItems.storyboardNumber),
    ]);
    if (!items.length)
      throw new ConflictException("storyboard_set_items_required");

    return {
      id: set.id,
      dramaId: set.dramaId,
      episodeId: set.episodeId,
      revision: set.revision,
      status: set.status,
      origin: set.origin,
      sourceTaskId: set.sourceTaskId,
      sourceExecutionId: set.sourceExecutionId,
      baseRevision: set.baseRevision,
      baseContentHash: set.baseContentHash,
      createdAt: set.createdAt,
      updatedAt: set.updatedAt,
      currentBaseline: baseline,
      items: items.map((item) =>
        normalizeStoryboard(parseStoryboardItem(item.payloadJson)),
      ),
    };
  }

  async getStoryboardSetPreview(input: {
    userId: number;
    storyboardSetId: number;
  }) {
    const [set] = await this.databaseService.db
      .select()
      .from(storyboardSets)
      .where(
        and(
          eq(storyboardSets.id, input.storyboardSetId),
          eq(storyboardSets.userId, input.userId),
        ),
      )
      .limit(1);
    if (!set) throw new NotFoundException("storyboard_set_not_found");
    return this.createDraftPreview(set);
  }

  async getLatestReviewRequiredDraft(input: {
    userId: number;
    episodeId: number;
  }) {
    const episode = await this.requireOwnedEpisodeById(
      input.userId,
      input.episodeId,
    );
    const [set] = await this.databaseService.db
      .select()
      .from(storyboardSets)
      .where(
        and(
          eq(storyboardSets.userId, input.userId),
          eq(storyboardSets.dramaId, episode.dramaId),
          eq(storyboardSets.episodeId, episode.id),
          eq(storyboardSets.origin, "agent"),
          eq(storyboardSets.status, "review_required"),
        ),
      )
      .orderBy(desc(storyboardSets.updatedAt), desc(storyboardSets.revision))
      .limit(1);
    return set ? this.createDraftPreview(set) : null;
  }

  async createAgentDraft(input: StoryboardSetDraftInput) {
    const episode = await this.requireOwnedEpisode(
      input.userId,
      input.dramaId,
      input.episodeId,
    );
    const normalized = normalizeStoryboards(input.storyboards);
    const active = await this.activeStoryboards(input.userId, input.episodeId);
    const activeSetIds = Array.from(
      new Set(
        active
          .map((storyboard) => storyboard.storyboardSetId)
          .filter((id): id is number => id != null),
      ),
    );
    const [baseSet] =
      activeSetIds.length === 1
        ? await this.databaseService.db
            .select()
            .from(storyboardSets)
            .where(
              and(
                eq(storyboardSets.id, activeSetIds[0]),
                eq(storyboardSets.userId, input.userId),
                eq(storyboardSets.episodeId, input.episodeId),
              ),
            )
            .limit(1)
        : [];
    const timestamp = this.now();
    const revision = await this.nextRevision(input.episodeId);
    const contentHash = sha256(normalized);
    const computedBaseRevision = baseSet?.revision ?? null;
    const computedBaseContentHash = active.length
      ? currentStoryboardContentHash(active)
      : null;
    const baseRevision =
      input.baseRevision === undefined
        ? computedBaseRevision
        : input.baseRevision;
    const baseContentHash =
      input.baseContentHash === undefined
        ? computedBaseContentHash
        : input.baseContentHash;
    const [set] = await this.databaseService.db
      .insert(storyboardSets)
      .values({
        userId: input.userId,
        dramaId: input.dramaId,
        episodeId: input.episodeId,
        revision,
        status: "draft",
        origin: "agent",
        sourceTaskId: input.sourceTaskId ?? null,
        sourceExecutionId: input.sourceExecutionId ?? null,
        episodeScriptHash: input.episodeScriptHash,
        storyGraphId: input.storyGraphId ?? null,
        storyGraphScriptHash: input.storyGraphScriptHash ?? null,
        baseRevision,
        baseContentHash,
        contentHash,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .returning();

    await this.databaseService.db.insert(storyboardSetItems).values(
      normalized.map((storyboard) => ({
        storyboardSetId: set.id,
        storyboardNumber: storyboard.shot_number,
        payloadJson: JSON.stringify(storyboard),
        contentHash: sha256(storyboard),
        createdAt: timestamp,
        updatedAt: timestamp,
      })),
    );

    return {
      id: set.id,
      revision: set.revision,
      episode_id: episode.id,
      content_hash: set.contentHash,
      storyboard_count: normalized.length,
      base_revision: baseRevision,
      base_content_hash: baseContentHash,
    };
  }

  async markHumanEdited(storyboardId: number, userId: number) {
    const [storyboard] = await this.databaseService.db
      .select({
        id: storyboards.id,
        userId: storyboards.userId,
        storyboardSetId: storyboards.storyboardSetId,
      })
      .from(storyboards)
      .where(eq(storyboards.id, storyboardId))
      .limit(1);
    if (
      !storyboard ||
      storyboard.userId !== userId ||
      storyboard.storyboardSetId == null
    ) {
      return;
    }
    await this.databaseService.db
      .update(storyboardSets)
      .set({ humanEditedAt: this.now(), updatedAt: this.now() })
      .where(
        and(
          eq(storyboardSets.id, storyboard.storyboardSetId),
          eq(storyboardSets.userId, userId),
        ),
      );
  }

  async publishCurrentAgentDraft(input: {
    userId: number;
    storyboardSetId: number;
    confirmReplace: boolean;
  }) {
    const [set] = await this.databaseService.db
      .select()
      .from(storyboardSets)
      .where(
        and(
          eq(storyboardSets.id, input.storyboardSetId),
          eq(storyboardSets.userId, input.userId),
        ),
      )
      .limit(1);
    if (!set) throw new NotFoundException("storyboard_set_not_found");

    const episode = await this.requireOwnedEpisode(
      input.userId,
      set.dramaId,
      set.episodeId,
    );
    const script = String(
      episode.scriptContent || episode.content || "",
    ).trim();
    if (!script) throw new ConflictException("storyboard_set_script_required");
    const episodeScriptHash = sha256(script);
    if (episodeScriptHash !== set.episodeScriptHash) {
      throw new ConflictException("storyboard_set_source_changed");
    }

    let storyGraphScriptHash: string | null = null;
    if (set.storyGraphId != null) {
      const [graph] = await this.databaseService.db
        .select()
        .from(dramaStoryGraphs)
        .where(
          and(
            eq(dramaStoryGraphs.id, set.storyGraphId),
            eq(dramaStoryGraphs.userId, input.userId),
            eq(dramaStoryGraphs.dramaId, set.dramaId),
            eq(dramaStoryGraphs.status, "ready"),
            isNull(dramaStoryGraphs.deletedAt),
          ),
        )
        .limit(1);
      if (!graph || graph.scriptHash !== set.storyGraphScriptHash) {
        throw new ConflictException("storyboard_set_source_changed");
      }
      storyGraphScriptHash = graph.scriptHash;
    }
    return this.publishAgentDraft({
      userId: input.userId,
      dramaId: set.dramaId,
      episodeId: set.episodeId,
      storyboardSetId: set.id,
      episodeScriptHash,
      storyGraphId: set.storyGraphId,
      storyGraphScriptHash,
      confirmReplace: input.confirmReplace,
    });
  }

  async publishAgentDraft(args: {
    userId: number;
    dramaId: number;
    episodeId: number;
    storyboardSetId: number;
    episodeScriptHash: string;
    storyGraphId?: number | null;
    storyGraphScriptHash?: string | null;
    confirmReplace?: boolean;
  }): Promise<StoryboardSetPublishResult> {
    const episode = await this.requireOwnedEpisode(
      args.userId,
      args.dramaId,
      args.episodeId,
    );
    const [set] = await this.databaseService.db
      .select()
      .from(storyboardSets)
      .where(
        and(
          eq(storyboardSets.id, args.storyboardSetId),
          eq(storyboardSets.userId, args.userId),
          eq(storyboardSets.dramaId, args.dramaId),
          eq(storyboardSets.episodeId, args.episodeId),
        ),
      )
      .limit(1);
    if (!set) throw new NotFoundException("storyboard_set_not_found");
    if (set.origin !== "agent") {
      throw new ConflictException("storyboard_set_not_agent_draft");
    }
    if (
      set.episodeScriptHash !== args.episodeScriptHash ||
      set.storyGraphId !== (args.storyGraphId ?? null) ||
      set.storyGraphScriptHash !== (args.storyGraphScriptHash ?? null)
    ) {
      throw new ConflictException("storyboard_set_source_changed");
    }
    if (set.status === "ready") {
      const items = await this.databaseService.db
        .select({ id: storyboardSetItems.id })
        .from(storyboardSetItems)
        .where(eq(storyboardSetItems.storyboardSetId, set.id));
      return {
        setId: set.id,
        revision: set.revision,
        status: "ready",
        storyboardCount: items.length,
        requiresReview: false,
      };
    }
    if (!["draft", "review_required"].includes(set.status)) {
      throw new ConflictException("storyboard_set_not_publishable");
    }

    const [items, active] = await Promise.all([
      this.databaseService.db
        .select()
        .from(storyboardSetItems)
        .where(eq(storyboardSetItems.storyboardSetId, set.id))
        .orderBy(storyboardSetItems.storyboardNumber),
      this.activeStoryboards(args.userId, args.episodeId),
    ]);
    if (!items.length)
      throw new ConflictException("storyboard_set_items_required");
    const normalized = items.map((item) =>
      normalizeStoryboard(parseStoryboardItem(item.payloadJson)),
    );
    const activeSetIds = Array.from(
      new Set(
        active
          .map((storyboard) => storyboard.storyboardSetId)
          .filter((id): id is number => id != null),
      ),
    );
    const [activeSet] =
      activeSetIds.length === 1
        ? await this.databaseService.db
            .select()
            .from(storyboardSets)
            .where(eq(storyboardSets.id, activeSetIds[0]))
            .limit(1)
        : [];
    const activeHash = active.length
      ? currentStoryboardContentHash(active)
      : null;
    const hasLegacyRows = active.some(
      (storyboard) => storyboard.storyboardSetId == null,
    );
    const hasMixedSets = activeSetIds.length > 1;
    const baseChanged =
      active.length > 0 &&
      (set.baseContentHash !== activeHash ||
        set.baseRevision !== (activeSet?.revision ?? null));
    const protectedCurrent =
      hasLegacyRows ||
      hasMixedSets ||
      Boolean(activeSet?.humanEditedAt) ||
      active.some(hasProducedMedia);
    const requiresReview = Boolean(
      active.length && (baseChanged || protectedCurrent),
    );
    if (requiresReview && !args.confirmReplace) {
      await this.databaseService.db
        .update(storyboardSets)
        .set({
          status: "review_required",
          updatedAt: this.now(),
        })
        .where(eq(storyboardSets.id, set.id));
      return {
        setId: set.id,
        revision: set.revision,
        status: "review_required",
        storyboardCount: normalized.length,
        requiresReview: true,
      };
    }

    const sceneIds = Array.from(
      new Set(
        normalized
          .map((storyboard) => storyboard.scene_id)
          .filter((id): id is number => id != null),
      ),
    );
    const characterIds = Array.from(
      new Set(normalized.flatMap((storyboard) => storyboard.character_ids)),
    );
    const [
      availableScenes,
      availableCharacters,
      episodeSceneLinks,
      episodeCharacterLinks,
    ] = await Promise.all([
      sceneIds.length
        ? this.databaseService.db
            .select({ id: scenes.id })
            .from(scenes)
            .where(
              and(
                eq(scenes.dramaId, args.dramaId),
                eq(scenes.userId, args.userId),
                isNull(scenes.deletedAt),
              ),
            )
        : Promise.resolve([]),
      characterIds.length
        ? this.databaseService.db
            .select({ id: characters.id })
            .from(characters)
            .where(
              and(
                eq(characters.dramaId, args.dramaId),
                eq(characters.userId, args.userId),
                isNull(characters.deletedAt),
              ),
            )
        : Promise.resolve([]),
      this.databaseService.db
        .select({ sceneId: episodeScenes.sceneId })
        .from(episodeScenes)
        .where(eq(episodeScenes.episodeId, args.episodeId)),
      this.databaseService.db
        .select({ characterId: episodeCharacters.characterId })
        .from(episodeCharacters)
        .where(eq(episodeCharacters.episodeId, args.episodeId)),
    ]);
    const availableSceneIds = new Set(availableScenes.map((scene) => scene.id));
    const availableCharacterIds = new Set(
      availableCharacters.map((character) => character.id),
    );
    if (sceneIds.some((id) => !availableSceneIds.has(id))) {
      throw new ConflictException("storyboard_set_scene_scope_forbidden");
    }
    if (characterIds.some((id) => !availableCharacterIds.has(id))) {
      throw new ConflictException("storyboard_set_character_scope_forbidden");
    }

    const timestamp = this.now();
    const inserted = await this.databaseService.db.transaction(async (tx) => {
      if (active.length) {
        await tx
          .update(storyboards)
          .set({ deletedAt: timestamp, updatedAt: timestamp })
          .where(
            and(
              eq(storyboards.episodeId, args.episodeId),
              eq(storyboards.userId, args.userId),
              isNull(storyboards.deletedAt),
            ),
          );
      }

      const linkedScenes = new Set(
        episodeSceneLinks.map((link) => link.sceneId),
      );
      const linkedCharacters = new Set(
        episodeCharacterLinks.map((link) => link.characterId),
      );
      const missingSceneLinks = sceneIds
        .filter((id) => !linkedScenes.has(id))
        .map((sceneId) => ({
          episodeId: args.episodeId,
          sceneId,
          createdAt: timestamp,
        }));
      const missingCharacterLinks = characterIds
        .filter((id) => !linkedCharacters.has(id))
        .map((characterId) => ({
          episodeId: args.episodeId,
          characterId,
          createdAt: timestamp,
        }));
      if (missingSceneLinks.length) {
        await tx.insert(episodeScenes).values(missingSceneLinks);
      }
      if (missingCharacterLinks.length) {
        await tx.insert(episodeCharacters).values(missingCharacterLinks);
      }

      const created: Array<{ id: number; storyboardNumber: number }> = [];
      for (const storyboard of normalized) {
        const [row] = await tx
          .insert(storyboards)
          .values({
            userId: args.userId,
            episodeId: args.episodeId,
            storyboardSetId: set.id,
            sceneId: storyboard.scene_id,
            storyboardNumber: storyboard.shot_number,
            title: storyboard.title ?? `镜头 ${storyboard.shot_number}`,
            shotType: storyboard.shot_type ?? "中景",
            angle: storyboard.angle ?? null,
            movement: storyboard.movement ?? null,
            location: storyboard.location ?? null,
            time: storyboard.time ?? null,
            action: storyboard.action ?? storyboard.description ?? null,
            dialogue: storyboard.dialogue ?? null,
            description: storyboard.description ?? storyboard.action ?? null,
            result:
              storyboard.result ??
              storyboard.description ??
              storyboard.action ??
              null,
            atmosphere: storyboard.atmosphere ?? "自然",
            imagePrompt: storyboard.image_prompt ?? null,
            videoPrompt: storyboard.video_prompt ?? null,
            bgmPrompt: storyboard.bgm_prompt ?? null,
            soundEffect: storyboard.sound_effect ?? null,
            duration: storyboard.duration,
            createdAt: timestamp,
            updatedAt: timestamp,
          })
          .returning({
            id: storyboards.id,
            storyboardNumber: storyboards.storyboardNumber,
          });
        created.push(row);
      }
      const insertedByNumber = new Map(
        created.map((storyboard) => [
          storyboard.storyboardNumber,
          storyboard.id,
        ]),
      );
      const characterLinks = normalized.flatMap((storyboard) => {
        const storyboardId = insertedByNumber.get(storyboard.shot_number);
        return storyboardId
          ? storyboard.character_ids.map((characterId) => ({
              storyboardId,
              characterId,
            }))
          : [];
      });
      if (characterLinks.length) {
        await tx.insert(storyboardCharacters).values(characterLinks);
      }
      const boundaryRows = normalized.slice(0, -1).map((storyboard, index) => {
        const next = normalized[index + 1];
        const fromStoryboardId = insertedByNumber.get(storyboard.shot_number);
        const toStoryboardId = insertedByNumber.get(next.shot_number);
        if (!fromStoryboardId || !toStoryboardId) {
          throw new ConflictException("storyboard_boundary_compile_failed");
        }
        const contract = compileBoundaryContract(storyboard, next);
        return {
          userId: args.userId,
          dramaId: args.dramaId,
          episodeId: args.episodeId,
          fromStoryboardId,
          toStoryboardId,
          sourceStoryboardSetId: set.id,
          relationType: contract.relationType,
          transitionType: contract.transitionType,
          openingStateJson: JSON.stringify(contract.openingState),
          closingStateJson: JSON.stringify(contract.closingState),
          handoffJson: JSON.stringify(contract.handoff),
          assetLockJson: JSON.stringify(contract.assetLock),
          status: contract.status,
          reviewJson: JSON.stringify(contract.review),
          createdAt: timestamp,
          updatedAt: timestamp,
        };
      });
      if (boundaryRows.length) {
        await tx.insert(storyboardBoundaries).values(boundaryRows);
      }
      await tx
        .update(episodes)
        .set({
          duration: Math.ceil(
            normalized.reduce(
              (total, storyboard) => total + storyboard.duration,
              0,
            ) / 60,
          ),
          reviewStatus: "storyboard_ready",
          updatedAt: timestamp,
        })
        .where(eq(episodes.id, episode.id));
      await tx
        .update(storyboardSets)
        .set({
          status: "ready",
          publishedAt: timestamp,
          updatedAt: timestamp,
        })
        .where(eq(storyboardSets.id, set.id));
      return created;
    });

    return {
      setId: set.id,
      revision: set.revision,
      status: "ready",
      storyboardCount: inserted.length,
      requiresReview: false,
    };
  }
}
