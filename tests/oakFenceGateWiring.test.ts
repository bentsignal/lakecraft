import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { INVENTORY_SIZE, type Inventory } from "../shared/game.ts";
import {
  gameBlockForWorldBlock,
  parseWorldBlockOperation,
  placedWorldBlockForItem,
  resolveWorldBlockOperation,
} from "../shared/worldBlockOperations.ts";
import {
  decodeWorldBlockOperationReceipt,
  encodeWorldBlockOperationReceipt,
  type WorldBlockOperationReceiptResult,
} from "../server/worldBlockOperationReceipts.ts";

const inventory: Inventory = Array.from({ length: INVENTORY_SIZE }, () => null);
inventory[0] = { itemId: "oak_fence_gate", count: 2 };
assert.equal(placedWorldBlockForItem("oak_fence_gate"), "oak_fence_gate_closed");
assert.equal(gameBlockForWorldBlock("oak_fence_gate_closed"), "oak_fence_gate");
assert.equal(gameBlockForWorldBlock("oak_fence_gate_open"), "oak_fence_gate");

const placed = resolveWorldBlockOperation({
  operationId: "oak_gate_place_0001",
  kind: "place",
  x: 21,
  y: 11,
  z: -14,
  expectedBlock: "air",
  placedBlock: "oak_fence_gate_closed",
  selectedHotbar: 0,
  expectedHeldItem: "oak_fence_gate",
  expectedInventoryRevision: "7",
  expectedChunkRevision: "12",
}, { currentBlock: "air", inventory, inventoryRevision: "7", chunkRevision: "12" });
assert.equal(placed.ok, true);
if (!placed.ok) throw new Error("gate placement fixture must resolve");
assert.equal(placed.effect.nextBlock, "oak_fence_gate_closed");
assert.deepEqual(placed.effect.inventory[0], { itemId: "oak_fence_gate", count: 1 });

const openRequest = {
  operationId: "oak_gate_toggle_0001",
  kind: "toggle",
  x: 21,
  y: 11,
  z: -14,
  expectedBlock: "oak_fence_gate_closed",
  expectedChunkRevision: placed.effect.chunkRevision,
} as const;
assert.equal(parseWorldBlockOperation(openRequest).ok, true);
const opened = resolveWorldBlockOperation(openRequest, {
  currentBlock: "oak_fence_gate_closed",
  inventory: placed.effect.inventory,
  inventoryRevision: placed.effect.inventoryRevision,
  chunkRevision: placed.effect.chunkRevision,
});
assert.equal(opened.ok, true);
if (!opened.ok) throw new Error("gate open fixture must resolve");
assert.equal(opened.effect.nextBlock, "oak_fence_gate_open");
assert.equal(opened.effect.inventoryChanged, false);
assert.equal(opened.effect.inventoryRevision, placed.effect.inventoryRevision,
  "toggling a gate cannot spend or rewrite inventory");

const receipt: WorldBlockOperationReceiptResult = {
  ok: true,
  replayed: false,
  operationId: openRequest.operationId,
  kind: "toggle",
  x: openRequest.x,
  y: openRequest.y,
  z: openRequest.z,
  previousBlock: opened.effect.previousBlock,
  nextBlock: opened.effect.nextBlock,
  inventoryRevision: opened.effect.inventoryRevision,
  chunkKey: "1:-1",
  chunkRevision: opened.effect.chunkRevision,
  inventoryChanged: false,
  drop: null,
  consumed: null,
  toolUse: null,
  settledEdits: [],
};
assert.deepEqual(decodeWorldBlockOperationReceipt(encodeWorldBlockOperationReceipt(receipt)), {
  ...receipt,
  replayed: true,
}, "an exact Lakebed retry replays the closed-to-open result without applying it again");

const closed = resolveWorldBlockOperation({
  ...openRequest,
  operationId: "oak_gate_toggle_0002",
  expectedBlock: "oak_fence_gate_open",
  expectedChunkRevision: opened.effect.chunkRevision,
}, {
  currentBlock: "oak_fence_gate_open",
  inventory: opened.effect.inventory,
  inventoryRevision: opened.effect.inventoryRevision,
  chunkRevision: opened.effect.chunkRevision,
});
assert.equal(closed.ok, true);
if (closed.ok) assert.equal(closed.effect.nextBlock, "oak_fence_gate_closed");

const minedOpen = resolveWorldBlockOperation({
  operationId: "oak_gate_mine_open_1",
  kind: "mine",
  x: 21,
  y: 11,
  z: -14,
  expectedBlock: "oak_fence_gate_open",
  selectedHotbar: 1,
  expectedHeldItem: null,
  expectedInventoryRevision: opened.effect.inventoryRevision,
  expectedChunkRevision: opened.effect.chunkRevision,
}, {
  currentBlock: "oak_fence_gate_open",
  inventory: opened.effect.inventory,
  inventoryRevision: opened.effect.inventoryRevision,
  chunkRevision: opened.effect.chunkRevision,
});
assert.equal(minedOpen.ok, true);
if (minedOpen.ok) assert.deepEqual(minedOpen.effect.drop, { itemId: "oak_fence_gate", count: 1 },
  "mining either gate state self-drops the one canonical gate item");

const client = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");
const local = readFileSync(new URL("../client/singleplayer/SinglePlayerApp.tsx", import.meta.url), "utf8");
const requestClient = readFileSync(new URL("../client/worldBlockEditClient.ts", import.meta.url), "utf8");
const server = readFileSync(new URL("../server/index.ts", import.meta.url), "utf8");

for (const [label, source] of [["multiplayer", client], ["single-player", local]] as const) {
  assert.match(source, /\[BLOCK\.OAK_FENCE_GATE_CLOSED\]:\s*"oak_fence_gate"/,
    `${label} maps the closed state to the canonical game block`);
  assert.match(source, /\[BLOCK\.OAK_FENCE_GATE_OPEN\]:\s*"oak_fence_gate"/,
    `${label} maps the open state to the same canonical game block`);
  assert.match(source, /oak_fence_gate:\s*BLOCK\.OAK_FENCE_GATE_CLOSED/,
    `${label} always places a held gate closed`);
  assert.match(source, /BLOCK\.OAK_FENCE_GATE_CLOSED[^\n]*BLOCK\.OAK_FENCE_GATE_OPEN[^\n]*return\s+"wood"/,
    `${label} gives both states wood interaction audio`);
}
assert.match(client, /\[BLOCK\.OAK_FENCE_GATE_CLOSED\]:\s*"oak_fence_gate_closed"/);
assert.match(client, /\[BLOCK\.OAK_FENCE_GATE_OPEN\]:\s*"oak_fence_gate_open"/);
assert.match(client, /oak_fence_gate_closed:\s*BLOCK\.OAK_FENCE_GATE_CLOSED/);
assert.match(client, /oak_fence_gate_open:\s*BLOCK\.OAK_FENCE_GATE_OPEN/);
assert.match(client, /onBlockEdit:\s*\(edit, previousBlock\)[\s\S]{0,140}handleBlockEdit\(edit, previousBlock\)/,
  "multiplayer preserves the prior state needed to serialize a toggle safely");
assert.match(client, /next === BLOCK\.DOOR_OPEN \|\| next === BLOCK\.OAK_FENCE_GATE_OPEN/,
  "confirmed gate opens and closes reuse direction-specific wood sounds");
assert.match(local, /edit\.block\s*<=\s*BLOCK\.STONE_BRICK_SLAB/,
  "single-player saves retain both append-only gate states");
assert.match(local,
  /previousBlock === BLOCK\.OAK_FENCE_GATE_CLOSED && edit\.block === BLOCK\.OAK_FENCE_GATE_OPEN[\s\S]{0,160}previousBlock === BLOCK\.OAK_FENCE_GATE_OPEN && edit\.block === BLOCK\.OAK_FENCE_GATE_CLOSED/,
  "local right-click toggles skip mining and placement inventory effects in both directions");
assert.match(requestClient, /isToggleableWorldBlock\(input\.previousBlock\)[\s\S]{0,220}toggledWorldBlock\(previousToggle\) === input\.nextBlock/,
  "the client only serializes a matched shared toggle pair");

const mutation = server.slice(server.indexOf("editWorldBlock: mutation(async"), server.indexOf("startPresenceSession: mutation("));
assert.ok(mutation.indexOf("ctx.db.worldBlockOperationReceipts") < mutation.indexOf("ctx.db.playerPresence"),
  "exact replay returns before mutable pose, inventory, chunk, or edit reads");
assert.ok(mutation.includes("resolveWorldBlockOperation(request"));
assert.ok(mutation.includes("blockType: effect.nextBlock"));
assert.ok(mutation.indexOf("worldChunks.update") < mutation.indexOf("worldBlockOperationReceipts.insert"),
  "the existing transaction commits one gate transition before its exact-once receipt");
assert.doesNotMatch(server, /oakFenceGate[^\n]*mutation|mutation[^\n]*oakFenceGate/i,
  "gate interaction adds no dedicated Lakebed mutation");
assert.match(server, /block === "door_open" \|\| block === "oak_fence_gate_open"\) return false/,
  "authoritative ranged collision lets projectiles pass through an open gate");
assert.match(server, /oak_fence_gate_closed" \|\| block === "oak_fence_gate_open"\) return "oak_fence_gate"/,
  "tree-growth authority treats both gate states as occupied canonical blocks");
assert.doesNotMatch(mutation, /setInterval|setTimeout|fetch\(/,
  "gate toggles remain discrete user-driven Lakebed writes with no polling or alternate backend");

console.log("oak fence gate multiplayer/local mapping, toggle, exact replay, self-drop, audio, save, and server collision tests passed");
