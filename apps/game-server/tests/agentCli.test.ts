import { describe, expect, test } from "bun:test";
import { createObservatoryBuild, summarizeMutationResult } from "../../../tools/lakecraft-agent/cli";

describe("agent CLI deterministic example", () => {
  test("creates a stable, unique, bounded glass observatory batch", () => {
    const first = createObservatoryBuild({ x: 10, y: 21, z: -4 });
    const second = createObservatoryBuild({ x: 10, y: 21, z: -4 });
    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThan(300);
    expect(first.length).toBeLessThanOrEqual(512);
    expect(new Set(first.map((edit) => `${edit.x}:${edit.y}:${edit.z}`)).size).toBe(first.length);
    expect(first).toContainEqual({ x: 10, y: 24, z: -6, block: 21 });
    expect(first.some((edit) => edit.block === 19)).toBe(true);
    expect(first.some((edit) => edit.block === 26)).toBe(true);
  });

  test("keeps ordinary agent mutation output compact unless explicitly verbose", () => {
    const receipt = {
      ok: true, operationId: "example.observatory.0.21.0.v1", replayed: false, revision: 404,
      edits: Array.from({ length: 404 }, (_, index) => ({ x: index, y: 21, z: 0, block: 26, revision: index + 1 })),
    };
    expect(summarizeMutationResult(receipt)).toEqual({
      ok: true, operationId: receipt.operationId, replayed: false, revision: 404, editCount: 404,
    });
    expect(summarizeMutationResult(receipt, true)).toBe(receipt);
    expect(JSON.stringify(summarizeMutationResult(receipt)).length).toBeLessThan(150);
  });
});
