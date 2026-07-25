import assert from "node:assert/strict";
import {
  CONTINUOUS_PLACEMENT_INTERVAL_MS,
  IDLE_SECONDARY_PLACEMENT_HOLD,
  advanceSecondaryPlacement,
  isContinuousPlacementBlock,
  pressSecondaryPlacement,
  releaseSecondaryPlacement,
  shouldRepeatSecondaryPlacement,
} from "../client/game/continuousPlacement.ts";
import { BLOCK } from "../client/game/types.ts";

const armed = pressSecondaryPlacement(true, BLOCK.PLANKS, 1_000);
assert.deepEqual(armed, { armed: true, lastAttemptAt: 1_000 }, "one accepted ordinary placement arms the physical hold");
assert.equal(shouldRepeatSecondaryPlacement(armed, 1_000 + CONTINUOUS_PLACEMENT_INTERVAL_MS - 1), false,
  "held placement cannot repeat before its bounded cadence");
assert.equal(shouldRepeatSecondaryPlacement(armed, 1_000 + CONTINUOUS_PLACEMENT_INTERVAL_MS), true,
  "held placement repeats exactly at the cadence boundary");
const advanced = advanceSecondaryPlacement(armed, 1_900);
assert.equal(shouldRepeatSecondaryPlacement(advanced, 2_099), false, "a late frame schedules from now instead of catching up in a burst");
assert.equal(shouldRepeatSecondaryPlacement(advanced, 2_100), true);
assert.deepEqual(pressSecondaryPlacement(false, BLOCK.PLANKS, 1_000), IDLE_SECONDARY_PLACEMENT_HOLD,
  "a rejected initial placement never arms later free placement");
assert.deepEqual(releaseSecondaryPlacement(), IDLE_SECONDARY_PLACEMENT_HOLD, "release fully disarms secondary placement");

for (const discrete of [
  BLOCK.AIR,
  BLOCK.CRAFTING_TABLE,
  BLOCK.CHEST,
  BLOCK.DOOR_CLOSED,
  BLOCK.DOOR_OPEN,
  BLOCK.BED,
  BLOCK.FURNACE,
  BLOCK.TNT,
  BLOCK.SAPLING,
  BLOCK.OAK_FENCE_GATE_CLOSED,
  BLOCK.OAK_FENCE_GATE_OPEN,
]) {
  assert.equal(isContinuousPlacementBlock(discrete), false, `block ${discrete} remains a discrete right-click action`);
  assert.deepEqual(pressSecondaryPlacement(true, discrete, 1_000), IDLE_SECONDARY_PLACEMENT_HOLD);
}
for (const ordinary of [BLOCK.DIRT, BLOCK.PLANKS, BLOCK.TORCH, BLOCK.OAK_FENCE, BLOCK.STONE_BRICK_SLAB]) {
  assert.equal(isContinuousPlacementBlock(ordinary), true, `ordinary block ${ordinary} supports held building`);
}

let remainingBlocks = 3;
let acceptedEdits = 0;
let handActions = 0;
let state = pressSecondaryPlacement(remainingBlocks > 0, BLOCK.PLANKS, 0);
if (state.armed) {
  remainingBlocks -= 1;
  acceptedEdits += 1;
  handActions += 1;
}
for (const now of [200, 400, 600, 800]) {
  assert.equal(shouldRepeatSecondaryPlacement(state, now), true);
  state = advanceSecondaryPlacement(state, now);
  if (remainingBlocks <= 0) continue;
  remainingBlocks -= 1;
  acceptedEdits += 1;
  handActions += 1;
}
assert.deepEqual({ remainingBlocks, acceptedEdits, handActions }, { remainingBlocks: 0, acceptedEdits: 3, handActions: 3 },
  "bounded repeats stop producing edits and hand actions when the selected stack can no longer pay");

console.log("continuous secondary-button placement state tests passed");
