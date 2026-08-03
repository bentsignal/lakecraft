import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { readFileSync } from "node:fs";
import { BLOCK, type WorldEdit } from "../client/game/types.ts";
import {
  canCommitLocalWorldEdits,
  createLocalWorldEditIndex,
  tryCommitLocalWorldEdits,
} from "../client/singleplayer/localWorldEditJournal.ts";
import {
  SINGLEPLAYER_SAVE_LIMITS,
  createDefaultSinglePlayerSnapshot,
  loadSinglePlayerSave,
  saveSinglePlayerSnapshot,
  type SinglePlayerStorageAdapter,
} from "../client/singleplayer/localSave.ts";

const limit = SINGLEPLAYER_SAVE_LIMITS.edits;
const edits = (count: number): WorldEdit[] => Array.from({ length: count }, (_, x) => ({
  x, y: 0, z: 0, block: x % 2 ? BLOCK.DIRT : BLOCK.STONE,
}));

const index = createLocalWorldEditIndex(edits(limit - 1));
assert.equal(tryCommitLocalWorldEdits(index, [{ x: limit - 1, y: 0, z: 0, block: BLOCK.GRASS }], limit), true);
assert.equal(index.size, limit, "edit 12,000 fits exactly");

const beforeRejection = JSON.stringify([...index]);
assert.equal(tryCommitLocalWorldEdits(index, [{ x: limit, y: 0, z: 0, block: BLOCK.WOOD }], limit), false);
assert.equal(JSON.stringify([...index]), beforeRejection, "edit 12,001 rejects without touching old or new rows");
assert.equal(tryCommitLocalWorldEdits(index, [{ x: 0, y: 0, z: 0, block: BLOCK.PLANKS }], limit), true);
assert.equal(index.size, limit, "a full journal accepts an existing-coordinate overwrite");
assert.equal(index.get("0:0:0")?.block, BLOCK.PLANKS);

const duplicateBatch = createLocalWorldEditIndex(edits(limit - 1));
assert.equal(canCommitLocalWorldEdits(duplicateBatch, [
  { x: limit - 1, y: 0, z: 0, block: BLOCK.DIRT },
  { x: limit - 1, y: 0, z: 0, block: BLOCK.GRASS },
  { x: 0, y: 0, z: 0, block: BLOCK.WOOD },
], limit), true, "capacity counts distinct novel keys, not batch length");
assert.equal(tryCommitLocalWorldEdits(duplicateBatch, [
  { x: limit - 1, y: 0, z: 0, block: BLOCK.DIRT },
  { x: limit, y: 0, z: 0, block: BLOCK.WOOD },
], limit), false, "a batch crossing the boundary rejects atomically");
assert.equal(duplicateBatch.size, limit - 1);

const normalized = createLocalWorldEditIndex([]);
assert.equal(tryCommitLocalWorldEdits(normalized, [{
  x: 1, y: 2, z: 3, block: BLOCK.AIR, previousBlock: BLOCK.STONE,
} as WorldEdit], limit), true);
assert.deepEqual(normalized.get("1:2:3"), { x: 1, y: 2, z: 3, block: BLOCK.AIR },
  "explosion metadata cannot leak into the exact save schema");

class MemoryStorage implements SinglePlayerStorageAdapter {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

const storage = new MemoryStorage();
const snapshot = createDefaultSinglePlayerSnapshot(9_001, 100);
snapshot.world.edits = [...index.values()];
const saved = saveSinglePlayerSnapshot(storage, snapshot, 200);
assert.equal(saved.ok, true, "a full bounded journal remains a valid format-v1 save");
const loaded = loadSinglePlayerSave(storage);
assert.equal(loaded.status, "loaded");
if (loaded.status !== "loaded") throw new Error(loaded.status);
assert.equal(loaded.snapshot.world.edits.length, limit);
assert.equal(loaded.snapshot.world.edits.find((edit) => edit.x === 0)?.block, BLOCK.PLANKS, "oldest sentinel survives reload");
assert.equal(loaded.snapshot.world.edits.find((edit) => edit.x === limit - 1)?.block, BLOCK.GRASS, "newest sentinel survives reload");

const start = performance.now();
for (let sample = 0; sample < 50_000; sample += 1) {
  assert.equal(tryCommitLocalWorldEdits(index, [{ x: 0, y: 0, z: 0, block: sample % 2 ? BLOCK.STONE : BLOCK.DIRT }], limit), true);
}
const elapsedMs = performance.now() - start;
assert.ok(elapsedMs < 500, "single-coordinate commits stay O(1), independent of 12,000 stored edits");

const app = readFileSync(new URL("../client/singleplayer/SinglePlayerApp.tsx", import.meta.url), "utf8");
const engine = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");
const multiplayer = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");
assert.doesNotMatch(app, /slice\(-SINGLEPLAYER_SAVE_LIMITS\.edits/, "no local edit path may evict an older coordinate");
assert.match(app, /acceptWorldEdits: acceptLocalWorldEdits/, "one engine boundary owns local journal reservation");
assert.match(app, /if \(!localEngine\.applyWorldEdits\(growthEdits\)\) return true;[\s\S]*?updateInventory\(nextInventory\)/,
  "tree capacity rejects before bone meal is consumed");
assert.match(app, /id: "local-world-edit-capacity"/, "capacity feedback is stable and deduplicated");
assert.doesNotMatch(multiplayer, /acceptWorldEdits:/, "Lakebed multiplayer authority remains unchanged");

const emit = engine.slice(engine.indexOf("function emitEdit"), engine.indexOf("function onKeyDown"));
const commit = engine.slice(engine.indexOf("function commitEditBatch"), engine.indexOf("function emitEdit"));
assert.ok(emit.includes("planLocalFallingBlockSettlement"));
assert.ok(commit.indexOf("options.acceptWorldEdits?.(batch)") < commit.indexOf("rememberWorldEdit(next)"),
  "primary and falling edits reserve one exact batch before terrain changes");
for (const [startToken, endToken] of [
  ["function applyLocalExplosionEdits", "function updateMobs"],
  ["applyWorldEdits(edits)", "applyMobCombatStates"],
  ["settleFallingBlocks(edit", "setDayNightClock"],
] as const) {
  const branch = engine.slice(engine.indexOf(startToken), engine.indexOf(endToken, engine.indexOf(startToken)));
  assert.ok(branch.indexOf("acceptWorldEdits") < branch.indexOf("rememberWorldEdit"), `${startToken} reserves before mutation`);
}

console.log(JSON.stringify({ benchmark: "full single-player edit journal", storedEdits: limit, overwriteCommits: 50_000, elapsedMs: Number(elapsedMs.toFixed(2)) }));
console.log("single-player coordinate journal capacity, atomicity, persistence, performance, and source gates passed");
