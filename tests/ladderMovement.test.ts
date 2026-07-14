import assert from "node:assert/strict";
import {
  LADDER_CLIMB_SPEED,
  LADDER_DESCEND_SPEED,
  LADDER_IDLE_SLIDE_SPEED,
  PLAYER_GRAVITY,
  PLAYER_JUMP_SPEED,
  PLAYER_TERMINAL_VELOCITY,
  ladderVerticalVelocity,
  playerTouchesLadder,
} from "../client/game/voxelEngine.ts";
import { BLOCK, type BlockId } from "../client/game/types.ts";

function lookup(entries: ReadonlySet<string>) {
  return (x: number, y: number, z: number): BlockId => entries.has(`${x},${y},${z}`) ? BLOCK.LADDER : BLOCK.AIR;
}

assert.equal(playerTouchesLadder(0.5, 0.02, 0.5, lookup(new Set(["0,0,0"]))), true, "feet overlap detects contact");
assert.equal(playerTouchesLadder(0.5, 0.02, 0.5, lookup(new Set(["0,1,0"]))), true, "torso overlap detects contact");
assert.equal(playerTouchesLadder(0.5, 0.02, 0.5, lookup(new Set(["0,2,0"]))), false, "a ladder above the body is not contact");
assert.equal(playerTouchesLadder(1.5, 0.02, 0.5, lookup(new Set(["0,0,0", "0,1,0"]))), false, "an adjacent cell is not contact");
assert.equal(playerTouchesLadder(Number.NaN, 0, 0, lookup(new Set(["0,0,0"]))), false);

// W and Space both map to ascend=true in the engine's allocation-free key path.
assert.equal(ladderVerticalVelocity(-18, true, true, false, 1 / 60), LADDER_CLIMB_SPEED);
assert.equal(ladderVerticalVelocity(PLAYER_JUMP_SPEED, true, true, false, 1 / 60), LADDER_CLIMB_SPEED);
assert.ok(LADDER_CLIMB_SPEED > 0 && LADDER_CLIMB_SPEED < PLAYER_JUMP_SPEED);

// S and either Shift key map to descend=true.
assert.equal(ladderVerticalVelocity(8, true, false, true, 1 / 60), LADDER_DESCEND_SPEED);
assert.ok(LADDER_DESCEND_SPEED < 0 && LADDER_DESCEND_SPEED > PLAYER_TERMINAL_VELOCITY);

assert.equal(
  ladderVerticalVelocity(PLAYER_TERMINAL_VELOCITY, true, false, false, 1 / 60),
  LADDER_IDLE_SLIDE_SPEED,
  "idle ladder contact arrests a dangerous fall",
);
assert.equal(ladderVerticalVelocity(-0.4, true, false, false, 1 / 60), -0.4, "an already slow fall remains smooth");
assert.equal(ladderVerticalVelocity(4, true, false, false, 1 / 60), 0, "idle contact arrests upward drift");
assert.equal(ladderVerticalVelocity(-12, true, true, true, 1 / 60), LADDER_IDLE_SLIDE_SPEED, "conflicting input fails safe to a slow slide");

const afterLeaving = ladderVerticalVelocity(LADDER_IDLE_SLIDE_SPEED, false, false, false, 0.05);
assert.equal(afterLeaving, LADDER_IDLE_SLIDE_SPEED - PLAYER_GRAVITY * 0.05, "leaving a ladder immediately restores gravity");
assert.equal(
  ladderVerticalVelocity(PLAYER_JUMP_SPEED, false, false, false, 0.05),
  PLAYER_JUMP_SPEED - PLAYER_GRAVITY * 0.05,
  "normal jumping keeps its gravity behavior away from ladders",
);

let falling = LADDER_IDLE_SLIDE_SPEED;
for (let frame = 0; frame < 1_000; frame += 1) {
  falling = ladderVerticalVelocity(falling, false, false, false, 1 / 60);
  assert.ok(Number.isFinite(falling));
  assert.ok(falling >= PLAYER_TERMINAL_VELOCITY && falling <= PLAYER_JUMP_SPEED);
}
assert.equal(falling, PLAYER_TERMINAL_VELOCITY, "long falls remain terminally bounded");

for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
  const onLadder = ladderVerticalVelocity(invalid, true, false, false, Number.NaN);
  const offLadder = ladderVerticalVelocity(invalid, false, false, false, Number.NaN);
  assert.ok(Number.isFinite(onLadder));
  assert.ok(Number.isFinite(offLadder));
  assert.ok(onLadder >= PLAYER_TERMINAL_VELOCITY && onLadder <= PLAYER_JUMP_SPEED);
  assert.ok(offLadder >= PLAYER_TERMINAL_VELOCITY && offLadder <= PLAYER_JUMP_SPEED);
}
assert.equal(
  ladderVerticalVelocity(1_000_000, false, false, false, 1_000_000),
  PLAYER_JUMP_SPEED - PLAYER_GRAVITY * 0.05,
  "velocity and frame delay are both bounded before gravity integration",
);

console.log("lakecraft ladder movement tests: ok");
