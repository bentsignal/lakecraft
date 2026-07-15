import assert from "node:assert/strict";
import {
  APPLE_DROP_CHANCE_DENOMINATOR,
  SAPLING_DROP_CHANCE_DENOMINATOR,
  countItem,
  createEmptyInventory,
  createItemStack,
  getDeterministicMiningDrop,
} from "../shared/game.ts";
import { resolveWorldBlockOperation } from "../shared/worldBlockOperations.ts";

assert.equal(APPLE_DROP_CHANCE_DENOMINATOR, 200, "oak leaves use Minecraft's one-in-two-hundred apple rule");
assert.equal(SAPLING_DROP_CHANCE_DENOMINATOR, 20, "oak leaves use Minecraft's one-in-twenty sapling rule");
assert.doesNotMatch(
  getDeterministicMiningDrop.toString(),
  /Math\.random/,
  "leaf loot must never depend on client-local randomness",
);

const coordinates = Array.from({ length: 2_000 }, (_, index) => ({ x: index - 1_000, y: 64, z: 17 }));
const handDrops = coordinates.map(({ x, y, z }) => getDeterministicMiningDrop("leaves", null, x, y, z)?.itemId ?? null);
const repeated = coordinates.map(({ x, y, z }) => getDeterministicMiningDrop("leaves", null, x, y, z)?.itemId ?? null);
assert.deepEqual(repeated, handDrops, "the same leaf coordinates replay byte-for-byte deterministically");

const appleCount = handDrops.filter((drop) => drop === "apple").length;
assert.ok(
  appleCount >= 3 && appleCount <= 18,
  `coordinate-derived apple distribution ${appleCount}/2000 escaped the one-in-two-hundred budget`,
);
const saplingCount = handDrops.filter((drop) => drop === "sapling").length;
assert.ok(
  saplingCount >= 65 && saplingCount <= 135,
  `coordinate-derived sapling distribution ${saplingCount}/2000 escaped the one-in-twenty budget`,
);
assert.ok(handDrops.some((drop) => drop === null), "most leaves conserve loot by dropping nothing");
assert.ok(handDrops.every((drop) => drop === null || drop === "apple" || drop === "sapling"), "bare leaves resolve at most one renewable drop");

for (const held of ["wooden_axe", "diamond_sword"] as const) {
  assert.deepEqual(
    coordinates.map(({ x, y, z }) => getDeterministicMiningDrop("leaves", held, x, y, z)?.itemId ?? null),
    handDrops,
    `${held} follows the same shared coordinate authority as bare hands`,
  );
}

for (const { x, y, z } of coordinates.slice(0, 80)) {
  assert.deepEqual(
    getDeterministicMiningDrop("leaves", "shears", x, y, z),
    { itemId: "leaves", count: 1 },
    "shears conserve exactly one leaf block regardless of the apple roll",
  );
}

const appleIndex = handDrops.findIndex((drop) => drop === "apple");
assert.notEqual(appleIndex, -1);
const appleCoordinate = coordinates[appleIndex]!;
const appleRequest = {
  operationId: "leaf_apple_mine_0001",
  kind: "mine",
  ...appleCoordinate,
  expectedBlock: "leaves",
  selectedHotbar: 0,
  expectedHeldItem: null,
  expectedInventoryRevision: "0",
  expectedChunkRevision: "0",
} as const;
const emptyBefore = createEmptyInventory();
const appleResolution = resolveWorldBlockOperation(appleRequest, {
  currentBlock: "leaves",
  inventory: emptyBefore,
  inventoryRevision: "0",
  chunkRevision: "0",
});
assert.equal(appleResolution.ok, true);
if (appleResolution.ok) {
  assert.deepEqual(
    appleResolution.effect.drop,
    getDeterministicMiningDrop("leaves", null, appleCoordinate.x, appleCoordinate.y, appleCoordinate.z),
    "world-operation authority and offline mining resolve the same apple result",
  );
  assert.equal(countItem(appleResolution.effect.inventory, "apple"), 1, "one broken leaf mints at most one apple");
  assert.equal(countItem(appleResolution.effect.inventory, "leaves"), 0);
  assert.deepEqual(resolveWorldBlockOperation(appleRequest, {
    currentBlock: appleResolution.effect.nextBlock,
    inventory: appleResolution.effect.inventory,
    inventoryRevision: appleResolution.effect.inventoryRevision,
    chunkRevision: appleResolution.effect.chunkRevision,
  }), { ok: false, reason: "stale_chunk_revision" }, "the same leaf operation cannot mint a second apple");
}
assert.deepEqual(emptyBefore, createEmptyInventory(), "authoritative apple resolution does not mutate input state");

const shearsInventory = createEmptyInventory();
shearsInventory[0] = createItemStack("shears");
const shearsBefore = structuredClone(shearsInventory);
const shearsResolution = resolveWorldBlockOperation({
  operationId: "leaf_shears_mine_001",
  kind: "mine",
  x: appleCoordinate.x,
  y: appleCoordinate.y,
  z: appleCoordinate.z + 1,
  expectedBlock: "leaves",
  selectedHotbar: 0,
  expectedHeldItem: "shears",
  expectedInventoryRevision: "4",
  expectedChunkRevision: "9",
}, {
  currentBlock: "leaves",
  inventory: shearsInventory,
  inventoryRevision: "4",
  chunkRevision: "9",
});
assert.equal(shearsResolution.ok, true);
if (shearsResolution.ok) {
  assert.deepEqual(shearsResolution.effect.drop, { itemId: "leaves", count: 1 });
  assert.equal(countItem(shearsResolution.effect.inventory, "leaves"), 1, "one sheared leaf creates exactly one leaf item");
  assert.equal(countItem(shearsResolution.effect.inventory, "apple"), 0, "shearing never also rolls an apple");
}
assert.deepEqual(shearsInventory, shearsBefore, "authoritative shearing does not mutate input state");

console.log("deterministic oak-leaf apple/shears authority and conservation tests passed");
