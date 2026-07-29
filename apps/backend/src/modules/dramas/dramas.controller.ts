import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { and, asc, count, desc, eq, ilike, inArray, isNull } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import { z } from "zod";

import { toPublicMediaUrl } from "../../common/media-url";
import {
  toSnakeCase,
  toSnakeCaseArrayWithPublicMedia,
  toSnakeCaseWithPublicMedia,
} from "../../common/transform";
import { DatabaseService } from "../../db/database.service";
import {
  assets,
  canvases,
  characters,
  dramaAssetLinks,
  dramaEntityAliases,
  dramaGraphEntities,
  dramaGraphEvents,
  dramaGraphIndexChunks,
  dramaGraphRelations,
  dramaSourceChunks,
  dramaSources,
  dramaStoryGraphs,
  dramas,
  episodeCharacters,
  episodes,
  episodeScenes,
  imageGenerations,
  props,
  scenes,
  storyboards,
  tasks,
  videoGenerations,
  videoMerges,
  writingDocuments,
  writings,
} from "../../db/schema";
import { parseDramaMetadata, resolveProjectConfigId } from "./drama-metadata";
import { DramaAiFirstService } from "./drama-ai-first.service";
import { DramaStoryGraphService } from "./drama-story-graph.service";
import {
  buildDramaWorkspaceHref,
  resolveDramaWorkspaceTaskStage,
} from "../drama-workspace/drama-workspace-routing";
import { AuthService } from "../auth/auth.service";
import { CurrentUser } from "../auth/current-user.decorator";
import { SessionAuthGuard } from "../auth/session-auth.guard";
import type { CurrentUser as CurrentUserType } from "../auth/auth.types";

const dramaMediaFields = { urlFields: ["thumbnail"] } as const;
const episodeMediaFields = { urlFields: ["videoUrl", "thumbnail"] } as const;
const characterMediaFields = {
  urlFields: ["imageUrl", "voiceSampleUrl"],
  jsonArrayFields: ["referenceImages"],
} as const;
const sceneMediaFields = { urlFields: ["imageUrl"] } as const;
const propMediaFields = {
  urlFields: ["imageUrl"],
  jsonArrayFields: ["referenceImages"],
} as const;

const dramaCreateSchema = z.object({
  title: z.string().trim().min(1),
  description: z.string().trim().nullable().optional(),
  genre: z.string().trim().nullable().optional(),
  style: z.string().trim().nullable().optional(),
  tags: z.unknown().optional(),
  metadata: z.unknown().optional(),
  total_episodes: z.coerce.number().int().nonnegative().optional(),
});

const dramaUpdateSchema = z.object({
  title: z.string().trim().optional(),
  description: z.string().trim().nullable().optional(),
  genre: z.string().trim().nullable().optional(),
  style: z.string().trim().nullable().optional(),
  status: z.string().trim().optional(),
  thumbnail: z.string().trim().nullable().optional(),
  tags: z.unknown().optional(),
  metadata: z.unknown().optional(),
  total_episodes: z.coerce.number().int().nonnegative().optional(),
});

const createDramaFromWritingSchema = z.object({
  writing_id: z.coerce.number().int().positive(),
  document_id: z.coerce.number().int().positive().nullable().optional(),
  title: z.string().trim().optional(),
});

const dramaSourceSchema = z.object({
  title: z.string().trim().nullable().optional(),
  content: z.string().min(1),
  source_type: z.enum(["paste", "upload", "writing_project"]).optional(),
});

const dramaSourceHealthCheckSchema = z
  .object({
    content: z.string().nullable().optional(),
  })
  .optional();

const dramaAdaptationBriefGenerateSchema = z
  .object({
    count: z.coerce.number().int().min(2).max(3).optional(),
    target_episode_count: z.coerce.number().int().min(1).nullable().optional(),
    episode_duration: z.string().trim().nullable().optional(),
    style_direction: z.string().trim().nullable().optional(),
  })
  .optional();

const dramaAdaptationConfigSchema = z
  .object({
    target_episode_count: z.coerce.number().int().min(1).optional(),
    episode_duration: z.string().trim().min(1).max(120).optional(),
    style_direction: z.string().trim().min(1).max(240).optional(),
    visual_style: z.string().trim().min(1).max(240).optional(),
    aspect_rhythm: z.string().trim().min(1).max(240).optional(),
  })
  .optional();

const dramaEpisodeBlueprintGenerateSchema = z
  .object({
    replace_without_script: z.boolean().optional(),
    adaptation_config: dramaAdaptationConfigSchema,
  })
  .optional();

const dramaPilotScriptsGenerateSchema = z
  .object({
    limit: z.coerce.number().int().min(1).optional(),
    episode_ids: z.array(z.coerce.number().int().positive()).min(1).optional(),
  })
  .optional();

type EpisodeDraft = {
  title: string;
  content: string;
};

type WorkspaceNextStep = {
  key: string;
  title: string;
  description: string;
  href: string;
  severity: "high" | "medium" | "low";
};

function serializeMetadata(value: unknown) {
  if (value == null) return null;
  return typeof value === "string" ? value : JSON.stringify(value);
}

function parseJsonValue(value: string | null | undefined) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function parseDramaId(value: string) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new BadRequestException("invalid drama id");
  }
  return id;
}

function normalizeScript(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function toOptionalNumber(value: unknown) {
  if (value == null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function emptyBodyToObject(value: unknown) {
  return value == null || value === "" ? {} : value;
}

function extractAiFirstFields(metadataValue: string | null | undefined) {
  const metadata = parseDramaMetadata(metadataValue);
  const aiFirst = toRecord(metadata.ai_first);
  return {
    source_health: aiFirst.source_health ?? metadata.source_health ?? null,
    source_analysis:
      aiFirst.source_analysis ?? metadata.source_analysis ?? null,
    adaptation_briefs: Array.isArray(aiFirst.adaptation_briefs)
      ? aiFirst.adaptation_briefs
      : Array.isArray(metadata.adaptation_briefs)
        ? metadata.adaptation_briefs
        : [],
    selected_brief_id:
      typeof aiFirst.selected_brief_id === "string"
        ? aiFirst.selected_brief_id
        : typeof metadata.selected_brief_id === "string"
          ? metadata.selected_brief_id
          : "",
    ai_first_stage:
      typeof aiFirst.ai_first_stage === "string"
        ? aiFirst.ai_first_stage
        : typeof metadata.ai_first_stage === "string"
          ? metadata.ai_first_stage
          : null,
  };
}

function dramaPayloadBase(drama: typeof dramas.$inferSelect) {
  return {
    ...toSnakeCaseWithPublicMedia(
      drama as unknown as Record<string, unknown>,
      dramaMediaFields,
    ),
    tags: parseJsonValue(drama.tags),
    ...extractAiFirstFields(drama.metadata),
  };
}

function isActiveTaskStatus(status: string | null | undefined) {
  return status === "queued" || status === "running";
}

function isFailedTaskStatus(status: string | null | undefined) {
  return (
    status === "failed" || status === "dead_letter" || status === "canceled"
  );
}

function isStaleEpisodeGenerationMode(
  generationMode: string | null | undefined,
) {
  return /_(?:source|analysis|strategy|blueprint)_stale(?:_|$)/.test(
    String(generationMode || ""),
  );
}

function hasStoryboardFrame(storyboard: typeof storyboards.$inferSelect) {
  return Boolean(storyboard.firstFrameImage || storyboard.composedImage);
}

function hasStoryboardDialogue(storyboard: typeof storyboards.$inferSelect) {
  return Boolean(String(storyboard.dialogue || "").trim());
}

function serializeWorkspaceTask(task: typeof tasks.$inferSelect, episodeNumber?: number | null) {
  const sourceStage = resolveDramaWorkspaceTaskStage(task);
  return {
    id: task.id,
    type: task.type,
    status: task.status,
    title: task.title,
    progress: task.progress,
    source_type: task.sourceType,
    drama_id: task.dramaId,
    episode_id: task.episodeId,
    storyboard_id: task.storyboardId,
    error_message: task.errorMessage,
    created_at: task.createdAt,
    updated_at: task.updatedAt,
    source_route: task.dramaId
      ? buildDramaWorkspaceHref(task.dramaId, sourceStage, {
          episodeNumber,
          shotId: task.storyboardId,
          taskId: task.id,
          origin: "task",
        })
      : null,
    source_stage: sourceStage,
  };
}

function buildEpisodeTitle(input: {
  writingTitle: string;
  documentTitle: string | null;
}) {
  const docTitle = String(input.documentTitle || "").trim();
  if (docTitle && docTitle !== "作品根文档") return docTitle;
  return `${input.writingTitle} · 第1集`;
}

function titleForEpisode(index: number) {
  return `第${index}集`;
}

function splitByEpisodeMarkers(script: string): EpisodeDraft[] {
  const markerPattern =
    /(?:^|\r?\n)[ \t]*(?:#{1,6}[ \t]*)?((?:(?:第[ \t]*[0-9０-９一二三四五六七八九十百千万零〇两俩]+[ \t]*(?:章节|集|章|節|节))|(?:(?:EP|Episode)\.?[ \t]*[0-9０-９]+))(?:[ \t]*(?:[：:、-]|[ \t]+)[^\r\n]*)?)[ \t]*(?=\r?\n|$)/gi;
  const matches = Array.from(script.matchAll(markerPattern));
  if (!matches.length) return [];

  return matches
    .map((match, index) => {
      const start = (match.index || 0) + match[0].length;
      const end = matches[index + 1]?.index ?? script.length;
      const markerTitle = String(match[1] || "").trim();
      const title = markerTitle || titleForEpisode(index + 1);
      const content = script.slice(start, end).trim();
      return { title, content };
    })
    .filter((episode) => episode.content);
}

@ApiTags("dramas")
@Controller("dramas")
export class DramasController {
  constructor(
    @Inject(DatabaseService) private readonly databaseService: DatabaseService,
    @Inject(AuthService) private readonly authService: AuthService,
    @Inject(DramaAiFirstService)
    private readonly dramaAiFirstService: DramaAiFirstService,
    @Inject(DramaStoryGraphService)
    private readonly dramaStoryGraphService: DramaStoryGraphService,
  ) {}

  @Get("stats")
  @UseGuards(SessionAuthGuard)
  async getDramaStats(@CurrentUser() currentUser: CurrentUserType) {
    const rows = await this.databaseService.db
      .select()
      .from(dramas)
      .where(and(eq(dramas.userId, currentUser.id), isNull(dramas.deletedAt)));

    const byStatus = Object.entries(
      rows.reduce<Record<string, number>>((acc, drama) => {
        const key = drama.status || "draft";
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {}),
    ).map(([status, count]) => ({ status, count }));

    return {
      total: rows.length,
      by_status: byStatus,
    };
  }

  @Get()
  async listDramas(
    @Req() request: FastifyRequest,
    @Query() query: Record<string, string | undefined>,
  ) {
    const session = await this.authService.getSession(request);
    const page = Math.max(1, Number(query.page || 1));
    const pageSize = Math.max(1, Number(query.page_size || 20));
    const status = query.status?.trim();
    const keyword = query.keyword?.trim();
    const includeDetails =
      query.include_details !== "0" && query.include_details !== "false";

    const conditions = [isNull(dramas.deletedAt)];
    if (session?.user) {
      conditions.push(eq(dramas.userId, session.user.id));
    } else {
      conditions.push(eq(dramas.isPublic, true));
    }
    if (status) {
      conditions.push(eq(dramas.status, status));
    }
    if (keyword) {
      conditions.push(ilike(dramas.title, `%${keyword}%`));
    }

    const filtered = await this.databaseService.db
      .select()
      .from(dramas)
      .where(and(...conditions))
      .orderBy(desc(dramas.updatedAt));
    const total = filtered.length;
    const items = filtered.slice((page - 1) * pageSize, page * pageSize);
    const dramaIds = items.map((drama) => drama.id);

    const episodesByDrama = new Map<number, (typeof episodes.$inferSelect)[]>();
    const charactersByDrama = new Map<
      number,
      (typeof characters.$inferSelect)[]
    >();
    const scenesByDrama = new Map<number, (typeof scenes.$inferSelect)[]>();
    const episodeCountByDrama = new Map<number, number>();
    const characterCountByDrama = new Map<number, number>();
    const sceneCountByDrama = new Map<number, number>();

    if (dramaIds.length) {
      if (includeDetails || !session?.user) {
        const [episodeRows, characterRows, sceneRows] = await Promise.all([
          this.databaseService.db
            .select()
            .from(episodes)
            .where(
              and(
                inArray(episodes.dramaId, dramaIds),
                isNull(episodes.deletedAt),
                session?.user
                  ? eq(episodes.userId, session.user.id)
                  : undefined,
              ),
            ),
          this.databaseService.db
            .select()
            .from(characters)
            .where(
              and(
                inArray(characters.dramaId, dramaIds),
                isNull(characters.deletedAt),
                session?.user
                  ? eq(characters.userId, session.user.id)
                  : undefined,
              ),
            ),
          this.databaseService.db
            .select()
            .from(scenes)
            .where(
              and(
                inArray(scenes.dramaId, dramaIds),
                isNull(scenes.deletedAt),
                session?.user ? eq(scenes.userId, session.user.id) : undefined,
              ),
            ),
        ]);

        for (const row of episodeRows) {
          const bucket = episodesByDrama.get(row.dramaId);
          if (bucket) {
            bucket.push(row);
          } else {
            episodesByDrama.set(row.dramaId, [row]);
          }
        }
        for (const row of characterRows) {
          const bucket = charactersByDrama.get(row.dramaId);
          if (bucket) {
            bucket.push(row);
          } else {
            charactersByDrama.set(row.dramaId, [row]);
          }
        }
        for (const row of sceneRows) {
          const bucket = scenesByDrama.get(row.dramaId);
          if (bucket) {
            bucket.push(row);
          } else {
            scenesByDrama.set(row.dramaId, [row]);
          }
        }
      } else {
        const [episodeCounts, characterCounts, sceneCounts] = await Promise.all(
          [
            this.databaseService.db
              .select({ dramaId: episodes.dramaId, total: count() })
              .from(episodes)
              .where(
                and(
                  inArray(episodes.dramaId, dramaIds),
                  isNull(episodes.deletedAt),
                  eq(episodes.userId, session.user.id),
                ),
              )
              .groupBy(episodes.dramaId),
            this.databaseService.db
              .select({ dramaId: characters.dramaId, total: count() })
              .from(characters)
              .where(
                and(
                  inArray(characters.dramaId, dramaIds),
                  isNull(characters.deletedAt),
                  eq(characters.userId, session.user.id),
                ),
              )
              .groupBy(characters.dramaId),
            this.databaseService.db
              .select({ dramaId: scenes.dramaId, total: count() })
              .from(scenes)
              .where(
                and(
                  inArray(scenes.dramaId, dramaIds),
                  isNull(scenes.deletedAt),
                  eq(scenes.userId, session.user.id),
                ),
              )
              .groupBy(scenes.dramaId),
          ],
        );

        for (const row of episodeCounts)
          episodeCountByDrama.set(row.dramaId, Number(row.total) || 0);
        for (const row of characterCounts)
          characterCountByDrama.set(row.dramaId, Number(row.total) || 0);
        for (const row of sceneCounts)
          sceneCountByDrama.set(row.dramaId, Number(row.total) || 0);
      }
    }

    const enriched = items.map((drama) => {
      const dramaEpisodeRows = episodesByDrama.get(drama.id) || [];
      const dramaCharacterRows = charactersByDrama.get(drama.id) || [];
      const dramaSceneRows = scenesByDrama.get(drama.id) || [];
      const episodeCount =
        includeDetails || !session?.user
          ? dramaEpisodeRows.length
          : episodeCountByDrama.get(drama.id) || 0;
      const characterCount =
        includeDetails || !session?.user
          ? dramaCharacterRows.length
          : characterCountByDrama.get(drama.id) || 0;
      const sceneCount =
        includeDetails || !session?.user
          ? dramaSceneRows.length
          : sceneCountByDrama.get(drama.id) || 0;

      const payload = {
        ...dramaPayloadBase(drama),
        total_episodes: episodeCount,
        episode_count: episodeCount,
        character_count: characterCount,
        scene_count: sceneCount,
      } as Record<string, unknown>;

      if (!session?.user) {
        const scripted = dramaEpisodeRows.filter((episode) =>
          Boolean(episode.scriptContent?.trim()),
        ).length;
        payload.script_progress_percent = dramaEpisodeRows.length
          ? Math.round((scripted / dramaEpisodeRows.length) * 100)
          : 0;
        payload.episodes = [];
        payload.characters = [];
        payload.scenes = [];
        return payload;
      }

      if (includeDetails) {
        payload.episodes = toSnakeCaseArrayWithPublicMedia(
          dramaEpisodeRows as unknown as Record<string, unknown>[],
          episodeMediaFields,
        );
        payload.characters = toSnakeCaseArrayWithPublicMedia(
          dramaCharacterRows as unknown as Record<string, unknown>[],
          characterMediaFields,
        );
        payload.scenes = toSnakeCaseArrayWithPublicMedia(
          dramaSceneRows as unknown as Record<string, unknown>[],
          sceneMediaFields,
        );
      }

      return payload;
    });

    return {
      items: enriched,
      pagination: {
        page,
        page_size: pageSize,
        total,
        total_pages: Math.ceil(total / pageSize),
      },
    };
  }

  @Post()
  @UseGuards(SessionAuthGuard)
  async createDrama(
    @Body() body: unknown,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const payload = dramaCreateSchema.parse(body);
    const now = new Date();

    const [drama] = await this.databaseService.db
      .insert(dramas)
      .values({
        userId: currentUser.id,
        title: payload.title,
        description: payload.description ?? null,
        genre: payload.genre ?? null,
        style: payload.style ?? null,
        tags: payload.tags !== undefined ? JSON.stringify(payload.tags) : null,
        metadata: serializeMetadata(payload.metadata),
        totalEpisodes: payload.total_episodes ?? 0,
        status: "draft",
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    return dramaPayloadBase(drama);
  }

  @Post("from-writing")
  @UseGuards(SessionAuthGuard)
  async createDramaFromWriting(
    @Body() body: unknown,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const payload = createDramaFromWritingSchema.parse(body);
    const [writing] = await this.databaseService.db
      .select()
      .from(writings)
      .where(
        and(
          eq(writings.id, payload.writing_id),
          eq(writings.userId, currentUser.id),
          isNull(writings.deletedAt),
        ),
      );

    if (!writing) {
      return { error: "writing_not_found" };
    }

    const documents = (
      await this.databaseService.db
        .select()
        .from(writingDocuments)
        .where(
          and(
            eq(writingDocuments.writingId, payload.writing_id),
            eq(writingDocuments.userId, currentUser.id),
            isNull(writingDocuments.deletedAt),
          ),
        )
    ).sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);

    const sourceDocument =
      payload.document_id == null
        ? documents.find((doc) => doc.id === writing.currentDocumentId) ||
          documents[0] ||
          null
        : documents.find((doc) => doc.id === payload.document_id) || null;

    const documentIds = sourceDocument
      ? [sourceDocument.id]
      : documents
          .filter((doc) => doc.documentType !== "root")
          .map((doc) => doc.id);

    const blocks = documentIds
      .map((documentId) => documents.find((doc) => doc.id === documentId))
      .filter((doc): doc is (typeof documents)[number] => Boolean(doc))
      .map((doc) => {
        const bodyText = String(doc.contentMd || "").trim();
        if (!bodyText) return "";
        return `## ${doc.title}\n\n${bodyText}`;
      })
      .filter(Boolean);

    const mergedContent = blocks.join("\n\n");
    const safeTitle = payload.title?.trim() || `${writing.title} · 改编项目`;
    const now = new Date();

    const [drama] = await this.databaseService.db
      .insert(dramas)
      .values({
        userId: currentUser.id,
        title: safeTitle,
        description: writing.synopsis || `由《${writing.title}》导入`,
        totalEpisodes: 1,
        status: "draft",
        metadata: JSON.stringify({
          source_type: "writing",
          source_writing_id: writing.id,
          source_document_id: sourceDocument?.id ?? null,
        }),
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    const [episode] = await this.databaseService.db
      .insert(episodes)
      .values({
        userId: currentUser.id,
        dramaId: drama.id,
        episodeNumber: 1,
        title: buildEpisodeTitle({
          writingTitle: writing.title,
          documentTitle: sourceDocument?.title ?? documents[0]?.title ?? null,
        }),
        content: mergedContent || writing.synopsis || "",
        scriptContent: mergedContent || writing.synopsis || "",
        description: writing.synopsis || `从《${writing.title}》导入`,
        imageConfigId: resolveProjectConfigId(drama.metadata, "image"),
        videoConfigId: resolveProjectConfigId(drama.metadata, "video"),
        audioConfigId: resolveProjectConfigId(drama.metadata, "audio"),
        status: "draft",
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    return {
      drama_id: drama.id,
      episode_id: episode.id,
      source_writing_id: writing.id,
      source_document_id: sourceDocument?.id ?? null,
    };
  }

  @Post(":id/split-episodes")
  @UseGuards(SessionAuthGuard)
  async splitEpisodes(
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const dramaId = parseDramaId(id);
    const [drama] = await this.databaseService.db
      .select()
      .from(dramas)
      .where(
        and(
          eq(dramas.id, dramaId),
          eq(dramas.userId, currentUser.id),
          isNull(dramas.deletedAt),
        ),
      );

    if (!drama) {
      throw new NotFoundException("drama_not_found");
    }

    const replaceExisting = body.replace_existing === true;
    const existingEpisodes = await this.databaseService.db
      .select()
      .from(episodes)
      .where(
        and(
          eq(episodes.dramaId, dramaId),
          eq(episodes.userId, currentUser.id),
          isNull(episodes.deletedAt),
        ),
      )
      .orderBy(episodes.episodeNumber);

    const script =
      normalizeScript(body.content) ||
      (replaceExisting && existingEpisodes.length === 1
        ? normalizeScript(
            existingEpisodes[0]?.content || existingEpisodes[0]?.scriptContent,
          )
        : "");

    if (!script) {
      throw new BadRequestException("请输入剧本内容");
    }

    if (existingEpisodes.length > 0 && !replaceExisting) {
      throw new ConflictException("当前项目已存在分集，不能重复自动分集");
    }

    const drafts = splitByEpisodeMarkers(script);
    const splitMode = "marker";
    const imageConfigId = toOptionalNumber(body.image_config_id);
    const videoConfigId = toOptionalNumber(body.video_config_id);
    const audioConfigId = toOptionalNumber(body.audio_config_id);
    const projectImageConfigId = resolveProjectConfigId(
      drama.metadata,
      "image",
    );
    const projectVideoConfigId = resolveProjectConfigId(
      drama.metadata,
      "video",
    );
    const projectAudioConfigId = resolveProjectConfigId(
      drama.metadata,
      "audio",
    );

    if (!drafts.length) {
      throw new BadRequestException(
        "未识别到明确分集标记，请使用“第1集”“第一集”“第1章”“第一章”等格式标注后再分集",
      );
    }

    const ts = new Date();

    if (replaceExisting && existingEpisodes.length > 0) {
      await this.databaseService.db
        .update(episodes)
        .set({ deletedAt: ts, updatedAt: ts })
        .where(
          and(
            eq(episodes.dramaId, dramaId),
            eq(episodes.userId, currentUser.id),
            isNull(episodes.deletedAt),
          ),
        );
    }

    await this.databaseService.db.insert(episodes).values(
      drafts.map((draft, index) => ({
        userId: currentUser.id,
        dramaId,
        episodeNumber: index + 1,
        title: draft.title || titleForEpisode(index + 1),
        content: draft.content,
        imageConfigId:
          imageConfigId ??
          existingEpisodes[index]?.imageConfigId ??
          existingEpisodes[0]?.imageConfigId ??
          projectImageConfigId ??
          null,
        videoConfigId:
          videoConfigId ??
          existingEpisodes[index]?.videoConfigId ??
          existingEpisodes[0]?.videoConfigId ??
          projectVideoConfigId ??
          null,
        audioConfigId:
          audioConfigId ??
          existingEpisodes[index]?.audioConfigId ??
          existingEpisodes[0]?.audioConfigId ??
          projectAudioConfigId ??
          null,
        status: "draft",
        createdAt: ts,
        updatedAt: ts,
      })),
    );

    await this.databaseService.db
      .update(dramas)
      .set({
        totalEpisodes: drafts.length,
        metadata: JSON.stringify({
          ...parseDramaMetadata(drama.metadata),
          auto_split_at: ts,
          auto_split_episode_count: drafts.length,
          auto_split_mode: splitMode,
        }),
        updatedAt: ts,
      })
      .where(and(eq(dramas.id, dramaId), eq(dramas.userId, currentUser.id)));

    const episodeRows = await this.databaseService.db
      .select()
      .from(episodes)
      .where(
        and(
          eq(episodes.dramaId, dramaId),
          eq(episodes.userId, currentUser.id),
          isNull(episodes.deletedAt),
        ),
      )
      .orderBy(episodes.episodeNumber);

    return {
      count: drafts.length,
      split_mode: splitMode,
      episodes: toSnakeCaseArrayWithPublicMedia(
        episodeRows as unknown as Record<string, unknown>[],
        episodeMediaFields,
      ),
    };
  }

  @Get(":id/ai-first")
  @UseGuards(SessionAuthGuard)
  async getDramaAiFirst(
    @Param("id") id: string,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const dramaId = parseDramaId(id);
    return this.dramaAiFirstService.getAiFirst(dramaId, currentUser.id);
  }

  @Post(":id/source/health-check")
  @UseGuards(SessionAuthGuard)
  async checkDramaSourceHealth(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const dramaId = parseDramaId(id);
    const payload = dramaSourceHealthCheckSchema.parse(body ?? {});
    return this.dramaAiFirstService.healthCheck({
      dramaId,
      userId: currentUser.id,
      content: payload?.content,
    });
  }

  @Post(":id/source")
  @UseGuards(SessionAuthGuard)
  async saveDramaSource(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const dramaId = parseDramaId(id);
    const payload = dramaSourceSchema.parse(body);
    return this.dramaAiFirstService.saveSource({
      dramaId,
      userId: currentUser.id,
      title: payload.title,
      content: payload.content,
      sourceType: payload.source_type,
    });
  }

  @Post(":id/source/analyze")
  @UseGuards(SessionAuthGuard)
  async analyzeDramaSource(
    @Param("id") id: string,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const dramaId = parseDramaId(id);
    return this.dramaAiFirstService.analyzeSource({
      dramaId,
      userId: currentUser.id,
    });
  }

  @Post(":id/adaptation-briefs")
  @UseGuards(SessionAuthGuard)
  async generateAdaptationBriefs(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const dramaId = parseDramaId(id);
    const payload = dramaAdaptationBriefGenerateSchema.parse(
      emptyBodyToObject(body),
    );
    return this.dramaAiFirstService.generateAdaptationBriefs({
      dramaId,
      userId: currentUser.id,
      count: payload?.count,
      targetEpisodeCount: payload?.target_episode_count,
      episodeDuration: payload?.episode_duration,
      styleDirection: payload?.style_direction,
    });
  }

  @Post(":id/adaptation-briefs/:briefId/select")
  @UseGuards(SessionAuthGuard)
  async selectAdaptationBrief(
    @Param("id") id: string,
    @Param("briefId") briefId: string,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const dramaId = parseDramaId(id);
    return this.dramaAiFirstService.selectAdaptationBrief({
      dramaId,
      userId: currentUser.id,
      briefId,
    });
  }

  @Post(":id/episode-blueprints")
  @UseGuards(SessionAuthGuard)
  async generateEpisodeBlueprints(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const dramaId = parseDramaId(id);
    const payload = dramaEpisodeBlueprintGenerateSchema.parse(
      emptyBodyToObject(body),
    );
    return this.dramaAiFirstService.generateEpisodeBlueprints({
      dramaId,
      userId: currentUser.id,
      replaceWithoutScript: payload?.replace_without_script,
      adaptationConfig: payload?.adaptation_config,
    });
  }

  @Post(":id/pilot-scripts")
  @UseGuards(SessionAuthGuard)
  async generatePilotScripts(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const dramaId = parseDramaId(id);
    const payload = dramaPilotScriptsGenerateSchema.parse(
      emptyBodyToObject(body),
    );
    return this.dramaAiFirstService.generatePilotScripts({
      dramaId,
      userId: currentUser.id,
      limit: payload?.limit,
      episodeIds: payload?.episode_ids,
    });
  }

  @Get(":id/story-graph")
  @UseGuards(SessionAuthGuard)
  async getStoryGraph(
    @Param("id") id: string,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const dramaId = parseDramaId(id);
    return this.dramaStoryGraphService.getStoryGraphSummary(
      dramaId,
      currentUser.id,
    );
  }

  @Post(":id/story-graph/build")
  @UseGuards(SessionAuthGuard)
  async buildStoryGraph(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const dramaId = parseDramaId(id);
    const payload = z
      .object({ force: z.boolean().optional() })
      .parse(emptyBodyToObject(body));
    return this.dramaStoryGraphService.requestBuild({
      dramaId,
      userId: currentUser.id,
      force: payload.force,
    });
  }

  @Get(":id/story-graph/entities/:entityId")
  @UseGuards(SessionAuthGuard)
  async getStoryGraphEntity(
    @Param("id") id: string,
    @Param("entityId") entityId: string,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const dramaId = parseDramaId(id);
    const parsedEntityId = Number(entityId);
    if (!Number.isInteger(parsedEntityId) || parsedEntityId <= 0) {
      throw new BadRequestException("invalid_entity_id");
    }
    return this.dramaStoryGraphService.getEntityDetail(
      dramaId,
      currentUser.id,
      parsedEntityId,
    );
  }

  @Get(":id/story-graph/entities")
  @UseGuards(SessionAuthGuard)
  async listStoryGraphEntities(
    @Param("id") id: string,
    @Query("type") type: string | undefined,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const dramaId = parseDramaId(id);
    return this.dramaStoryGraphService.listEntities(
      dramaId,
      currentUser.id,
      type,
    );
  }

  @Get(":id/story-graph/relations")
  @UseGuards(SessionAuthGuard)
  async listStoryGraphRelations(
    @Param("id") id: string,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const dramaId = parseDramaId(id);
    return this.dramaStoryGraphService.listRelations(dramaId, currentUser.id);
  }

  @Get(":id/story-graph/events")
  @UseGuards(SessionAuthGuard)
  async listStoryGraphEvents(
    @Param("id") id: string,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const dramaId = parseDramaId(id);
    return this.dramaStoryGraphService.listEvents(dramaId, currentUser.id);
  }

  @Post(":id/story-graph/seed-assets")
  @UseGuards(SessionAuthGuard)
  async seedStoryGraphAssets(
    @Param("id") id: string,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const dramaId = parseDramaId(id);
    return this.dramaStoryGraphService.seedAssets(dramaId, currentUser.id);
  }

  @Get(":id/story-graph/search")
  @UseGuards(SessionAuthGuard)
  async searchStoryGraph(
    @Param("id") id: string,
    @Query("q") query: string | undefined,
    @Query("kinds") kinds: string | undefined,
    @Query("limit") limit: string | undefined,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const dramaId = parseDramaId(id);
    const parsedKinds = kinds
      ? kinds
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      : undefined;
    const parsedLimit = limit ? Number(limit) : undefined;
    return this.dramaStoryGraphService.searchStoryGraph(
      dramaId,
      currentUser.id,
      {
        query: String(query || "").trim(),
        kinds: parsedKinds,
        limit: Number.isFinite(parsedLimit) ? parsedLimit : undefined,
      },
    );
  }

  @Post(":id/story-graph/search")
  @UseGuards(SessionAuthGuard)
  async searchStoryGraphPost(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const dramaId = parseDramaId(id);
    const payload = z
      .object({
        query: z.string().min(1),
        kinds: z.array(z.string()).optional(),
        limit: z.number().int().positive().max(40).optional(),
      })
      .parse(emptyBodyToObject(body));
    return this.dramaStoryGraphService.searchStoryGraph(
      dramaId,
      currentUser.id,
      payload,
    );
  }

  @Get(":id/story-graph/index-status")
  @UseGuards(SessionAuthGuard)
  async getStoryGraphIndexStatus(
    @Param("id") id: string,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const dramaId = parseDramaId(id);
    return this.dramaStoryGraphService.getSearchIndexStatus(
      dramaId,
      currentUser.id,
    );
  }

  @Post(":id/story-graph/pre-seed-writing")
  @UseGuards(SessionAuthGuard)
  async preSeedStoryGraphFromWriting(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const dramaId = parseDramaId(id);
    const payload = z
      .object({
        writing_id: z.number().int().positive().optional(),
        rebuild_index: z.boolean().optional(),
      })
      .parse(emptyBodyToObject(body));
    return this.dramaStoryGraphService.preSeedFromWriting(
      dramaId,
      currentUser.id,
      payload,
    );
  }

  @Get(":id/workspace")
  @UseGuards(SessionAuthGuard)
  async getDramaWorkspace(
    @Param("id") id: string,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const dramaId = parseDramaId(id);
    const [drama] = await this.databaseService.db
      .select()
      .from(dramas)
      .where(
        and(
          eq(dramas.id, dramaId),
          eq(dramas.userId, currentUser.id),
          isNull(dramas.deletedAt),
        ),
      );

    if (!drama) {
      throw new NotFoundException("drama_not_found");
    }

    const episodeRows = await this.databaseService.db
      .select()
      .from(episodes)
      .where(
        and(
          eq(episodes.dramaId, dramaId),
          eq(episodes.userId, currentUser.id),
          isNull(episodes.deletedAt),
        ),
      )
      .orderBy(asc(episodes.episodeNumber));

    const episodeIds = episodeRows.map((episode) => episode.id);

    const [
      characterRows,
      sceneRows,
      storyboardRows,
      assetRows,
      taskRows,
      canvasRows,
      mergeRows,
    ] = await Promise.all([
      this.databaseService.db
        .select()
        .from(characters)
        .where(
          and(
            eq(characters.dramaId, dramaId),
            eq(characters.userId, currentUser.id),
            isNull(characters.deletedAt),
          ),
        ),
      this.databaseService.db
        .select()
        .from(scenes)
        .where(
          and(
            eq(scenes.dramaId, dramaId),
            eq(scenes.userId, currentUser.id),
            isNull(scenes.deletedAt),
          ),
        ),
      episodeIds.length
        ? this.databaseService.db
            .select()
            .from(storyboards)
            .where(
              and(
                eq(storyboards.userId, currentUser.id),
                inArray(storyboards.episodeId, episodeIds),
                isNull(storyboards.deletedAt),
              ),
            )
        : Promise.resolve([] as (typeof storyboards.$inferSelect)[]),
      this.databaseService.db
        .select()
        .from(assets)
        .where(
          and(
            eq(assets.dramaId, dramaId),
            eq(assets.userId, currentUser.id),
            isNull(assets.deletedAt),
          ),
        ),
      this.databaseService.db
        .select()
        .from(tasks)
        .where(
          and(
            eq(tasks.dramaId, dramaId),
            eq(tasks.userId, currentUser.id),
            isNull(tasks.deletedAt),
          ),
        )
        .orderBy(desc(tasks.updatedAt))
        .limit(8),
      this.databaseService.db
        .select()
        .from(canvases)
        .where(
          and(
            eq(canvases.userId, currentUser.id),
            eq(canvases.sourceDramaId, String(dramaId)),
            isNull(canvases.deletedAt),
          ),
        )
        .orderBy(desc(canvases.updatedAt)),
      this.databaseService.db
        .select()
        .from(videoMerges)
        .where(
          and(
            eq(videoMerges.dramaId, dramaId),
            eq(videoMerges.userId, currentUser.id),
            isNull(videoMerges.deletedAt),
          ),
        )
        .orderBy(desc(videoMerges.createdAt)),
    ]);

    const projectStoryboards = storyboardRows;
    const storyboardsByEpisode = new Map<
      number,
      (typeof storyboards.$inferSelect)[]
    >();
    for (const storyboard of projectStoryboards) {
      const bucket = storyboardsByEpisode.get(storyboard.episodeId);
      if (bucket) bucket.push(storyboard);
      else storyboardsByEpisode.set(storyboard.episodeId, [storyboard]);
    }
    const episodeById = new Map(episodeRows.map((episode) => [episode.id, episode]));
    const storyboardEpisodeNumberById = new Map(
      projectStoryboards
        .map((storyboard) => {
          const episode = episodeById.get(storyboard.episodeId);
          return episode ? ([storyboard.id, episode.episodeNumber] as const) : null;
        })
        .filter((item): item is readonly [number, number] => item != null),
    );

    const scriptedEpisodes = episodeRows.filter((episode) =>
      Boolean(String(episode.scriptContent || "").trim()),
    );
    const currentScriptedEpisodes = scriptedEpisodes.filter(
      (episode) => !isStaleEpisodeGenerationMode(episode.generationMode),
    );
    const graphSummary =
      episodeRows.length > 0
        ? await this.dramaStoryGraphService.getStoryGraphSummary(
            dramaId,
            currentUser.id,
          )
        : null;
    const scriptTargetCount =
      graphSummary?.planned_episode_count || episodeRows.length;
    const currentScriptsComplete =
      graphSummary?.scripts_complete ??
      (scriptTargetCount > 0 &&
        currentScriptedEpisodes.length >= scriptTargetCount);
    const storyboardEpisodes = episodeRows.filter(
      (episode) => (storyboardsByEpisode.get(episode.id)?.length || 0) > 0,
    );
    const firstFrameDone = projectStoryboards.filter(hasStoryboardFrame).length;
    const ttsEligible = projectStoryboards.filter(hasStoryboardDialogue);
    const ttsDone = ttsEligible.filter((storyboard) =>
      Boolean(storyboard.ttsAudioUrl),
    ).length;
    const videoDone = projectStoryboards.filter((storyboard) =>
      Boolean(storyboard.videoUrl || storyboard.composedVideoUrl),
    ).length;
    const finalUrlByEpisodeId = new Map<number, string>();
    for (const merge of mergeRows) {
      if (merge.episodeId && merge.mergedUrl && !finalUrlByEpisodeId.has(merge.episodeId)) {
        finalUrlByEpisodeId.set(merge.episodeId, merge.mergedUrl);
      }
    }
    for (const episode of episodeRows) {
      if (episode.videoUrl && !finalUrlByEpisodeId.has(episode.id)) {
        finalUrlByEpisodeId.set(episode.id, episode.videoUrl);
      }
    }
    const episodesReadyForFinal = episodeRows.filter((episode) => {
      const boards = storyboardsByEpisode.get(episode.id) ?? [];
      return boards.length > 0 && boards.every((storyboard) => Boolean(storyboard.videoUrl || storyboard.composedVideoUrl));
    });
    const episodesWithoutFinal = episodesReadyForFinal.filter((episode) => !finalUrlByEpisodeId.has(episode.id));
    const activeTasks = taskRows.filter((task) =>
      isActiveTaskStatus(task.status),
    );
    const failedTasks = taskRows.filter((task) =>
      isFailedTaskStatus(task.status),
    );

    const scriptScore = scriptTargetCount
      ? currentScriptedEpisodes.length / scriptTargetCount
      : 0;
    const storyboardScore = scriptTargetCount
      ? storyboardEpisodes.length / scriptTargetCount
      : 0;
    const frameScore = projectStoryboards.length
      ? firstFrameDone / projectStoryboards.length
      : 0;
    const graphReady =
      graphSummary?.graph?.status === "ready" && !graphSummary?.is_stale;
    const graphScore = !scriptedEpisodes.length
      ? 1
      : graphReady
        ? 1
        : graphSummary?.graph
          ? 0.45
          : 0;
    const healthScore = Math.round(
      (scriptScore * 0.3 +
        graphScore * 0.2 +
        storyboardScore * 0.25 +
        frameScore * 0.25) *
        100,
    );

    const firstEpisodeWithoutScript = episodeRows.find(
      (episode) =>
        !Boolean(String(episode.scriptContent || "").trim()) ||
        isStaleEpisodeGenerationMode(episode.generationMode),
    );
    const firstEpisodeWithoutStoryboard = episodeRows.find(
      (episode) => (storyboardsByEpisode.get(episode.id)?.length || 0) === 0,
    );
    const firstStoryboardWithoutFrame = projectStoryboards.find(
      (storyboard) => !hasStoryboardFrame(storyboard),
    );
    const firstStoryboardWithoutTts = ttsEligible.find(
      (storyboard) => !storyboard.ttsAudioUrl,
    );
    const firstStoryboardWithoutVideo = projectStoryboards.find(
      (storyboard) => !storyboard.videoUrl && !storyboard.composedVideoUrl,
    );
    const firstEpisodeWithoutFinal = episodesWithoutFinal[0] ?? null;

    const gaps = [
      {
        key: "episodes_without_script",
        label: "缺当前正文剧集",
        count: Math.max(0, scriptTargetCount - currentScriptedEpisodes.length),
        href: firstEpisodeWithoutScript
          ? buildDramaWorkspaceHref(dramaId, "script", {
              episodeNumber: firstEpisodeWithoutScript.episodeNumber,
            })
          : buildDramaWorkspaceHref(dramaId, "script"),
      },
      {
        key: "story_graph_missing",
        label: "缺故事地图",
        count: currentScriptsComplete && !graphSummary?.graph ? 1 : 0,
        href: buildDramaWorkspaceHref(dramaId, "graph"),
      },
      {
        key: "story_graph_stale",
        label: "故事地图过期",
        count: graphSummary?.is_stale ? 1 : 0,
        href: buildDramaWorkspaceHref(dramaId, "graph"),
      },
      {
        key: "episodes_without_storyboards",
        label: "缺分镜剧集",
        count: graphReady
          ? Math.max(0, scriptTargetCount - storyboardEpisodes.length)
          : 0,
        href: firstEpisodeWithoutStoryboard
          ? buildDramaWorkspaceHref(dramaId, "storyboard", {
              episodeNumber: firstEpisodeWithoutStoryboard.episodeNumber,
            })
          : buildDramaWorkspaceHref(dramaId, "storyboard"),
      },
      {
        key: "shots_without_first_frame",
        label: "缺首帧镜头",
        count: Math.max(0, projectStoryboards.length - firstFrameDone),
        href: firstStoryboardWithoutFrame
          ? buildDramaWorkspaceHref(dramaId, "assets", {
              episodeNumber: episodeById.get(firstStoryboardWithoutFrame.episodeId)?.episodeNumber,
              shotId: firstStoryboardWithoutFrame.id,
            })
          : buildDramaWorkspaceHref(dramaId, "assets"),
      },
      {
        key: "shots_without_tts",
        label: "缺配音镜头",
        count: Math.max(0, ttsEligible.length - ttsDone),
        href: firstStoryboardWithoutTts
          ? buildDramaWorkspaceHref(dramaId, "video", {
              episodeNumber: episodeById.get(firstStoryboardWithoutTts.episodeId)?.episodeNumber,
              shotId: firstStoryboardWithoutTts.id,
            })
          : buildDramaWorkspaceHref(dramaId, "video"),
      },
      {
        key: "shots_without_video",
        label: "缺视频镜头",
        count: Math.max(0, projectStoryboards.length - videoDone),
        href: firstStoryboardWithoutVideo
          ? buildDramaWorkspaceHref(dramaId, "video", {
              episodeNumber: episodeById.get(firstStoryboardWithoutVideo.episodeId)?.episodeNumber,
              shotId: firstStoryboardWithoutVideo.id,
            })
          : buildDramaWorkspaceHref(dramaId, "video"),
      },
      {
        key: "episodes_without_final",
        label: "缺可审核成片",
        count: episodesWithoutFinal.length,
        href: firstEpisodeWithoutFinal
          ? buildDramaWorkspaceHref(dramaId, "final", {
              episodeNumber: firstEpisodeWithoutFinal.episodeNumber,
            })
          : buildDramaWorkspaceHref(dramaId, "final"),
      },
    ];

    const nextSteps: WorkspaceNextStep[] = [
      episodeRows.length === 0
        ? {
            key: "create_episodes",
            title: "创建剧集",
            description: "进入剧集引导，先完成源稿理解、分集蓝图和正文。",
            href: `/drama/${dramaId}/episodes?stage=source`,
            severity: "high",
          }
        : null,
      scriptTargetCount > 0 && !currentScriptsComplete
        ? {
            key: "complete_scripts",
            title: "补齐剧本正文",
            description: `还有 ${Math.max(0, scriptTargetCount - currentScriptedEpisodes.length)} 集缺少当前版本正文，建议先补齐确定性主线。`,
            href: `/drama/${dramaId}/episodes?stage=script`,
            severity: "high",
          }
        : null,
      currentScriptsComplete && (!graphSummary?.graph || graphSummary.is_stale)
        ? {
            key: "build_story_graph",
            title: graphSummary?.is_stale ? "重建故事地图" : "构建故事地图",
            description: graphSummary?.is_stale
              ? "剧本已更新，故事地图与当前正文不一致，建议重建后再进入分镜。"
              : "剧本已就绪，先从剧本抽取故事地图，再进入分镜会更稳。",
            href: `/drama/${dramaId}/episodes?stage=graph`,
            severity: "high",
          }
        : null,
      graphReady && storyboardEpisodes.length < scriptTargetCount
        ? {
            key: "complete_storyboards",
            title: "生成或检查分镜",
            description: `还有 ${Math.max(0, scriptTargetCount - storyboardEpisodes.length)} 集没有分镜，进入剧集工作台继续推进。`,
            href: `/drama/${dramaId}/episodes?stage=storyboard`,
            severity: "medium",
          }
        : null,
      graphReady &&
      projectStoryboards.length > 0 &&
      firstFrameDone < projectStoryboards.length
        ? {
            key: "produce_frames",
            title: "补齐镜头首帧",
            description: `还有 ${projectStoryboards.length - firstFrameDone} 个镜头缺首帧，进入单集工作台继续处理。`,
            href: firstStoryboardWithoutFrame
              ? buildDramaWorkspaceHref(dramaId, "assets", {
                  episodeNumber: episodeById.get(firstStoryboardWithoutFrame.episodeId)?.episodeNumber,
                  shotId: firstStoryboardWithoutFrame.id,
                })
              : buildDramaWorkspaceHref(dramaId, "assets"),
            severity: "medium",
          }
        : null,
      episodesWithoutFinal.length > 0
        ? {
            key: "compose_final",
            title: "生成可审核成片",
            description: `还有 ${episodesWithoutFinal.length} 集镜头已齐备但缺少成片版本。`,
            href: firstEpisodeWithoutFinal
              ? buildDramaWorkspaceHref(dramaId, "final", {
                  episodeNumber: firstEpisodeWithoutFinal.episodeNumber,
                })
              : buildDramaWorkspaceHref(dramaId, "final"),
            severity: "medium",
          }
        : null,
      failedTasks.length > 0
        ? {
            key: "review_failed_tasks",
            title: "处理失败任务",
            description: `有 ${failedTasks.length} 个最近失败任务，建议先查看错误原因。`,
            href: `/drama/${dramaId}/tasks?status=failed`,
            severity: "medium",
          }
        : null,
    ].filter((step): step is WorkspaceNextStep => Boolean(step));

    if (nextSteps.length === 0) {
      nextSteps.push({
        key: "review_project",
        title: "检查成片",
        description:
          "主线内容已具备基础完成度，可以逐集检查合成结果与交付状态。",
        href: `/drama/${dramaId}/final`,
        severity: "low",
      });
    }

    return {
      project: dramaPayloadBase(drama),
      counts: {
        episodes: Math.max(episodeRows.length, scriptTargetCount),
        scripted_episodes: currentScriptedEpisodes.length,
        storyboard_episodes: storyboardEpisodes.length,
        storyboards: projectStoryboards.length,
        characters: characterRows.length,
        scenes: sceneRows.length,
        assets: assetRows.length,
        canvases: canvasRows.length,
        active_tasks: activeTasks.length,
        failed_tasks: failedTasks.length,
      },
      production: {
        first_frame_done: firstFrameDone,
        first_frame_total: projectStoryboards.length,
        tts_done: ttsDone,
        tts_total: ttsEligible.length,
        video_done: videoDone,
        video_total: projectStoryboards.length,
        gaps,
      },
      health: {
        score: healthScore,
        status:
          healthScore >= 80
            ? "healthy"
            : healthScore >= 45
              ? "attention"
              : "blocked",
      },
      next_steps: nextSteps,
      recent_tasks: taskRows.map((task) => {
        const directEpisodeNumber = task.episodeId
          ? episodeById.get(task.episodeId)?.episodeNumber
          : null;
        const storyboardEpisodeNumber = task.storyboardId
          ? storyboardEpisodeNumberById.get(task.storyboardId)
          : null;
        return serializeWorkspaceTask(task, directEpisodeNumber ?? storyboardEpisodeNumber ?? null);
      }),
      canvases: canvasRows.map((canvas) => ({
        id: canvas.id,
        title: canvas.title,
        source: canvas.source,
        source_episode_id: canvas.sourceEpisodeId,
        updated_at: canvas.updatedAt,
        href: `/drama/${dramaId}/canvas/${canvas.id}`,
      })),
      episodes: episodeRows.map((episode) => {
        const episodeStoryboards = storyboardsByEpisode.get(episode.id) || [];
        const missingFrames = episodeStoryboards.filter(
          (storyboard) => !hasStoryboardFrame(storyboard),
        ).length;
        return {
          id: episode.id,
          episode_number: episode.episodeNumber,
          title: episode.title,
          status: episode.status,
          has_script:
            Boolean(String(episode.scriptContent || "").trim()) &&
            !isStaleEpisodeGenerationMode(episode.generationMode),
          review_status: episode.reviewStatus,
          storyboard_count: episodeStoryboards.length,
          missing_first_frame_count: missingFrames,
          href: buildDramaWorkspaceHref(dramaId, "script", {
            episodeNumber: episode.episodeNumber,
          }),
        };
      }),
    };
  }

  @Get(":id")
  async getDrama(@Req() request: FastifyRequest, @Param("id") id: string) {
    const dramaId = parseDramaId(id);
    const session = await this.authService.getSession(request);

    if (session?.user) {
      const [owned] = await this.databaseService.db
        .select()
        .from(dramas)
        .where(
          and(
            eq(dramas.id, dramaId),
            eq(dramas.userId, session.user.id),
            isNull(dramas.deletedAt),
          ),
        );

      if (owned) {
        const [episodeRows, characterRows, sceneRows, propRows] =
          await Promise.all([
            this.databaseService.db
              .select()
              .from(episodes)
              .where(
                and(
                  eq(episodes.dramaId, dramaId),
                  eq(episodes.userId, session.user.id),
                  isNull(episodes.deletedAt),
                ),
              ),
            this.databaseService.db
              .select()
              .from(characters)
              .where(
                and(
                  eq(characters.dramaId, dramaId),
                  eq(characters.userId, session.user.id),
                  isNull(characters.deletedAt),
                ),
              ),
            this.databaseService.db
              .select()
              .from(scenes)
              .where(
                and(
                  eq(scenes.dramaId, dramaId),
                  eq(scenes.userId, session.user.id),
                  isNull(scenes.deletedAt),
                ),
              ),
            this.databaseService.db
              .select()
              .from(props)
              .where(
                and(
                  eq(props.dramaId, dramaId),
                  eq(props.userId, session.user.id),
                  isNull(props.deletedAt),
                ),
              ),
          ]);

        return {
          ...dramaPayloadBase(owned),
          episodes: toSnakeCaseArrayWithPublicMedia(
            episodeRows as unknown as Record<string, unknown>[],
            episodeMediaFields,
          ),
          characters: toSnakeCaseArrayWithPublicMedia(
            characterRows as unknown as Record<string, unknown>[],
            characterMediaFields,
          ),
          scenes: toSnakeCaseArrayWithPublicMedia(
            sceneRows as unknown as Record<string, unknown>[],
            sceneMediaFields,
          ),
          props: toSnakeCaseArrayWithPublicMedia(
            propRows as unknown as Record<string, unknown>[],
            propMediaFields,
          ),
        };
      }
    }

    const [publicDrama] = await this.databaseService.db
      .select()
      .from(dramas)
      .where(
        and(
          eq(dramas.id, dramaId),
          isNull(dramas.deletedAt),
          eq(dramas.isPublic, true),
        ),
      );

    if (!publicDrama) {
      return { error: "drama_not_found" };
    }

    const [episodeRows, characterRows, sceneRows, propRows] = await Promise.all(
      [
        this.databaseService.db
          .select()
          .from(episodes)
          .where(
            and(eq(episodes.dramaId, dramaId), isNull(episodes.deletedAt)),
          ),
        this.databaseService.db
          .select()
          .from(characters)
          .where(
            and(eq(characters.dramaId, dramaId), isNull(characters.deletedAt)),
          ),
        this.databaseService.db
          .select()
          .from(scenes)
          .where(and(eq(scenes.dramaId, dramaId), isNull(scenes.deletedAt))),
        this.databaseService.db
          .select()
          .from(props)
          .where(and(eq(props.dramaId, dramaId), isNull(props.deletedAt))),
      ],
    );

    return {
      ...dramaPayloadBase(publicDrama),
      episodes: toSnakeCaseArrayWithPublicMedia(
        episodeRows as unknown as Record<string, unknown>[],
        episodeMediaFields,
      ),
      characters: toSnakeCaseArrayWithPublicMedia(
        characterRows as unknown as Record<string, unknown>[],
        characterMediaFields,
      ),
      scenes: toSnakeCaseArrayWithPublicMedia(
        sceneRows as unknown as Record<string, unknown>[],
        sceneMediaFields,
      ),
      props: toSnakeCaseArrayWithPublicMedia(
        propRows as unknown as Record<string, unknown>[],
        propMediaFields,
      ),
      read_only: true,
    };
  }

  @Put(":id")
  @UseGuards(SessionAuthGuard)
  async updateDrama(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const dramaId = parseDramaId(id);
    const payload = dramaUpdateSchema.parse(body);

    const [owned] = await this.databaseService.db
      .select()
      .from(dramas)
      .where(
        and(
          eq(dramas.id, dramaId),
          eq(dramas.userId, currentUser.id),
          isNull(dramas.deletedAt),
        ),
      );

    if (!owned) {
      return { error: "drama_not_found" };
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (payload.title !== undefined) updates.title = payload.title;
    if (payload.description !== undefined)
      updates.description = payload.description;
    if (payload.genre !== undefined) updates.genre = payload.genre;
    if (payload.style !== undefined) updates.style = payload.style;
    if (payload.status !== undefined) updates.status = payload.status;
    if (payload.thumbnail !== undefined)
      updates.thumbnail = toPublicMediaUrl(payload.thumbnail);
    if (payload.tags !== undefined) updates.tags = JSON.stringify(payload.tags);
    if (payload.metadata !== undefined)
      updates.metadata = serializeMetadata(payload.metadata);
    if (payload.total_episodes !== undefined)
      updates.totalEpisodes = payload.total_episodes;

    await this.databaseService.db
      .update(dramas)
      .set(updates)
      .where(and(eq(dramas.id, dramaId), eq(dramas.userId, currentUser.id)));

    return { success: true };
  }

  @Delete(":id")
  @UseGuards(SessionAuthGuard)
  async deleteDrama(
    @Param("id") id: string,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const dramaId = parseDramaId(id);

    const [owned] = await this.databaseService.db
      .select()
      .from(dramas)
      .where(
        and(
          eq(dramas.id, dramaId),
          eq(dramas.userId, currentUser.id),
          isNull(dramas.deletedAt),
        ),
      );

    if (!owned) {
      throw new NotFoundException("drama_not_found");
    }

    const now = new Date();

    await this.databaseService.db.transaction(async (tx) => {
      // 1. Cascade soft-delete episodes and their children
      const episodeRows = await tx
        .select({ id: episodes.id })
        .from(episodes)
        .where(and(eq(episodes.dramaId, dramaId), isNull(episodes.deletedAt)));
      const episodeIds = episodeRows.map((episode) => episode.id);

      if (episodeIds.length) {
        // Soft-delete storyboards linked to drama episodes
        await tx
          .update(storyboards)
          .set({ deletedAt: now, updatedAt: now })
          .where(
            and(
              inArray(storyboards.episodeId, episodeIds),
              isNull(storyboards.deletedAt),
            ),
          );

        // Hard-delete junction tables without deletedAt
        await tx
          .delete(episodeCharacters)
          .where(inArray(episodeCharacters.episodeId, episodeIds));
        await tx
          .delete(episodeScenes)
          .where(inArray(episodeScenes.episodeId, episodeIds));

        // Soft-delete episodes
        await tx
          .update(episodes)
          .set({ deletedAt: now, updatedAt: now })
          .where(
            and(eq(episodes.dramaId, dramaId), isNull(episodes.deletedAt)),
          );
      }

      // 2. Soft-delete drama sources and hard-delete source chunks (no deletedAt)
      const sourceRows = await tx
        .select({ id: dramaSources.id })
        .from(dramaSources)
        .where(
          and(
            eq(dramaSources.dramaId, dramaId),
            isNull(dramaSources.deletedAt),
          ),
        );
      const sourceIds = sourceRows.map((source) => source.id);

      if (sourceIds.length) {
        await tx
          .delete(dramaSourceChunks)
          .where(inArray(dramaSourceChunks.sourceId, sourceIds));

        await tx
          .update(dramaSources)
          .set({ deletedAt: now, updatedAt: now })
          .where(
            and(
              eq(dramaSources.dramaId, dramaId),
              isNull(dramaSources.deletedAt),
            ),
          );
      }

      // 3. Soft-delete story graph and hard-delete related tables without deletedAt
      const graphRows = await tx
        .select({ id: dramaStoryGraphs.id })
        .from(dramaStoryGraphs)
        .where(
          and(
            eq(dramaStoryGraphs.dramaId, dramaId),
            isNull(dramaStoryGraphs.deletedAt),
          ),
        );
      const graphIds = graphRows.map((graph) => graph.id);

      if (graphIds.length) {
        // dramaGraphIndexChunks has ON DELETE CASCADE on graphId, but we handle it explicitly for clarity
        await tx
          .delete(dramaGraphIndexChunks)
          .where(inArray(dramaGraphIndexChunks.graphId, graphIds));
        await tx
          .delete(dramaEntityAliases)
          .where(inArray(dramaEntityAliases.graphId, graphIds));
        await tx
          .delete(dramaGraphEvents)
          .where(inArray(dramaGraphEvents.graphId, graphIds));
        await tx
          .delete(dramaGraphRelations)
          .where(
            and(
              eq(dramaGraphRelations.dramaId, dramaId),
              isNull(dramaGraphRelations.deletedAt),
            ),
          );
        await tx
          .delete(dramaGraphEntities)
          .where(
            and(
              eq(dramaGraphEntities.dramaId, dramaId),
              isNull(dramaGraphEntities.deletedAt),
            ),
          );

        await tx
          .update(dramaStoryGraphs)
          .set({ deletedAt: now, updatedAt: now })
          .where(
            and(
              eq(dramaStoryGraphs.dramaId, dramaId),
              isNull(dramaStoryGraphs.deletedAt),
            ),
          );
      }

      // 4. Soft-delete characters, scenes, props
      await tx
        .update(characters)
        .set({ deletedAt: now, updatedAt: now })
        .where(
          and(eq(characters.dramaId, dramaId), isNull(characters.deletedAt)),
        );
      await tx
        .update(scenes)
        .set({ deletedAt: now, updatedAt: now })
        .where(and(eq(scenes.dramaId, dramaId), isNull(scenes.deletedAt)));
      await tx
        .update(props)
        .set({ deletedAt: now, updatedAt: now })
        .where(and(eq(props.dramaId, dramaId), isNull(props.deletedAt)));

      // 5. Soft-delete assets and asset links
      await tx
        .delete(dramaAssetLinks)
        .where(eq(dramaAssetLinks.dramaId, dramaId));
      await tx
        .update(assets)
        .set({ deletedAt: now, updatedAt: now })
        .where(and(eq(assets.dramaId, dramaId), isNull(assets.deletedAt)));

      // 6. Soft-delete tasks
      await tx
        .update(tasks)
        .set({ deletedAt: now, updatedAt: now })
        .where(and(eq(tasks.dramaId, dramaId), isNull(tasks.deletedAt)));

      // 7. Soft-delete video generations and merges
      await tx
        .update(videoGenerations)
        .set({ deletedAt: now, updatedAt: now })
        .where(
          and(
            eq(videoGenerations.dramaId, dramaId),
            isNull(videoGenerations.deletedAt),
          ),
        );

      // Hard-delete video merges (no deletedAt)
      await tx.delete(videoMerges).where(eq(videoMerges.dramaId, dramaId));

      // Hard-delete image generations (no deletedAt). Soft-deleted assets and
      // video generations still enforce their foreign keys, so unlink every
      // dependent row before removing the generation records.
      const imageGenerationRows = await tx
        .select({ id: imageGenerations.id })
        .from(imageGenerations)
        .where(eq(imageGenerations.dramaId, dramaId));
      const imageGenerationIds = imageGenerationRows.map(
        (generation) => generation.id,
      );

      if (imageGenerationIds.length) {
        await tx
          .update(assets)
          .set({ imageGenerationId: null, updatedAt: now })
          .where(inArray(assets.imageGenerationId, imageGenerationIds));
        await tx
          .update(videoGenerations)
          .set({ imageGenId: null, updatedAt: now })
          .where(inArray(videoGenerations.imageGenId, imageGenerationIds));
        await tx
          .delete(imageGenerations)
          .where(inArray(imageGenerations.id, imageGenerationIds));
      }

      // 8. Soft-delete canvases linked via source_drama_id
      await tx
        .update(canvases)
        .set({ deletedAt: now, updatedAt: now })
        .where(
          and(
            eq(canvases.sourceDramaId, String(dramaId)),
            isNull(canvases.deletedAt),
          ),
        );

      // 9. Finally soft-delete the drama itself
      await tx
        .update(dramas)
        .set({ deletedAt: now, updatedAt: now })
        .where(and(eq(dramas.id, dramaId), eq(dramas.userId, currentUser.id)));
    });

    return { success: true, deleted_drama_id: dramaId };
  }
}
