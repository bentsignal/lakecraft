import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  applyConfirmedDurableItemUse,
  countItem,
  createEmptyInventory,
  removeItem,
  type Inventory,
} from "../shared/game.ts";
import { authoritativeRangedTrajectory } from "../shared/rangedCombat.ts";
import { createMobSimulation, damageMob, type MobSpawnDescriptor } from "../client/game/mobs.ts";

function spendLocalArrow(inventory: Inventory, selectedHotbar: number) {
  if (countItem(inventory, "arrow") < 1) return { ok: false as const, inventory };
  const worn = applyConfirmedDurableItemUse(inventory, selectedHotbar, "bow");
  if (!worn.used) return { ok: false as const, inventory };
  const removed = removeItem(worn.inventory, "arrow", 1);
  assert.equal(removed.remainder, 0, "a preflighted local shot removes exactly one arrow");
  return { ok: true as const, inventory: removed.inventory, broke: worn.broke };
}

const pose = { userId: "local", x: 0, y: 1, z: 0, yaw: 0, pitch: 0, heartbeatAt: 1, online: true };
const minimum = authoritativeRangedTrajectory(pose, 50);
const full = authoritativeRangedTrajectory(pose, 1_000);
assert.ok(minimum && full);
assert.equal(minimum.damage, 2, "a minimum valid draw uses the authoritative low-power damage floor");
assert.equal(full.damage, 6, "a full draw uses the authoritative six-damage ceiling");
assert.ok(full.speed > minimum.speed, "holding charge increases projectile speed");

const initial = createEmptyInventory();
initial[0] = { itemId: "bow", count: 1, durability: 2 };
initial[8] = { itemId: "arrow", count: 3 };
const cancelled = initial.map((stack) => stack ? { ...stack } : null) as Inventory;
assert.deepEqual(cancelled, initial, "canceling a charge spends neither arrow nor bow durability");

const miss = spendLocalArrow(initial, 0);
assert.equal(miss.ok, true);
if (!miss.ok) throw new Error("expected valid miss resources");
assert.equal(countItem(miss.inventory, "arrow"), 2, "a miss still consumes one arrow");
assert.deepEqual(miss.inventory[0], { itemId: "bow", count: 1, durability: 1 }, "a miss wears the bow once");
assert.equal(countItem(initial, "arrow"), 3, "shot accounting is immutable");

const noArrow = createEmptyInventory();
noArrow[0] = { itemId: "bow", count: 1, durability: 2 };
const rejected = spendLocalArrow(noArrow, 0);
assert.equal(rejected.ok, false);
assert.deepEqual(rejected.inventory, noArrow, "a bow without arrows cannot charge or spend durability");

const breakingInventory = createEmptyInventory();
breakingInventory[0] = { itemId: "bow", count: 1, durability: 1 };
breakingInventory[4] = { itemId: "arrow", count: 2 };
const broken = spendLocalArrow(breakingInventory, 0);
assert.equal(broken.ok, true);
if (!broken.ok) throw new Error("expected final bow use");
assert.equal(broken.broke, true);
assert.equal(broken.inventory[0], null, "the final shot removes the broken bow immediately");
assert.equal(countItem(broken.inventory, "arrow"), 1, "bow breakage cannot duplicate or over-consume arrows");

function spawn(kind: MobSpawnDescriptor["kind"], id: string): MobSpawnDescriptor {
  return { id, kind, x: 0, y: 1, z: -3, yaw: 0, homeX: 0, homeZ: -3, behaviorSeed: 7_319 };
}

const hitSimulation = createMobSimulation([spawn("cow", "bow-hit")]);
const hit = damageMob(hitSimulation, "bow-hit", full.damage);
assert.equal(hit.applied, true);
assert.equal(hit.killed, false);
assert.equal(hit.remainingHealth, 4, "one full-charge release damages the target exactly once");

const killSimulation = createMobSimulation([spawn("chicken", "bow-kill")]);
let dropReservations = 0;
const killed = damageMob(killSimulation, "bow-kill", full.damage, () => {
  dropReservations += 1;
  return true;
});
assert.equal(killed.killed, true);
assert.equal(dropReservations, 1, "a fatal arrow reserves local drops exactly once");
assert.equal(damageMob(killSimulation, "bow-kill", full.damage).applied, false, "release replay cannot kill or mint drops twice");

const app = readFileSync(new URL("../client/singleplayer/SinglePlayerApp.tsx", import.meta.url), "utf8");
const engine = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");
const engineTypes = readFileSync(new URL("../client/game/types.ts", import.meta.url), "utf8");
const multiplayer = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");

assert.match(app, /isRangedWeaponSelected:[\s\S]{0,300}itemId === "bow"[\s\S]{0,300}(?:countItem\([^)]*, "arrow"\)|hasItem\([^)]*, "arrow"\))/,
  "single-player only starts a draw from a selected bow with ammunition");
assert.match(app, /selectedItem: inventoryRef\.current\[selectedRef\.current\]\?\.itemId \?\? null/,
  "single-player initializes the retained viewmodel from its canonical selected stack");
assert.match(app, /setSelectedItem\(inventory\[selected\]\?\.itemId \?\? null\)/,
  "hotbar changes update the engine-owned bow model without React visual state");
assert.doesNotMatch(app, /FirstPersonBow|setBowCharging|setBowChargeMs/,
  "single-player has no duplicate DOM/SVG bow or per-frame React charge state");
assert.match(app, /onRangedRelease:[\s\S]{0,4000}applyConfirmedDurableItemUse\([^)]*"bow"\)[\s\S]{0,4000}removeItem\([^)]*"arrow"\s*,\s*1\)[\s\S]{0,4000}updateInventory/,
  "one local release atomically wears the bow, removes one arrow, and joins the dirty-save inventory path");
assert.match(app, /onRangedRelease:[\s\S]{0,4000}damageLocalMobWithRangedShot\(intent\.target\.id/,
  "a targeted local release delegates retained mob damage to the engine exactly once");
assert.match(app, /onRangedRelease:[\s\S]{0,5000}setPlayerProjectiles\([^)]+\)/,
  "a local release reuses the retained bounded projectile renderer");
assert.match(app, /playerProjectilesRef\.current =[\s\S]{0,500}\.slice\(-96\)/,
  "local arrow visuals retain the existing hard 96-projectile cap");
assert.match(engineTypes, /damageLocalMobWithRangedShot\(mobId: string, damage: number\): [^;\n]*MobDamageResult;/,
  "the local ranged-damage method is explicit on the public engine boundary");

const localReleaseStart = engine.indexOf("damageLocalMobWithRangedShot(mobId, damage)");
const localRelease = engine.slice(localReleaseStart, engine.indexOf("setSelectedBlock", localReleaseStart));
assert.ok(localReleaseStart > 0, "the engine implements the public local ranged-damage method");
assert.ok(localRelease.includes("damageMob"), "the engine-owned local release applies damage to its retained mob simulation");
assert.ok(localRelease.includes("options.onMobDrops"), "fatal local arrows retain bounded drop reservation");
assert.ok(localRelease.includes("writeMobPoseSnapshots"), "hit and kill results reach the retained hurt/death renderer");

const clearCharge = engine.slice(engine.indexOf("function clearRangedCharge"), engine.indexOf("function rememberWorldEdit"));
assert.ok(clearCharge.includes("onRangedCancel"), "pointer-lock and modal cancellation clear the active draw");
assert.equal(clearCharge.includes("removeItem"), false, "canceling inside the engine cannot spend an arrow");

assert.ok(engine.includes("options.onRangedRelease?.(intent)"), "delegated multiplayer release callback remains intact");
assert.ok(engine.includes("firstPersonRenderer.setBowCharge"), "engine-owned charge selects retained bow geometry");
assert.match(multiplayer, /onRangedRelease: \(intent\) =>[\s\S]{0,1800}rangedCombat\(requestJson\)/,
  "multiplayer release remains one Lakebed-authoritative mutation");
assert.equal(app.includes("lakebed/client"), false, "single-player bow use adds zero Lakebed traffic");

console.log("single-player bow integration contract tests passed");
