import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BLOCK_TYPES, isBlockType } from "../shared/protocol.ts";
import { INVENTORY_SIZE, type Inventory } from "../shared/game.ts";
import { parseWorldBlockOperation, placedWorldBlockForItem, resolveWorldBlockOperation } from "../shared/worldBlockOperations.ts";
import {
  ENGINE_TO_GAME,
  ENGINE_TO_PROTOCOL,
  ITEM_TO_ENGINE,
  audioSurfaceForBlock,
} from "../client/game/blockBridge.ts";
import { BLOCK as ENGINE_BLOCK } from "../client/game/types.ts";

assert.equal(BLOCK_TYPES.indexOf("wool"), 24, "the protocol appends wool without renumbering deployed blocks");
assert.equal(isBlockType("wool"), true);
assert.equal(placedWorldBlockForItem("wool"), "wool");

const inventory: Inventory = Array.from({ length: INVENTORY_SIZE }, () => null);
inventory[0] = { itemId: "wool", count: 2 };
const placeRequest = {
  operationId: "wool_place_path_0001",
  kind: "place",
  x: 17,
  y: 20,
  z: -9,
  expectedBlock: "air",
  placedBlock: "wool",
  selectedHotbar: 0,
  expectedHeldItem: "wool",
  expectedInventoryRevision: "2",
  expectedChunkRevision: "5",
} as const;
assert.equal(parseWorldBlockOperation(placeRequest).ok, true, "the authoritative request parser accepts wool placement");
const placed = resolveWorldBlockOperation(placeRequest, {
  currentBlock: "air",
  inventory,
  inventoryRevision: "2",
  chunkRevision: "5",
});
assert.equal(placed.ok, true);
if (!placed.ok) throw new Error("wool placement fixture must resolve");
assert.equal(placed.effect.nextBlock, "wool");
assert.deepEqual(placed.effect.inventory[0], { itemId: "wool", count: 1 }, "placement conserves exactly one wool item");

const mineRequest = {
  operationId: "wool_mine_path_00001",
  kind: "mine",
  x: 17,
  y: 20,
  z: -9,
  expectedBlock: "wool",
  selectedHotbar: 1,
  expectedHeldItem: null,
  expectedInventoryRevision: placed.effect.inventoryRevision,
  expectedChunkRevision: placed.effect.chunkRevision,
} as const;
assert.equal(parseWorldBlockOperation(mineRequest).ok, true, "the authoritative request parser accepts wool mining");
const mined = resolveWorldBlockOperation(mineRequest, {
  currentBlock: "wool",
  inventory: placed.effect.inventory,
  inventoryRevision: placed.effect.inventoryRevision,
  chunkRevision: placed.effect.chunkRevision,
});
assert.equal(mined.ok, true);
if (!mined.ok) throw new Error("wool mining fixture must resolve");
assert.equal(mined.effect.nextBlock, "air");
assert.deepEqual(mined.effect.drop, { itemId: "wool", count: 1 });
assert.deepEqual(mined.effect.inventory[0], { itemId: "wool", count: 2 }, "mining returns the placed wool through the normal drop path");

const client = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");
const single = readFileSync(new URL("../client/singleplayer/SinglePlayerApp.tsx", import.meta.url), "utf8");
const singleSave = readFileSync(new URL("../client/singleplayer/localSave.ts", import.meta.url), "utf8");
const server = readFileSync(new URL("../server/index.ts", import.meta.url), "utf8");
for (const [label, source] of [["multiplayer", client], ["single-player", single]] as const) {
  assert.doesNotMatch(source, /(?:setInterval|setTimeout|useMutation)[^\n]*wool|wool[^\n]*(?:setInterval|setTimeout|useMutation)/i,
    `${label} wool placement adds no dedicated network or timer loop`);
}
assert.equal(ENGINE_TO_PROTOCOL[ENGINE_BLOCK.WOOL], "wool", "multiplayer maps engine wool to protocol wool");
assert.equal(ENGINE_TO_GAME[ENGINE_BLOCK.WOOL], "wool", "both clients map engine wool to the shared item identity");
assert.equal(ITEM_TO_ENGINE.wool, ENGINE_BLOCK.WOOL, "both clients map held wool into engine block 24");
assert.equal(audioSurfaceForBlock(ENGINE_BLOCK.WOOL), "grass", "soft wool uses the cloth-like grass audio surface");
assert.match(singleSave, /candidate\.block, BLOCK\.AIR, BLOCK\.BRICKS/, "single-player saves retain wool and every newer append-only block ID");
assert.match(single, /action:\s*"break"[\s\S]*?audioSurfaceForBlock\(edit\.block\)/, "local edits emit bounded break/place particles and material audio");

const editMutation = server.slice(server.indexOf("editWorldBlock: mutation(async"), server.indexOf("sleepVote: mutation(async"));
assert.ok(editMutation.includes("parseWorldBlockOperation(rawRequest)"));
assert.ok(editMutation.includes("resolveWorldBlockOperation(request"));
assert.ok(editMutation.includes("blockType: effect.nextBlock"));
assert.match(server, /const PLACEABLE_BLOCKS = new Set<string>\(BLOCK_TYPES\.filter\(\(block\) => block !== "air" && block !== "bedrock"\)\)/,
  "Lakebed derives its placeable catalog from the shared protocol, including wool");
assert.doesNotMatch(editMutation, /setInterval|setTimeout|fetch\(/, "wool uses the existing discrete exact-once world mutation without another backend loop");

console.log("wool block client/Lakebed placement, mining, drop, save, audio, and particle wiring tests passed");
