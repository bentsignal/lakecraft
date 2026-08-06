import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  applyConfirmedToolUse,
  createEmptyInventory,
  type Inventory,
} from "../shared/game.ts";
import {
  createMobSimulation,
  damageMob,
  type MobSpawnDescriptor,
} from "../client/game/mobs.ts";
import {
  createDefaultSinglePlayerSnapshot,
  serializeSinglePlayerSave,
} from "../client/singleplayer/localSave.ts";

const spawn: MobSpawnDescriptor = {
  id: "cow-weapon-wear",
  kind: "cow",
  x: 0,
  y: 1,
  z: 0,
  yaw: 0,
  homeX: 0,
  homeZ: 0,
  behaviorSeed: 7319,
};

const nonfatal = createMobSimulation([spawn]);
assert.deepEqual(damageMob(nonfatal, spawn.id, 0), {
  found: true, applied: false, killed: false, remainingHealth: 10, drops: [],
});
assert.deepEqual(damageMob(nonfatal, "missing", 4), {
  found: false, applied: false, killed: false, remainingHealth: 0, drops: [],
});
const accepted = damageMob(nonfatal, spawn.id, 4);
assert.equal(accepted.applied, true);
assert.equal(accepted.killed, false);
assert.equal(accepted.remainingHealth, 6);

const rejected = createMobSimulation([spawn]);
const beforeRejected = structuredClone(rejected);
const rejectedFatal = damageMob(rejected, spawn.id, 100, () => false);
assert.equal(rejectedFatal.applied, false);
assert.equal(rejectedFatal.killed, false);
assert.deepEqual(rejected, beforeRejected, "a rejected fatal loot reservation changes no mob state");
const acceptedRetry = damageMob(rejected, spawn.id, 100, () => true);
assert.equal(acceptedRetry.applied, true);
assert.equal(acceptedRetry.killed, true);
assert.equal(damageMob(rejected, spawn.id, 100).applied, false, "a dead mob cannot spend another weapon use");

const inventory: Inventory = createEmptyInventory();
inventory[2] = { itemId: "wooden_sword", count: 1, durability: 2 };
const worn = applyConfirmedToolUse(inventory, 2, "attack", "wooden_sword");
assert.equal(worn.used, true);
assert.equal(worn.broke, false);
assert.equal(worn.remainingDurability, 1);
const broken = applyConfirmedToolUse(worn.inventory, 2, "attack", "wooden_sword");
assert.equal(broken.used, true);
assert.equal(broken.broke, true);
assert.equal(broken.inventory[2], null, "a durability-one weapon leaves the held slot immediately");
assert.equal(applyConfirmedToolUse(inventory, 2, "attack", "stone_sword").used, false, "expected identity mismatch cannot wear a replacement stack");
assert.equal(applyConfirmedToolUse(createEmptyInventory(), 2, "attack", null).used, false, "bare-hand hits never mutate inventory");
const nondurable = createEmptyInventory();
nondurable[2] = { itemId: "dirt", count: 12 };
assert.equal(applyConfirmedToolUse(nondurable, 2, "attack", "dirt").used, false, "nondurable held items still cost no use");

const snapshot = createDefaultSinglePlayerSnapshot(7_319, 1_000, "weapon-wear");
snapshot.player.inventory = worn.inventory;
const saved = serializeSinglePlayerSave(snapshot, 1, 2_000);
assert.equal(saved.ok, true);
if (!saved.ok) throw new Error(saved.reason);
assert.equal(saved.envelope.payload.player.inventory[2]?.durability, 1, "worn weapon durability survives the local journal");

const engine = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");
const app = readFileSync(new URL("../client/singleplayer/SinglePlayerApp.tsx", import.meta.url), "utf8");
const delegated = engine.slice(engine.indexOf("if (options.onMobAttack)"), engine.indexOf("const result = damageMob"));
assert.equal(delegated.includes("onLocalMobHit"), false, "Lakebed-delegated multiplayer attacks never use local durability authority");
assert.match(engine, /if \(result\.applied\) \{[\s\S]*?onLocalMobHit\?\.\(mobTarget\.kind, result\.killed\);/,
  "only a confirmed local health reduction spends one weapon use");
assert.ok(app.includes("onLocalMobHit: (kind, killed) =>"));
assert.ok(app.includes('applyConfirmedToolUse(inventoryRef.current, slot, "attack", held)'));
assert.ok(app.includes("if (!wear.used) return;"));
assert.ok(app.includes("updateInventory(wear.inventory);"), "confirmed weapon wear joins the existing dirty-save path");
const hitWear = app.slice(app.indexOf("onLocalMobHit: (kind, killed) =>"), app.indexOf("onMobUse:", app.indexOf("onLocalMobHit: (kind, killed) =>")));
assert.equal(hitWear.includes("setMessages"), false, "routine weapon breakage relies on inventory state instead of a top-right toast");
assert.equal(app.includes("lakebed/client"), false, "single-player weapon wear adds zero Lakebed traffic");

console.log("single-player confirmed melee durability tests passed");
