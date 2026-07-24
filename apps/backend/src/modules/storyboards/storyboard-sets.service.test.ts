import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  characters,
  episodeCharacters,
  episodes,
  episodeScenes,
  scenes,
  storyboardCharacters,
  storyboardBoundaries,
  storyboardSetItems,
  storyboardSets,
  storyboards,
} from "../../db/schema";
import { StoryboardSetsService } from "./storyboard-sets.service";

type Row = Record<string, any>;

function query(rows: Row[]) {
  const value: any = {
    where: vi.fn(() => value),
    orderBy: vi.fn(() => value),
    limit: vi.fn((limit: number) => Promise.resolve(rows.slice(0, limit))),
    then: (
      resolve: (value: Row[]) => unknown,
      reject?: (error: unknown) => unknown,
    ) => Promise.resolve(rows).then(resolve, reject),
  };
  return value;
}

function mutation(rows: Row[] = []) {
  const value: any = {
    returning: vi.fn(() => Promise.resolve(rows)),
    then: (
      resolve: (value: Row[]) => unknown,
      reject?: (error: unknown) => unknown,
    ) => Promise.resolve(rows).then(resolve, reject),
  };
  return value;
}

function createDatabase(input: {
  episode?: Row;
  activeStoryboards?: Row[];
  sets?: Row[][];
  setItems?: Row[];
  availableScenes?: Row[];
  availableCharacters?: Row[];
}) {
  const inserts: Array<{ table: unknown; values: Row | Row[] }> = [];
  const updates: Array<{ table: unknown; values: Row }> = [];
  const tables = new Map<unknown, Row[]>([
    [
      episodes,
      input.episode
        ? [input.episode]
        : [
            {
              id: 101,
              userId: 7,
              dramaId: 282,
              episodeNumber: 1,
              deletedAt: null,
            },
          ],
    ],
    [storyboards, input.activeStoryboards ?? []],
    [storyboardSetItems, input.setItems ?? []],
    [scenes, input.availableScenes ?? []],
    [characters, input.availableCharacters ?? []],
    [episodeScenes, []],
    [episodeCharacters, []],
    [storyboardCharacters, []],
  ]);
  const queuedSets = [...(input.sets ?? [])];
  let nextSetId = 800;
  let nextStoryboardId = 900;

  const rowsFor = (table: unknown) => {
    if (table === storyboardSets && queuedSets.length) {
      return queuedSets.shift() ?? [];
    }
    return tables.get(table) ?? [];
  };

  const db: any = {
    select: vi.fn(() => ({
      from: vi.fn((table: unknown) => query(rowsFor(table))),
    })),
    insert: vi.fn((table: unknown) => ({
      values: vi.fn((values: Row | Row[]) => {
        inserts.push({ table, values });
        const rows = Array.isArray(values) ? values : [values];
        if (table === storyboardSets) {
          const inserted = rows.map((row) => ({
            id: nextSetId++,
            ...row,
          }));
          return mutation(inserted);
        }
        if (table === storyboards) {
          const inserted = rows.map((row) => ({
            id: nextStoryboardId++,
            storyboardNumber: row.storyboardNumber,
            ...row,
          }));
          return mutation(inserted);
        }
        return mutation();
      }),
    })),
    update: vi.fn((table: unknown) => ({
      set: vi.fn((values: Row) => ({
        where: vi.fn(() => {
          updates.push({ table, values });
          return mutation();
        }),
      })),
    })),
    transaction: vi.fn((callback: (tx: unknown) => Promise<unknown>) =>
      callback(db),
    ),
  };

  return { db, inserts, updates };
}

function agentSet(overrides: Row = {}) {
  return {
    id: 501,
    userId: 7,
    dramaId: 282,
    episodeId: 101,
    revision: 2,
    status: "draft",
    origin: "agent",
    episodeScriptHash: "script-hash",
    storyGraphId: 401,
    storyGraphScriptHash: "graph-hash",
    baseRevision: null,
    baseContentHash: null,
    humanEditedAt: null,
    ...overrides,
  };
}

function storyboard(overrides: Row = {}) {
  return {
    id: 601,
    userId: 7,
    episodeId: 101,
    storyboardSetId: null,
    storyboardNumber: 1,
    title: "旧镜头",
    description: "旧内容",
    action: "旧动作",
    dialogue: null,
    duration: 10,
    sceneId: null,
    status: null,
    composedImage: null,
    firstFrameImage: null,
    lastFrameImage: null,
    videoUrl: null,
    ttsAudioUrl: null,
    subtitleUrl: null,
    composedVideoUrl: null,
    deletedAt: null,
    ...overrides,
  };
}

function draftItem(overrides: Row = {}) {
  return {
    id: 701,
    storyboardSetId: 501,
    storyboardNumber: 1,
    payloadJson: JSON.stringify({
      shot_number: 1,
      title: "新镜头",
      description: "主角推开旧宅的门",
      duration: 8,
      character_ids: [],
    }),
    ...overrides,
  };
}

function continuityDraftItem(shotNumber: number, overrides: Row = {}) {
  return {
    id: 710 + shotNumber,
    storyboardSetId: 501,
    storyboardNumber: shotNumber,
    payloadJson: JSON.stringify({
      shot_number: shotNumber,
      title: `镜头 ${shotNumber}`,
      description: `镜头 ${shotNumber} 的画面`,
      action: `镜头 ${shotNumber} 的动作`,
      duration: 8,
      scene_id: 301,
      character_ids: [201],
      ...(shotNumber === 1
        ? {
            closing_state: { action: "主角停在门口，右手扶住门框" },
            continuity_to_next: {
              relation_type: "continuous",
              transition_type: "match_cut",
              action_handoff: "镜头切到室内，主角保持扶门动作迈入。",
              audio_bridge: "门轴声延续。",
            },
          }
        : {
            opening_state: { action: "主角扶门迈入室内" },
          }),
      ...overrides,
    }),
  };
}

describe("StoryboardSetsService", () => {
  it("stores a versioned Agent draft with a stable content hash", async () => {
    const database = createDatabase({
      sets: [[]],
    });
    const service = new StoryboardSetsService({ db: database.db } as any);

    const result = await service.createAgentDraft({
      userId: 7,
      dramaId: 282,
      episodeId: 101,
      sourceTaskId: 41,
      sourceExecutionId: 81,
      episodeScriptHash: "script-hash",
      storyGraphId: 401,
      storyGraphScriptHash: "graph-hash",
      storyboards: [
        {
          shot_number: 1,
          description: "主角推开旧宅的门",
          duration: 8,
        },
      ],
    });

    expect(result).toMatchObject({
      id: 800,
      revision: 1,
      episode_id: 101,
      storyboard_count: 1,
    });
    expect(result.content_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(
      database.inserts.find((item) => item.table === storyboardSets)?.values,
    ).toMatchObject({
      sourceTaskId: 41,
      sourceExecutionId: 81,
      status: "draft",
      origin: "agent",
      episodeScriptHash: "script-hash",
      storyGraphId: 401,
    });
    expect(
      database.inserts.find((item) => item.table === storyboardSetItems)
        ?.values,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ storyboardSetId: 800, storyboardNumber: 1 }),
      ]),
    );
  });

  it("keeps a draft in review when legacy storyboard rows would be replaced", async () => {
    const database = createDatabase({
      activeStoryboards: [storyboard()],
      sets: [[agentSet()]],
      setItems: [draftItem()],
    });
    const service = new StoryboardSetsService({ db: database.db } as any);

    const result = await service.publishAgentDraft({
      userId: 7,
      dramaId: 282,
      episodeId: 101,
      storyboardSetId: 501,
      episodeScriptHash: "script-hash",
      storyGraphId: 401,
      storyGraphScriptHash: "graph-hash",
    });

    expect(result).toEqual({
      setId: 501,
      revision: 2,
      status: "review_required",
      storyboardCount: 1,
      requiresReview: true,
    });
    expect(database.updates).toContainEqual(
      expect.objectContaining({
        table: storyboardSets,
        values: expect.objectContaining({ status: "review_required" }),
      }),
    );
    expect(database.inserts.some((item) => item.table === storyboards)).toBe(
      false,
    );
  });

  it("compiles adjacent storyboard continuity into a boundary contract on publish", async () => {
    const database = createDatabase({
      sets: [[agentSet()]],
      setItems: [continuityDraftItem(1), continuityDraftItem(2)],
      availableScenes: [{ id: 301 }],
      availableCharacters: [{ id: 201 }],
    });
    const service = new StoryboardSetsService({ db: database.db } as any);

    const result = await service.publishAgentDraft({
      userId: 7,
      dramaId: 282,
      episodeId: 101,
      storyboardSetId: 501,
      episodeScriptHash: "script-hash",
      storyGraphId: 401,
      storyGraphScriptHash: "graph-hash",
      confirmReplace: true,
    });

    expect(result).toMatchObject({ status: "ready", storyboardCount: 2 });
    expect(
      database.inserts.find((item) => item.table === storyboardBoundaries)
        ?.values,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          episodeId: 101,
          sourceStoryboardSetId: 501,
          relationType: "continuous",
          transitionType: "match_cut",
          status: "ready",
        }),
      ]),
    );
  });

  it("blocks an intentional cut that does not state its narrative or editing intent", async () => {
    const missingIntent = {
      id: 711,
      storyboardSetId: 501,
      storyboardNumber: 1,
      payloadJson: JSON.stringify({
        shot_number: 1,
        title: "镜头 1",
        description: "主角站在旧宅门前。",
        action: "主角低头看着钥匙。",
        duration: 8,
        scene_id: 301,
        character_ids: [201],
        continuity_to_next: {
          relation_type: "intentional_cut",
          transition_type: "hard_cut",
        },
      }),
    };
    const database = createDatabase({
      sets: [[agentSet()]],
      setItems: [missingIntent, continuityDraftItem(2)],
      availableScenes: [{ id: 301 }],
      availableCharacters: [{ id: 201 }],
    });
    const service = new StoryboardSetsService({ db: database.db } as any);

    const result = await service.publishAgentDraft({
      userId: 7,
      dramaId: 282,
      episodeId: 101,
      storyboardSetId: 501,
      episodeScriptHash: "script-hash",
      storyGraphId: 401,
      storyGraphScriptHash: "graph-hash",
      confirmReplace: true,
    });

    expect(result).toMatchObject({ status: "ready", storyboardCount: 2 });
    expect(
      database.inserts.find((item) => item.table === storyboardBoundaries)
        ?.values,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relationType: "intentional_cut",
          status: "blocked",
          reviewJson: expect.stringContaining("continuity_cut_intent_missing"),
        }),
      ]),
    );
  });

  it("keeps a draft in review when the active Agent set was edited by a human", async () => {
    const active = storyboard({ storyboardSetId: 490 });
    const expectedHash = createExpectedBaseHash(active);
    const draft = agentSet({
      baseRevision: 1,
      baseContentHash: expectedHash,
    });
    const secondDatabase = createDatabase({
      activeStoryboards: [active],
      sets: [[draft], [{ id: 490, revision: 1, humanEditedAt: new Date() }]],
      setItems: [draftItem()],
    });
    const secondService = new StoryboardSetsService({
      db: secondDatabase.db,
    } as any);

    const result = await secondService.publishAgentDraft({
      userId: 7,
      dramaId: 282,
      episodeId: 101,
      storyboardSetId: 501,
      episodeScriptHash: "script-hash",
      storyGraphId: 401,
      storyGraphScriptHash: "graph-hash",
    });

    expect(result.status).toBe("review_required");
    expect(result.requiresReview).toBe(true);
  });

  it("keeps a draft in review when current storyboards already have media", async () => {
    const active = storyboard({
      storyboardSetId: 490,
      firstFrameImage: "/uploads/storyboard-601.png",
    });
    const expectedHash = createExpectedBaseHash(active);
    const database = createDatabase({
      activeStoryboards: [active],
      sets: [
        [
          agentSet({
            baseRevision: 1,
            baseContentHash: expectedHash,
          }),
        ],
        [{ id: 490, revision: 1, humanEditedAt: null }],
      ],
      setItems: [draftItem()],
    });
    const service = new StoryboardSetsService({ db: database.db } as any);

    const result = await service.publishAgentDraft({
      userId: 7,
      dramaId: 282,
      episodeId: 101,
      storyboardSetId: 501,
      episodeScriptHash: "script-hash",
      storyGraphId: 401,
      storyGraphScriptHash: "graph-hash",
    });

    expect(result).toEqual({
      setId: 501,
      revision: 2,
      status: "review_required",
      storyboardCount: 1,
      requiresReview: true,
    });
    expect(database.inserts.some((item) => item.table === storyboards)).toBe(
      false,
    );
  });

  it("publishes a draft when no protected storyboard baseline exists", async () => {
    const database = createDatabase({
      sets: [[agentSet()]],
      setItems: [draftItem()],
    });
    const service = new StoryboardSetsService({ db: database.db } as any);

    const result = await service.publishAgentDraft({
      userId: 7,
      dramaId: 282,
      episodeId: 101,
      storyboardSetId: 501,
      episodeScriptHash: "script-hash",
      storyGraphId: 401,
      storyGraphScriptHash: "graph-hash",
    });

    expect(result).toEqual({
      setId: 501,
      revision: 2,
      status: "ready",
      storyboardCount: 1,
      requiresReview: false,
    });
    expect(
      database.inserts.find((item) => item.table === storyboards)?.values,
    ).toMatchObject({
      storyboardSetId: 501,
      storyboardNumber: 1,
      duration: 8,
    });
    expect(database.updates).toContainEqual(
      expect.objectContaining({
        table: storyboardSets,
        values: expect.objectContaining({ status: "ready" }),
      }),
    );
  });
});

function createExpectedBaseHash(value: Row) {
  const canonicalJson = (input: unknown): string => {
    if (Array.isArray(input)) {
      return `[${input.map((item) => canonicalJson(item)).join(",")}]`;
    }
    if (input && typeof input === "object") {
      const raw = input as Record<string, unknown>;
      return `{${Object.keys(raw)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${canonicalJson(raw[key])}`)
        .join(",")}}`;
    }
    return JSON.stringify(input);
  };
  const content = [
    {
      storyboard_number: value.storyboardNumber,
      title: value.title,
      description: value.description,
      action: value.action,
      dialogue: value.dialogue,
      duration: value.duration,
      scene_id: value.sceneId,
      status: value.status,
      storyboard_set_id: value.storyboardSetId,
    },
  ];
  return createHash("sha256")
    .update(canonicalJson(content), "utf8")
    .digest("hex");
}
