import assert from "node:assert/strict";
import {
  IDLE_PRIMARY_ACTION_HOLD,
  INSTANT_MINING_HOLD_INTERVAL_MS,
  pressPrimaryAction,
  releasePrimaryAction,
  shouldStartHeldMining,
} from "../client/game/continuousMining.ts";

assert.equal(INSTANT_MINING_HOLD_INTERVAL_MS, 150,
  "holding Creative mine repeats instant edits at about 6.7 blocks per second");

const ready = {
  pointerLocked: true,
  playerAlive: true,
  miningActive: false,
  targetAvailable: true,
  editAllowed: true,
  targetPrimed: false,
};

assert.equal(shouldStartHeldMining(IDLE_PRIMARY_ACTION_HOLD, ready), false, "idle input never mines");
const miningHold = pressPrimaryAction(false);
assert.equal(shouldStartHeldMining(miningHold, ready), true, "a block press arms continuous mining");
assert.equal(shouldStartHeldMining(miningHold, { ...ready, miningActive: true }), false, "one block owns the active mining timer");
assert.equal(shouldStartHeldMining(miningHold, { ...ready, targetAvailable: false }), false, "air never creates an edit");
assert.equal(shouldStartHeldMining(miningHold, { ...ready, pointerLocked: false }), false, "pointer-lock loss cancels input authority");
assert.equal(shouldStartHeldMining(miningHold, { ...ready, playerAlive: false }), false, "dead players cannot keep mining");
assert.equal(shouldStartHeldMining(miningHold, { ...ready, editAllowed: false }), false, "authority backpressure cannot be bypassed");
assert.equal(shouldStartHeldMining(miningHold, { ...ready, targetPrimed: true }), false, "primed TNT cannot be mined out of its fuse");

const attackHold = pressPrimaryAction(true);
assert.equal(attackHold.held, true, "the physical button remains held after one attack");
assert.equal(shouldStartHeldMining(attackHold, ready), false, "an entity attack never falls through into background block mining");
assert.deepEqual(releasePrimaryAction(), IDLE_PRIMARY_ACTION_HOLD, "release fully disarms the chain");

console.log("continuous primary-button mining state tests passed");
