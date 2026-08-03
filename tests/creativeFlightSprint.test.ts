import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CREATIVE_FLIGHT_SPEED,
  CREATIVE_FLIGHT_SPRINT_RATIO,
  CREATIVE_FLIGHT_SPRINT_SPEED,
  resolveCreativeFlightMovement,
  writeHorizontalMovementDelta,
} from "../client/game/playerMovement.ts";

assert.equal(CREATIVE_FLIGHT_SPRINT_RATIO, 1.6);
assert.equal(CREATIVE_FLIGHT_SPRINT_SPEED / CREATIVE_FLIGHT_SPEED, 1.6);
for (const fps of [30, 60, 144]) {
  const distance = (sprint: boolean) => {
    let total = 0;
    const movement = resolveCreativeFlightMovement(1, 0, sprint);
    for (let i = 0; i < fps * 5; i += 1) {
      const delta = writeHorizontalMovementDelta(0, movement, 1 / fps, { x: 0, z: 0 });
      total += Math.hypot(delta.x, delta.z);
    }
    return total;
  };
  assert.ok(Math.abs(distance(true) / distance(false) - 1.6) < 1e-12, `${fps}fps keeps the exact ratio`);
}
for (const [forward, strafe] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]) {
  const movement = resolveCreativeFlightMovement(forward, strafe, true);
  assert.equal(movement.mode, "sprint");
  assert.ok(Math.abs(Math.hypot(movement.forward, movement.strafe) - 1) < 1e-12);
}
assert.equal(resolveCreativeFlightMovement(0, 0, true).mode, "idle");
assert.equal(resolveCreativeFlightMovement(1, 0, false).mode, "walk");

const engine = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");
assert.match(engine, /flying \? resolveCreativeFlightMovement\(forward, strafe, sprintHeld\)/);
assert.match(engine, /function releaseTransientInput\(\)[\s\S]*clearHeldMovementInput\(\)/);
assert.match(engine, /function onWindowBlur\(\)[\s\S]*releaseTransientInput\(\)/);
assert.match(engine, /function onPointerLockChange\(\)[\s\S]*releaseTransientInput\(\)/);
console.log("creative flight sprint ratio, normalization, and release gates passed");
