import { describe, expect, it, vi } from "vitest";

import {
  assets,
  dramaSources,
  dramaStoryGraphs,
  dramas,
  episodes,
  imageGenerations,
  videoGenerations,
} from "../../db/schema";
import { DramasController } from "./dramas.controller";

type Row = Record<string, unknown>;

function query(rows: Row[]) {
  const value: any = {
    where: vi.fn(() => value),
    then: (
      resolve: (value: Row[]) => unknown,
      reject?: (error: unknown) => unknown,
    ) => Promise.resolve(rows).then(resolve, reject),
  };
  return value;
}

describe("DramasController.deleteDrama", () => {
  it("unlinks image generation dependents before deleting generations", async () => {
    const events: Array<{
      kind: "update" | "delete";
      table: unknown;
      values?: Row;
    }> = [];
    const rows = new Map<unknown, Row[]>([
      [dramas, [{ id: 2, userId: 7, deletedAt: null }]],
      [episodes, []],
      [dramaSources, []],
      [dramaStoryGraphs, []],
      [imageGenerations, [{ id: 41 }]],
    ]);

    const db: any = {
      select: vi.fn(() => ({
        from: vi.fn((table: unknown) => query(rows.get(table) ?? [])),
      })),
      update: vi.fn((table: unknown) => ({
        set: vi.fn((values: Row) => ({
          where: vi.fn(async () => {
            events.push({ kind: "update", table, values });
          }),
        })),
      })),
      delete: vi.fn((table: unknown) => ({
        where: vi.fn(async () => {
          events.push({ kind: "delete", table });
        }),
      })),
    };
    db.transaction = vi.fn(
      async (callback: (tx: typeof db) => Promise<unknown>) => callback(db),
    );

    const controller = new DramasController(
      { db } as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(controller.deleteDrama("2", { id: 7 } as never)).resolves.toEqual({
      success: true,
      deleted_drama_id: 2,
    });

    const assetUnlinkIndex = events.findIndex(
      (event) =>
        event.kind === "update" &&
        event.table === assets &&
        event.values?.imageGenerationId === null,
    );
    const videoUnlinkIndex = events.findIndex(
      (event) =>
        event.kind === "update" &&
        event.table === videoGenerations &&
        event.values?.imageGenId === null,
    );
    const generationDeleteIndex = events.findIndex(
      (event) => event.kind === "delete" && event.table === imageGenerations,
    );

    expect(assetUnlinkIndex).toBeGreaterThanOrEqual(0);
    expect(videoUnlinkIndex).toBeGreaterThan(assetUnlinkIndex);
    expect(generationDeleteIndex).toBeGreaterThan(videoUnlinkIndex);
  });
});
