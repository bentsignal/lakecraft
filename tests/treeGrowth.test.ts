import assert from "node:assert/strict";
import type { BlockId } from "../shared/game.ts";
import {
  OAK_TREE_MAX_EDITS,
  OAK_TREE_MAX_PROBE_CELLS,
  oakTreeGrowthProbeCells,
  oakTreeTrunkHeight,
  planOakTreeGrowth,
} from "../shared/treeGrowth.ts";
import { WORLD_EDIT_MAX_Y, WORLD_EDIT_MIN_XZ } from "../shared/worldChunks.ts";

type CellBlock = BlockId | "air";
const key = (x: number, y: number, z: number) => `${x}:${y}:${z}`;
function world(overrides: Readonly<Record<string, CellBlock>> = {}) {
  const cells = new Map<string, CellBlock>(Object.entries(overrides));
  return {
    cells,
    blockAt: (x: number, y: number, z: number): CellBlock => cells.get(key(x, y, z)) ?? "air",
  };
}

const origin = { x: 17, y: 8, z: -23 };
const base = world({
  [key(origin.x, origin.y - 1, origin.z)]: "grass",
  [key(origin.x, origin.y, origin.z)]: "sapling",
});
const before = [...base.cells.entries()];
const planned = planOakTreeGrowth({ ...origin, blockAt: base.blockAt });
assert.equal(planned.ok, true);
if (!planned.ok) throw new Error(planned.reason);
assert.deepEqual([...base.cells.entries()], before, "the pure planner never mutates supplied world facts");
assert.ok(planned.edits.length > 50 && planned.edits.length <= OAK_TREE_MAX_EDITS);
assert.equal(new Set(planned.edits.map(({ x, y, z }) => key(x, y, z))).size, planned.edits.length);
const height = oakTreeTrunkHeight(origin.x, origin.y, origin.z);
assert.equal(planned.edits.filter(({ block }) => block === "log").length, height);
for (let offset = 0; offset < height; offset += 1) {
  assert.deepEqual(planned.edits.find(({ x, y, z }) => x === origin.x && y === origin.y + offset && z === origin.z), {
    x: origin.x,
    y: origin.y + offset,
    z: origin.z,
    block: "log",
  });
}
assert.ok(planned.edits.some(({ block }) => block === "leaves"));
assert.deepEqual(planOakTreeGrowth({ ...origin, blockAt: base.blockAt }), planned, "identical facts replay byte-for-byte");

const probes = oakTreeGrowthProbeCells(origin.x, origin.y, origin.z);
assert.equal(probes.length, planned.edits.length + 1, "the bounded probe includes support plus every edited cell");
assert.ok(probes.length <= OAK_TREE_MAX_PROBE_CELLS);
assert.deepEqual(probes[0], { x: origin.x, y: origin.y - 1, z: origin.z });

const existingCanopy = planned.edits.find(({ block, x, z }) => block === "leaves" && (x !== origin.x || z !== origin.z))!;
const touchingLeaves = world({
  [key(origin.x, origin.y - 1, origin.z)]: "dirt",
  [key(origin.x, origin.y, origin.z)]: "sapling",
  [key(existingCanopy.x, existingCanopy.y, existingCanopy.z)]: "leaves",
});
assert.equal(planOakTreeGrowth({ ...origin, blockAt: touchingLeaves.blockAt }).ok, true, "oak can merge into an existing leaf canopy");

const blocked = world({
  [key(origin.x, origin.y - 1, origin.z)]: "grass",
  [key(origin.x, origin.y, origin.z)]: "sapling",
  [key(existingCanopy.x, existingCanopy.y, existingCanopy.z)]: "stone",
});
assert.deepEqual(planOakTreeGrowth({ ...origin, blockAt: blocked.blockAt }), { ok: false, reason: "blocked" });
const unsupported = world({ [key(origin.x, origin.y, origin.z)]: "sapling" });
assert.deepEqual(planOakTreeGrowth({ ...origin, blockAt: unsupported.blockAt }), { ok: false, reason: "invalid_support" });
const missing = world({ [key(origin.x, origin.y - 1, origin.z)]: "grass" });
assert.deepEqual(planOakTreeGrowth({ ...origin, blockAt: missing.blockAt }), { ok: false, reason: "not_sapling" });
assert.deepEqual(planOakTreeGrowth({ x: Number.NaN, y: 8, z: 0, blockAt: base.blockAt }), { ok: false, reason: "invalid_coordinate" });
assert.deepEqual(planOakTreeGrowth({ x: WORLD_EDIT_MIN_XZ - 1, y: 8, z: 0, blockAt: base.blockAt }), { ok: false, reason: "invalid_coordinate" });
assert.deepEqual(planOakTreeGrowth({ x: 0, y: WORLD_EDIT_MAX_Y, z: 0, blockAt: base.blockAt }), { ok: false, reason: "invalid_coordinate" });

const heights = new Set(Array.from({ length: 64 }, (_, x) => oakTreeTrunkHeight(x - 32, 8, 11)));
assert.deepEqual([...heights].sort(), [4, 5], "the deterministic oak family includes four- and five-log trunks");

console.log(JSON.stringify({ edits: planned.edits.length, probes: probes.length, height }));
console.log("Task 77 bounded deterministic oak growth planner tests passed");
