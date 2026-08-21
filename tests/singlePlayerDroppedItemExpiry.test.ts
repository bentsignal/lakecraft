import assert from "node:assert/strict";
import type { LocalDroppedItem } from "../client/singleplayer/localDropGravity.ts";
import {
  collectLocalDroppedItems,
  pruneExpiredLocalDroppedItems,
} from "../client/singleplayer/localDroppedItems.ts";
import { SINGLEPLAYER_SAVE_LIMITS } from "../client/singleplayer/localSave.ts";
import {
  DROPPED_ITEM_ATTRACTION_MS,
  DROPPED_ITEM_PICKUP_DELAY_MS,
  DROPPED_ITEM_TTL_MS,
} from "../shared/droppedItems.ts";
import { createEmptyInventory } from "../shared/game.ts";

const now = 1_000_000;
const expiredBeforeBoundary: LocalDroppedItem = {
  dropId: "expired-before-boundary",
  item: { itemId: "diamond", count: 3 },
  x: 1,
  y: 2,
  z: 3,
  droppedAt: now - DROPPED_ITEM_TTL_MS - 1,
  velocityY: 0,
  settled: true,
};
const survivorAtLastMillisecond: LocalDroppedItem = {
  dropId: "survivor-last-millisecond",
  item: { itemId: "iron_pickaxe", count: 1, durability: 137 },
  x: -4.25,
  y: 18.5,
  z: 7.75,
  droppedAt: now - DROPPED_ITEM_TTL_MS + 1,
  velocityY: -2,
  settled: false,
};
const expiredAtBoundary: LocalDroppedItem = {
  dropId: "expired-at-boundary",
  item: { itemId: "coal", count: 12 },
  x: 9,
  y: 10,
  z: 11,
  droppedAt: now - DROPPED_ITEM_TTL_MS,
  velocityY: 0,
  settled: true,
};
const futureSurvivor: LocalDroppedItem = {
  dropId: "future-survivor",
  item: { itemId: "apple", count: 2 },
  x: 12,
  y: 13,
  z: 14,
  droppedAt: now + 25,
  velocityY: 0,
  settled: true,
};
const mixed = [expiredBeforeBoundary, survivorAtLastMillisecond, expiredAtBoundary, futureSurvivor];
const mixedSnapshot = structuredClone(mixed);

const pruned = pruneExpiredLocalDroppedItems(mixed, now);
assert.equal(pruned.removed, 2, "drops expire at, and only at, the exact shared TTL boundary");
assert.deepEqual(pruned.drops, [survivorAtLastMillisecond, futureSurvivor], "survivor order and complete metadata stay exact");
assert.equal(pruned.drops[0], survivorAtLastMillisecond, "survivors retain object identity");
assert.equal(pruned.drops[1], futureSurvivor, "later survivors retain object identity");
assert.deepEqual(mixed, mixedSnapshot, "pruning is pure and never mutates its input");

const unchanged = [survivorAtLastMillisecond, futureSurvivor];
const noOp = pruneExpiredLocalDroppedItems(unchanged, now);
assert.equal(noOp.removed, 0);
assert.equal(noOp.drops, unchanged, "the no-expiry path returns the original bounded pool without allocation");

const emptyInventory = createEmptyInventory();
const pickupAfterExpiry = collectLocalDroppedItems(emptyInventory, pruned.drops, {
  x: expiredAtBoundary.x,
  y: expiredAtBoundary.y,
  z: expiredAtBoundary.z,
});
assert.deepEqual(pickupAfterExpiry.inventory, emptyInventory, "expiry cannot mint removed items into inventory");

const manualToss: LocalDroppedItem = {
  dropId: "manual-toss",
  item: { itemId: "dirt", count: 1 },
  x: 0,
  y: 1,
  z: 0,
  droppedAt: now,
  velocityY: 0,
  settled: true,
};
const tooEarly = collectLocalDroppedItems(emptyInventory, [manualToss], { x: 0, y: 1, z: 0 }, undefined,
  now + DROPPED_ITEM_PICKUP_DELAY_MS - 1);
assert.equal(tooEarly.drops.length, 1, "the simple pickup timer blocks a stationary owner before its deadline");
const stationaryOwner = collectLocalDroppedItems(emptyInventory, tooEarly.drops, { x: 0, y: 1, z: 0 }, undefined,
  now + DROPPED_ITEM_PICKUP_DELAY_MS);
assert.equal(stationaryOwner.drops.length, 0, "the owner can collect in place at the exact deadline");
assert.equal(stationaryOwner.inventory[0]?.itemId, "dirt");
const attractionTimes = new Map<string, number>();
const attractionStart = now + DROPPED_ITEM_PICKUP_DELAY_MS;
const flying = collectLocalDroppedItems(emptyInventory, [manualToss], { x: 0, y: 1, z: 0 }, undefined,
  attractionStart, attractionTimes);
assert.equal(flying.drops.length, 1, "pickup retains the world entity during its visible magnet flight");
const attracted = collectLocalDroppedItems(emptyInventory, flying.drops, { x: 0, y: 1, z: 0 }, undefined,
  attractionStart + DROPPED_ITEM_ATTRACTION_MS, attractionTimes);
assert.equal(attracted.drops.length, 0, "inventory credit lands at the end of the magnet flight");

const saturatedStalePool = Array.from(
  { length: SINGLEPLAYER_SAVE_LIMITS.drops },
  (_, index): LocalDroppedItem => ({
    dropId: `stale-${index}`,
    item: { itemId: "stone", count: 1 },
    x: index,
    y: 4,
    z: 0,
    droppedAt: now - DROPPED_ITEM_TTL_MS,
    velocityY: 0,
    settled: true,
  }),
);
const recovered = pruneExpiredLocalDroppedItems(saturatedStalePool, now);
assert.equal(recovered.removed, SINGLEPLAYER_SAVE_LIMITS.drops, "every stale row is accounted for");
assert.equal(recovered.drops.length, 0, "a fully stale 512-row pool recovers all local drop capacity");

console.log("lakecraft single-player dropped-item expiry tests: ok");
