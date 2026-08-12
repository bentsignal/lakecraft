import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  consumeMobContactDamage,
  createMobSimulation,
  meleeMobPlayerAttackReach,
  meleeMobPlayerStandoff,
  stableMobSeparationDirection,
  stepMobSimulation,
} from "../client/game/mobs.ts";
import {
  applyMobKnockbackImpulse,
  createMobKnockbackReaction,
  decideMobKnockback,
  mobKnockbackReactionSettled,
  resolveMobKnockback,
  stepMobKnockbackAxis,
} from "../client/game/mobKnockback.ts";
import {
  MOB_MOTION_UNITS_PER_BLOCK,
  createMobMotionState,
  mobFacingYaw,
  mobMotionMeleeStandoffUnits,
  stepMobMotion,
} from "../shared/mobMotionAuthority.ts";

const flatStep = {
  dtSeconds: 0.1,
  isNight: true,
  terrainHeight: () => 0,
  player: { x: 0, y: 1, z: 0 },
  canOccupy: () => true,
  worldRadius: 64,
};

const spider = createMobSimulation([{
  id: "spider-overlap",
  kind: "spider",
  x: 4,
  y: 1,
  z: 0,
  yaw: 0,
  homeX: 4,
  homeZ: 0,
  behaviorSeed: 73,
}]);
const spiderStandoff = meleeMobPlayerStandoff("spider");
assert.ok(meleeMobPlayerAttackReach("spider") > spiderStandoff,
  "attack reach keeps a visible margin beyond the physical no-overlap boundary");
for (let tick = 0; tick < 120; tick += 1) {
  stepMobSimulation(spider, flatStep);
  assert.ok(Math.hypot(spider.mobs[0].x, spider.mobs[0].z) >= spiderStandoff - 1e-9,
    "repeated spider charge cannot cross the player standoff");
}
assert.equal(consumeMobContactDamage(spider, flatStep.player, spider.elapsedSeconds, true), 2,
  "a stationary player inside the attack margin is hit without walking into the mob");

const zero = createMobSimulation([{
  id: "zombie-zero",
  kind: "zombie",
  x: 0,
  y: 1,
  z: 0,
  yaw: 0.4,
  homeX: 0,
  homeZ: 0,
  behaviorSeed: 18,
}]);
stepMobSimulation(zero, flatStep);
assert.ok(Math.abs(Math.hypot(zero.mobs[0].x, zero.mobs[0].z) - meleeMobPlayerStandoff("zombie")) < 1e-9,
  "an exact coordinate overlap separates deterministically in one bounded tick");
assert.deepEqual(stableMobSeparationDirection(18), [-1, 0]);
const zeroYaw = zero.mobs[0].yaw;
for (let tick = 0; tick < 20; tick += 1) stepMobSimulation(zero, flatStep);
assert.ok(Number.isFinite(zero.mobs[0].yaw));
assert.equal(zero.mobs[0].yaw, zeroYaw, "near-zero targeting keeps one stable facing instead of oscillating");

const blocked = createMobSimulation([{
  id: "spider-blocked",
  kind: "spider",
  x: 0,
  y: 1,
  z: 0,
  yaw: -0.2,
  homeX: 0,
  homeZ: 0,
  behaviorSeed: 11,
}]);
for (let tick = 0; tick < 8; tick += 1) stepMobSimulation(blocked, { ...flatStep, canOccupy: () => false });
assert.equal(blocked.mobs[0].x, 0, "terrain rejection wins over overlap correction");
assert.ok(Number.isFinite(blocked.mobs[0].yaw), "a blocked zero-distance mob still has stable finite facing");

const downhill = createMobSimulation([{
  id: "zombie-downhill",
  kind: "zombie",
  x: -0.7,
  y: 2,
  z: 0,
  yaw: Math.PI / 2,
  homeX: -0.7,
  homeZ: 0,
  behaviorSeed: 41,
}]);
for (let tick = 0; tick < 50; tick += 1) {
  stepMobSimulation(downhill, {
    ...flatStep,
    player: { x: 5, y: 1, z: 0 },
    terrainHeight: (x) => x < 0 ? 1 : 0,
    canOccupy: (_kind, x, y, _z, radius) => y >= 2 || x - radius >= 0,
  });
}
assert.ok(downhill.mobs[0].x > 0.35, "a chasing zombie clears a one-block downhill ledge instead of stopping on it");
assert.equal(downhill.mobs[0].y, 1, "the zombie settles onto the lower floor after its full collider clears the ledge");

const meleeImpulse = resolveMobKnockback(0, 0, 2, 0, 0, 1, 4)!;
assert.ok(meleeImpulse.x > 0 && Math.abs(meleeImpulse.z) < 1e-12, "player melee pushes the mob away from the player");
const projectileImpulse = resolveMobKnockback(3, -4, 0, 0, 1, 0, 8)!;
assert.ok(projectileImpulse.x < 0 && projectileImpulse.z > 0, "projectile origin determines the hit direction");
const coincidentImpulse = resolveMobKnockback(1, 1, 1, 1, 0, -1, 2)!;
assert.ok(coincidentImpulse.z < 0, "coincident hits use a stable caller-supplied fallback");
assert.equal(resolveMobKnockback(0, 0, 1, 0, 1, 0, 0), null, "rejected damage cannot create motion");
assert.equal(decideMobKnockback("confirmed", false, true), "accept");
assert.equal(decideMobKnockback("confirmed", true, true), "duplicate");
assert.equal(decideMobKnockback("confirmed", false, false), "ineligible");

const reaction = createMobKnockbackReaction();
applyMobKnockbackImpulse(reaction, meleeImpulse);
for (let frame = 0; frame < 240 && !mobKnockbackReactionSettled(reaction); frame += 1) {
  const x = stepMobKnockbackAxis(reaction.offsetX, reaction.velocityX, 1 / 60, () => false);
  reaction.offsetX = x.offset;
  reaction.velocityX = x.velocity;
  const z = stepMobKnockbackAxis(reaction.offsetZ, reaction.velocityZ, 1 / 60, () => false);
  reaction.offsetZ = z.offset;
  reaction.velocityZ = z.velocity;
}
assert.ok(mobKnockbackReactionSettled(reaction), "hurt motion damps and recovers to the canonical pose");
const collision = stepMobKnockbackAxis(0, 5, 0.05, () => true);
assert.deepEqual(collision, { offset: 0, velocity: 0 }, "terrain collision cancels the blocked reaction axis");

const authority = createMobMotionState({
  seed: 7319,
  epoch: 100,
  snapshot: [{ mobId: "spider-5nb-0", kind: "spider", x: 0, y: 1, z: 0 }],
});
assert.ok(authority);
const authorityTarget = { isNight: true, targets: [{ userId: "player", x: 0, y: 1, z: 0 }] };
stepMobMotion(authority, authorityTarget);
const authorityStandoff = mobMotionMeleeStandoffUnits("spider");
assert.ok(Math.abs(Math.hypot(authority.mobs[0].x, authority.mobs[0].z) - authorityStandoff) <= 1,
  "shared fixed-tick authority resolves an exact overlap to the same collider standoff");
assert.equal(authority.mobs[0].yaw, Math.round(mobFacingYaw(-authority.mobs[0].x, -authority.mobs[0].z, 0) * 1_000_000),
  "the authority mob faces back toward the target instead of facing along its escape vector");
for (let tick = 0; tick < 120; tick += 1) {
  stepMobMotion(authority, authorityTarget);
  assert.ok(Math.hypot(authority.mobs[0].x, authority.mobs[0].z) >= authorityStandoff - 1,
    "authoritative replay cannot charge through the player");
}
assert.ok(authorityStandoff > MOB_MOTION_UNITS_PER_BLOCK * 0.9);

const engine = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");
for (const internalProperty of [
  "applyConfirmedPlayerHitMobKnockback",
  "offsetZ",
  "previousOffsetX",
  "previousOffsetZ",
]) assert.ok(engine.includes(internalProperty), `${internalProperty} remains in the reviewed retained reaction boundary`);
assert.ok(engine.includes("decideMobKnockback(eventId, mobKnockbackReceipts.has(eventId), !paused)"),
  "pause and duplicate receipts reject hit reactions at the retained engine boundary");
assert.ok(engine.includes("if (!result.killed) applyConfirmedPlayerHitMobKnockback"),
  "only accepted nonfatal local damage produces a reaction");
assert.ok(engine.includes("-Math.sin(mob.yaw),") && engine.includes("Math.cos(mob.yaw),"),
  "coincident hit knockback follows the corrected local +Z mob-facing convention");
const multiplayer = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");
assert.doesNotMatch(multiplayer, /attackMob|rangedCombat/,
  "Railway multiplayer cannot reuse Lakebed combat receipts");
assert.match(multiplayer, /onRemotePlayerAttack: \(\) => undefined/,
  "network combat stays disabled until Railway owns the receipt and reaction");

console.log("combat knockback and overlap tests passed");
