import assert from "node:assert/strict";
import { BLOCK, planLocalFallingBlockSettlement, type BlockId } from "../client/game/index.ts";
import { readFileSync } from "node:fs";

const key = (x: number, y: number, z: number) => `${x}:${y}:${z}`;
const blocks = new Map<string, BlockId>([
  [key(2, 3, 4), BLOCK.STONE],
  [key(2, 6, 4), BLOCK.GRAVEL],
]);
const readBlock = (x: number, y: number, z: number) => blocks.get(key(x, y, z)) ?? BLOCK.AIR;
assert.deepEqual(planLocalFallingBlockSettlement(
  { x: 2, y: 6, z: 4, block: BLOCK.GRAVEL },
  BLOCK.AIR,
  readBlock,
), [
  { x: 2, y: 4, z: 4, block: BLOCK.GRAVEL },
  { x: 2, y: 6, z: 4, block: BLOCK.AIR },
]);

const server = readFileSync(new URL("../server/index.ts", import.meta.url), "utf8");
const mutation = server.slice(server.indexOf("editWorldBlock: mutation(async"), server.indexOf("startPresenceSession: mutation("));
assert.match(mutation, /resolveFallingBlocks\(/, "Lakebed derives falling edits inside the existing idempotent block mutation");
assert.match(mutation, /sampleWorldChunkSnapshot\(chunkKey, chunkRow\.snapshotJson, fallingCoordinates\)/,
  "falling authority reads the compact same-column chunk snapshot without a new query");
assert.match(mutation, /applyWorldChunkEdits\(chunkKey, chunkRow\.snapshotJson, authoritativeWorldEdits\)/,
  "the trigger and falling edits commit under one chunk revision");
assert.match(mutation, /settledEdits,/, "the exact receipt returns bounded settlement for immediate client reconciliation");
assert.doesNotMatch(mutation, /setTimeout|setInterval/, "falling blocks cannot add background server traffic");

const client = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");
assert.match(client, /for \(const settled of result\.settledEdits\)/,
  "multiplayer applies Lakebed-confirmed settlement rather than predicting extra writes");
const offline = readFileSync(new URL("../client/singleplayer/SinglePlayerApp.tsx", import.meta.url), "utf8");
const engine = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");
assert.match(offline, /acceptWorldEdits: acceptLocalWorldEdits/, "offline mode reserves the complete local edit batch");
assert.match(engine, /planLocalFallingBlockSettlement\([\s\S]*?options\.acceptWorldEdits\?\.\(batch\)/,
  "offline primary and falling edits share one pre-mutation capacity boundary");

console.log("lakecraft falling-block client/server integration tests: ok");
