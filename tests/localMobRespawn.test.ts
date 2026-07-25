import assert from "node:assert/strict";
import {
  LOCAL_MOB_RESPAWN_DELAY_SECONDS,
  LOCAL_MOB_RESPAWN_PLAYER_DISTANCE,
  MOB_DEFINITIONS,
  consumeDueLocalCreeperExplosions,
  createMobSimulation,
  damageMob,
  exportMobSimulationSnapshot,
  restoreMobSimulationSnapshot,
  stepMobSimulation,
  type MobSimulation,
  type MobSpawnDescriptor,
} from "../client/game/mobs.ts";

function spawn(id: string, kind: MobSpawnDescriptor["kind"], x = 0, z = 0): MobSpawnDescriptor {
  return { id, kind, x, y: 1, z, yaw: 0, homeX: x, homeZ: z, behaviorSeed: 7319 };
}

const farPlayer = { x: LOCAL_MOB_RESPAWN_PLAYER_DISTANCE + 8, y: 1, z: 0 };
const step = (
  simulation: MobSimulation,
  count: number,
  overrides: Partial<Parameters<typeof stepMobSimulation>[1]> = {},
) => {
  for (let index = 0; index < count; index += 1) {
    stepMobSimulation(simulation, {
      dtSeconds: 0.1,
      isNight: false,
      terrainHeight: () => 0,
      player: farPlayer,
      canOccupy: () => true,
      ...overrides,
    });
  }
};

const timing = createMobSimulation([spawn("cow-respawn", "cow")]);
const timingMob = timing.mobs[0];
assert.equal(damageMob(timing, timingMob.id, 100, () => true).killed, true);
assert.equal(timingMob.behaviorUntilSeconds, LOCAL_MOB_RESPAWN_DELAY_SECONDS);
step(timing, LOCAL_MOB_RESPAWN_DELAY_SECONDS * 10 - 1);
assert.equal(timingMob.alive, false, "a local death remains absent before the exact active-play deadline");
step(timing, 1);
assert.equal(timingMob.alive, true, "the mob respawns on the exact eligible simulation tick");
assert.equal(timingMob.health, MOB_DEFINITIONS.cow.maxHealth);
assert.equal(timingMob.behaviorUntilSeconds, 0);
assert.equal(timingMob.sheared, false);
assert.equal(timingMob.fuseStartedAtSeconds, 0);
assert.equal(timingMob.fuseUntilSeconds, 0);
assert.equal(timingMob.damageSequence, 1, "respawn preserves the monotonic loot-event sequence");
assert.equal(damageMob(timing, timingMob.id, 100, () => true).killed, true);
assert.equal(timingMob.damageSequence, 2, "a later life receives a distinct deterministic death event");

const paused = createMobSimulation([spawn("pig-paused", "pig")]);
damageMob(paused, "pig-paused", 100, () => true);
step(paused, 2_000, { dtSeconds: 0 });
assert.equal(paused.elapsedSeconds, 0, "paused/background frames contribute no respawn time");
assert.equal(paused.mobs[0].alive, false);

const savedA = createMobSimulation([spawn("sheep-save", "sheep")]);
damageMob(savedA, "sheep-save", 100, () => true);
step(savedA, 150);
const savedB = createMobSimulation([spawn("sheep-save", "sheep")]);
assert.equal(restoreMobSimulationSnapshot(savedB, exportMobSimulationSnapshot(savedA)), true);
step(savedA, 150);
step(savedB, 150);
assert.deepEqual(savedB, savedA, "save/reload halfway through the delay reproduces the exact respawn tick and state");

const gated = createMobSimulation([spawn("cow-gated", "cow"), spawn("pig-blocker", "pig")]);
damageMob(gated, "cow-gated", 100, () => true);
step(gated, LOCAL_MOB_RESPAWN_DELAY_SECONDS * 10, { player: { x: 0, y: 1, z: 0 } });
assert.equal(gated.mobs[0].alive, false, "a player at the home position postpones respawn");
step(gated, 1, { canOccupy: () => false });
assert.equal(gated.mobs[0].alive, false, "a solid-filled home postpones respawn");
gated.mobs[1].x = 0;
gated.mobs[1].y = 1;
gated.mobs[1].z = 0;
step(gated, 1);
assert.equal(gated.mobs[0].alive, false, "another living mob at home postpones respawn");
gated.mobs[1].x = 8;
gated.mobs[1].z = 8;
step(gated, 1);
assert.equal(gated.mobs[0].alive, true, "clearing the home while the player is away allows deterministic respawn");
assert.equal(gated.mobs.length, 2, "respawn reuses the retained slot rather than growing the population");

const authoritative = createMobSimulation([spawn("cow-authoritative", "cow")]);
const authoritativeMob = authoritative.mobs[0];
authoritativeMob.authoritativeRevision = 3;
authoritativeMob.alive = false;
authoritativeMob.health = 0;
authoritativeMob.behaviorUntilSeconds = 0.1;
step(authoritative, LOCAL_MOB_RESPAWN_DELAY_SECONDS * 10 + 1);
assert.equal(authoritativeMob.alive, false, "Lakebed-authoritative slots ignore the local respawn deadline");

const creeper = createMobSimulation([spawn("creeper-respawn", "creeper")]);
const creeperMob = creeper.mobs[0];
creeper.elapsedSeconds = 4;
creeperMob.fuseStartedAtSeconds = 1;
creeperMob.fuseUntilSeconds = 3;
assert.equal(consumeDueLocalCreeperExplosions(creeper).length, 1);
assert.equal(consumeDueLocalCreeperExplosions(creeper).length, 0, "one fuse cannot explode twice while waiting to respawn");
assert.equal(creeperMob.behaviorUntilSeconds, 4 + LOCAL_MOB_RESPAWN_DELAY_SECONDS);
step(creeper, LOCAL_MOB_RESPAWN_DELAY_SECONDS * 10);
assert.equal(creeperMob.alive, true);
assert.equal(creeperMob.health, MOB_DEFINITIONS.creeper.maxHealth);
assert.equal(creeperMob.fuseStartedAtSeconds, 0);
assert.equal(creeperMob.fuseUntilSeconds, 0);

console.log("local mob respawn timing, gating, persistence, and authority tests passed");
