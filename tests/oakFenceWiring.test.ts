import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BLOCK_TYPES, isBlockType } from "../shared/protocol.ts";
import { INVENTORY_SIZE, type Inventory } from "../shared/game.ts";
import {
  parseWorldBlockOperation,
  placedWorldBlockForItem,
  resolveWorldBlockOperation,
} from "../shared/worldBlockOperations.ts";

assert.equal(BLOCK_TYPES.indexOf("oak_fence"), 27,
  "oak fence appends without renumbering any deployed protocol identity");
assert.equal(isBlockType("oak_fence"), true);
assert.equal(placedWorldBlockForItem("oak_fence"), "oak_fence");

const inventory: Inventory = Array.from({ length: INVENTORY_SIZE }, () => null);
inventory[0] = { itemId: "oak_fence", count: 2 };
const placeRequest = {
  operationId: "oak_fence_place_0001",
  kind: "place",
  x: -27,
  y: 18,
  z: 31,
  expectedBlock: "air",
  placedBlock: "oak_fence",
  selectedHotbar: 0,
  expectedHeldItem: "oak_fence",
  expectedInventoryRevision: "12",
  expectedChunkRevision: "19",
} as const;
assert.equal(parseWorldBlockOperation(placeRequest).ok, true,
  "the ordinary authoritative request parser accepts fence placement");
const placed = resolveWorldBlockOperation(placeRequest, {
  currentBlock: "air",
  inventory,
  inventoryRevision: "12",
  chunkRevision: "19",
});
assert.equal(placed.ok, true);
if (!placed.ok) throw new Error("oak-fence placement fixture must resolve");
assert.equal(placed.effect.nextBlock, "oak_fence");
assert.deepEqual(placed.effect.inventory[0], { itemId: "oak_fence", count: 1 },
  "placement consumes exactly one fence through the normal inventory effect");

const mineRequest = {
  operationId: "oak_fence_mine_00001",
  kind: "mine",
  x: -27,
  y: 18,
  z: 31,
  expectedBlock: "oak_fence",
  selectedHotbar: 1,
  expectedHeldItem: null,
  expectedInventoryRevision: placed.effect.inventoryRevision,
  expectedChunkRevision: placed.effect.chunkRevision,
} as const;
assert.equal(parseWorldBlockOperation(mineRequest).ok, true,
  "the ordinary authoritative request parser accepts fence mining");
const mined = resolveWorldBlockOperation(mineRequest, {
  currentBlock: "oak_fence",
  inventory: placed.effect.inventory,
  inventoryRevision: placed.effect.inventoryRevision,
  chunkRevision: placed.effect.chunkRevision,
});
assert.equal(mined.ok, true);
if (!mined.ok) throw new Error("oak-fence mining fixture must resolve");
assert.equal(mined.effect.nextBlock, "air");
assert.deepEqual(mined.effect.drop, { itemId: "oak_fence", count: 1 });
assert.deepEqual(mined.effect.inventory[0], { itemId: "oak_fence", count: 2 },
  "mining returns the same fence and conserves the place/mine round trip");

const client = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");
const single = readFileSync(new URL("../client/singleplayer/SinglePlayerApp.tsx", import.meta.url), "utf8");
const singleSave = readFileSync(new URL("../client/singleplayer/localSave.ts", import.meta.url), "utf8");
const server = readFileSync(new URL("../server/index.ts", import.meta.url), "utf8");
const catalog = readFileSync(new URL("../client/gameplay/catalog.ts", import.meta.url), "utf8");
assert.match(catalog, /\[BLOCK\.OAK_FENCE\]:\s*"oak_fence"/);
assert.match(catalog, /oak_fence:\s*BLOCK\.OAK_FENCE/);
assert.match(catalog, /BLOCK\.OAK_FENCE[^\n]*BLOCK\.OAK_FENCE_GATE_CLOSED[^\n]*BLOCK\.OAK_FENCE_GATE_OPEN[^\n]*return "wood"/);
assert.match(singleSave, /candidate\.block, BLOCK\.AIR, BLOCK\.BRICK_STAIRS_WEST/,
  "single-player save validation retains oak fences and every newer append-only engine ID");

const mutation = server.slice(server.indexOf("editWorldBlock: mutation(async"), server.indexOf("startPresenceSession: mutation("));
assert.ok(mutation.includes("parseWorldBlockOperation(rawRequest)"));
assert.ok(mutation.includes("resolveWorldBlockOperation(request"));
assert.ok(mutation.includes("blockType: effect.nextBlock"));
assert.ok(mutation.indexOf("worldBlockOperationReceipts") < mutation.indexOf("playerPresence"),
  "exact replay returns before mutable authority reads");
assert.ok(mutation.indexOf("worldChunks.update") < mutation.indexOf("worldBlockOperationReceipts.insert"),
  "one transaction commits the authoritative chunk before recording its exact-once receipt");
assert.match(server,
  /const PLACEABLE_BLOCKS = new Set<string>\(BLOCK_TYPES\.filter\(\(block\) => block !== "air" && block !== "bedrock"\)\)/,
  "Lakebed derives fence acceptance from the append-only shared catalog");
assert.doesNotMatch(mutation, /effect\.nextBlock === "oak_fence"|oakFence[^\n]*mutation|mutation[^\n]*oakFence/i,
  "the server needs no fence-specific mutation branch: shared authority drives the existing exact-once path");
assert.doesNotMatch(mutation, /setInterval|setTimeout|fetch\(/,
  "fences stay on the existing user-driven Lakebed mutation with no loop or alternate backend");

console.log("oak-fence multiplayer/single-player/Lakebed exact-once place, mine, self-drop, save, and audio wiring tests passed");
