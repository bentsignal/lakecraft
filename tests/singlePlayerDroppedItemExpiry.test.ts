import assert from "node:assert/strict";
import type { DroppedItemRenderItem } from "../client/game/droppedItemRenderer.ts";
import {
  collectLocalDroppedItems,
  pruneExpiredLocalDroppedItems,
} from "../client/singleplayer/localDroppedItems.ts";
import { SINGLEPLAYER_SAVE_LIMITS } from "../client/singleplayer/localSave.ts";
import { DROPPED_ITEM_TTL_MS } from "../shared/droppedItems.ts";
import { createEmptyInventory } from "../shared/game.ts";

const now = 1_000_000;
const expiredBeforeBoundary: DroppedItemRenderItem = {
  dropId: "expired-before-boundary",
  item: { itemId: "diamond", count: 3 },
  x: 1,
  y: 2,
  z: 3,
  droppedAt: now - DROPPED_ITEM_TTL_MS - 1,
};
const survivorAtLastMillisecond: DroppedItemRenderItem = {
  dropId: "survivor-last-millisecond",
  item: { itemId: "iron_pickaxe", count: 1, durability: 137 },
  x: -4.25,
  y: 18.5,
  z: 7.75,
  droppedAt: now - DROPPED_ITEM_TTL_MS + 1,
};
const expiredAtBoundary: DroppedItemRenderItem = {
  dropId: "expired-at-boundary",
  item: { itemId: "coal", count: 12 },
  x: 9,
  y: 10,
  z: 11,
  droppedAt: now - DROPPED_ITEM_TTL_MS,
};
const futureSurvivor: DroppedItemRenderItem = {
  dropId: "future-survivor",
  item: { itemId: "apple", count: 2 },
  x: 12,
  y: 13,
  z: 14,
  droppedAt: now + 25,
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

const saturatedStalePool = Array.from(
  { length: SINGLEPLAYER_SAVE_LIMITS.drops },
  (_, index): DroppedItemRenderItem => ({
    dropId: `stale-${index}`,
    item: { itemId: "stone", count: 1 },
    x: index,
    y: 4,
    z: 0,
    droppedAt: now - DROPPED_ITEM_TTL_MS,
  }),
);
const recovered = pruneExpiredLocalDroppedItems(saturatedStalePool, now);
assert.equal(recovered.removed, SINGLEPLAYER_SAVE_LIMITS.drops, "every stale row is accounted for");
assert.equal(recovered.drops.length, 0, "a fully stale 512-row pool recovers all local drop capacity");

console.log("lakecraft single-player dropped-item expiry tests: ok");
