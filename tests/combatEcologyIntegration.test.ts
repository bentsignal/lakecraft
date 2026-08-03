import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  LOCAL_MOB_DEATH_ANIMATION_SECONDS,
  LOCAL_MOB_SPIDER_ENGAGEMENT_SECONDS,
  consumeMobContactDamage,
  createMobSimulation,
  damageMob,
  exportMobSimulationSnapshot,
  meleeMobPlayerStandoff,
  restoreMobSimulationSnapshot,
  stepMobSimulation,
  writeMobPoseSnapshots,
  type LocalMobDeathDropEvent,
  type MobDamageSource,
} from "../client/game/mobs.ts";

const player = { x: 0, y: 1, z: 0 };
const spider = createMobSimulation([{
  id: "spider-combat-ecology",
  kind: "spider",
  x: 4,
  y: 1,
  z: 0,
  yaw: 0,
  homeX: 4,
  homeZ: 0,
  behaviorSeed: 73,
}]);
const stepSpider = (light: number, target: typeof player | null) => stepMobSimulation(spider, {
  dtSeconds: 0.1,
  isNight: light < 0.5,
  terrainHeight: () => 0,
  player: target,
  canOccupy: () => true,
  localLight: () => light,
  directSky: () => false,
});
for (let tick = 0; tick < 30; tick += 1) stepSpider(0, player);
const standoff = meleeMobPlayerStandoff("spider");
assert.ok(Math.hypot(spider.mobs[0]!.x, spider.mobs[0]!.z) >= standoff - 1e-9,
  "dark pursuit retains the reviewed no-overlap standoff");
stepSpider(1, player);
assert.equal(spider.mobs[0]!.hostileActive, true, "light transition retains an already engaged spider");
assert.ok(Math.hypot(spider.mobs[0]!.x, spider.mobs[0]!.z) >= standoff - 1e-9,
  "engagement retention cannot regress the combat collider boundary");
const spiderSources: MobDamageSource[] = [];
assert.equal(consumeMobContactDamage(spider, player, spider.elapsedSeconds, false, undefined, spiderSources), 2);
assert.equal(spiderSources.length, 1, "one accepted engaged contact emits one knockback source");
for (let tick = 0; tick <= Math.ceil(LOCAL_MOB_SPIDER_ENGAGEMENT_SECONDS / 0.1); tick += 1) stepSpider(1, null);
assert.equal(spider.mobs[0]!.hostileActive, false, "bright disengagement stops later damage eligibility");
spiderSources.length = 0;
assert.equal(consumeMobContactDamage(spider, player, spider.elapsedSeconds + 2, false, undefined, spiderSources), 0);
assert.equal(spiderSources.length, 0, "neutrality cannot leak a stale knockback source");

const zombie = createMobSimulation([{
  id: "zombie-death-receipt",
  kind: "zombie",
  x: 2,
  y: 1,
  z: 3,
  yaw: 0,
  homeX: 2,
  homeZ: 3,
  behaviorSeed: 7,
}]);
stepMobSimulation(zombie, {
  dtSeconds: 0.1,
  isNight: true,
  terrainHeight: () => 0,
  player: null,
  localLight: () => 0,
});
assert.equal(damageMob(zombie, "zombie-death-receipt", 3).applied, true);
const events: LocalMobDeathDropEvent[] = [];
const fatal = damageMob(zombie, "zombie-death-receipt", 100, (event) => {
  events.push({ ...event, drops: event.drops.map((drop) => ({ ...drop })) });
  return true;
});
assert.equal(fatal.killed, true);
assert.equal(events.length, 1);
assert.equal(events[0]!.eventId, "zombie-death-receipt:2", "the death reward follows the monotonic combat sequence");
assert.deepEqual({ x: events[0]!.x, y: events[0]!.y, z: events[0]!.z }, { x: 2, y: 1, z: 3 },
  "drops settle at canonical simulation state rather than a transient render knockback offset");
const deathPose = writeMobPoseSnapshots(zombie)[0]!;
assert.equal(deathPose.deathFall, 0);
assert.equal(deathPose.x, 2, "the reactive renderer owns transient offsets without corrupting persisted death position");
damageMob(zombie, "zombie-death-receipt", 100, () => { throw new Error("death animation cannot replay drops"); });
assert.equal(events.length, 1);
const restored = createMobSimulation([]);
assert.equal(restoreMobSimulationSnapshot(restored, exportMobSimulationSnapshot(zombie)), true);
assert.equal(restored.mobs[0]!.damageSequence, 2);
assert.equal(writeMobPoseSnapshots(restored).length, 1, "reload retains the fall-over without replaying combat");
for (let tick = 0; tick < Math.ceil(LOCAL_MOB_DEATH_ANIMATION_SECONDS / 0.1); tick += 1) {
  stepMobSimulation(restored, { dtSeconds: 0.1, isNight: true, terrainHeight: () => 0, player: null });
}
assert.equal(writeMobPoseSnapshots(restored).length, 0);
assert.equal(restored.mobs[0]!.damageSequence, 2, "despawn timing cannot erase the drop receipt sequence");

const engine = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");
const reactions = engine.slice(engine.indexOf("function writeReactiveMobPoseSnapshots"), engine.indexOf("function updateMobs"));
assert.ok(reactions.includes("snapshot.x += reaction.offsetX") && reactions.includes("snapshot.previousZ += reaction.previousOffsetZ"),
  "live and dying poses share the retained visual reaction seam");
assert.ok(reactions.includes("mobSimulation.elapsedSeconds + 1e-9 >= mob.deathUntil"),
  "existing knockback is retained only through the bounded fall-over window");
assert.ok(engine.includes("if (!result.killed) applyConfirmedPlayerHitMobKnockback"),
  "fatal local hits still cannot mint a new knockback reaction or receipt");
assert.ok(engine.includes("onFatalDrops: options.onMobDrops"),
  "sunlight fatalities use the same exact-once local drop reservation callback");

console.log("combined combat standoff, knockback, local-light ecology, death, and drop-state tests passed");
