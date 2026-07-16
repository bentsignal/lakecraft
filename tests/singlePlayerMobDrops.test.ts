import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createMobSimulation,
  damageMob,
  type LocalMobDeathDropEvent,
} from "../client/game/mobs.ts";
import {
  appendLocalMobDeathDrops,
  collectLocalDroppedItems,
} from "../client/singleplayer/localDroppedItems.ts";
import {
  SINGLEPLAYER_SAVE_LIMITS,
  createDefaultSinglePlayerSnapshot,
  loadSinglePlayerSave,
  saveSinglePlayerSnapshot,
  type SinglePlayerStorageAdapter,
} from "../client/singleplayer/localSave.ts";
import {
  INVENTORY_SIZE,
  createEmptyInventory,
  type Inventory,
  type ItemId,
} from "../shared/game.ts";

class MemoryStorage implements SinglePlayerStorageAdapter {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

function itemCount(inventory: Inventory, itemId: ItemId): number {
  return inventory.reduce((total, stack) => total + (stack?.itemId === itemId ? stack.count : 0), 0);
}

const simulation = createMobSimulation([{
  id: "cow-local-drop",
  kind: "cow",
  x: 7.25,
  y: 9,
  z: -2.5,
  yaw: 0,
  homeX: 7.25,
  homeZ: -2.5,
  behaviorSeed: 7319,
}]);
const fatalEvents: LocalMobDeathDropEvent[] = [];
const fatal = damageMob(simulation, "cow-local-drop", 100, (event) => {
  fatalEvents.push({ ...event, drops: event.drops.map((drop) => ({ ...drop })) });
  return true;
});
assert.equal(fatal.killed, true);
assert.equal(fatalEvents.length, 1, "one accepted fatal hit offers exactly one death event");
assert.equal(fatalEvents[0]!.x, 7.25);
assert.equal(fatalEvents[0]!.y, 9);
assert.equal(fatalEvents[0]!.z, -2.5);
assert.deepEqual(fatalEvents[0]!.drops, fatal.drops, "the reserved event and committed deterministic reward agree");
damageMob(simulation, "cow-local-drop", 100, () => {
  throw new Error("a dead mob must never offer loot twice");
});
assert.equal(fatalEvents.length, 1);

const appended = appendLocalMobDeathDrops([], fatalEvents[0]!, 10_000, SINGLEPLAYER_SAVE_LIMITS.drops);
assert.equal(appended.ok, true);
if (!appended.ok) throw new Error(appended.reason);
assert.equal(appended.added, fatal.drops.length);
assert.equal(appended.drops.length, fatal.drops.length);
for (const drop of appended.drops) {
  assert.ok(Math.hypot(drop.x - 7.25, drop.z + 2.5) <= 0.221, "loot lands beside the dead mob");
  assert.equal(drop.y, 9.35);
}
const replay = appendLocalMobDeathDrops(appended.drops, fatalEvents[0]!, 20_000, SINGLEPLAYER_SAVE_LIMITS.drops);
assert.equal(replay.ok, true);
if (!replay.ok) throw new Error(replay.reason);
assert.equal(replay.added, 0);
assert.equal(replay.replayed, true);
assert.equal(replay.drops.length, appended.drops.length, "stable event IDs make replay exact-once");

const emptyPickup = collectLocalDroppedItems(createEmptyInventory(), appended.drops, { x: 7.25, y: 9.35, z: -2.5 });
assert.equal(emptyPickup.changed, true);
assert.equal(emptyPickup.drops.length, 0, "an empty pack collects every nearby mob reward");
for (const reward of fatal.drops) {
  assert.equal(itemCount(emptyPickup.inventory, reward.itemId), reward.count);
}

const partialPack = createEmptyInventory();
partialPack[0] = { itemId: "pork", count: 63 };
for (let index = 1; index < partialPack.length; index += 1) partialPack[index] = { itemId: "stone", count: 64 };
const syntheticEvent: LocalMobDeathDropEvent = {
  eventId: "pig-partial:1",
  mobId: "pig-partial",
  x: 0,
  y: 4,
  z: 0,
  drops: [{ itemId: "pork", count: 3 }],
};
const synthetic = appendLocalMobDeathDrops([], syntheticEvent, 11_000, 4);
assert.equal(synthetic.ok, true);
if (!synthetic.ok) throw new Error(synthetic.reason);
const partialPickup = collectLocalDroppedItems(partialPack, synthetic.drops, { x: 0, y: 4.35, z: 0 });
assert.equal(itemCount(partialPickup.inventory, "pork"), 64);
assert.equal(partialPickup.drops[0]?.item.count, 2, "partial pickup leaves the conserved remainder in-world");

const fullPack = Array.from({ length: INVENTORY_SIZE }, () => ({ itemId: "stone" as const, count: 64 }));
const fullPickup = collectLocalDroppedItems(fullPack, synthetic.drops, { x: 0, y: 4.35, z: 0 });
assert.equal(fullPickup.changed, false);
assert.deepEqual(fullPickup.inventory, fullPack);
assert.deepEqual(fullPickup.drops, synthetic.drops, "a full pack leaves the complete reward on the ground");

const saturatedPool = Array.from({ length: SINGLEPLAYER_SAVE_LIMITS.drops }, (_, index) => ({
  dropId: `existing_${index}`,
  item: { itemId: "stone" as const, count: 1 },
  x: index,
  y: 4,
  z: 0,
  droppedAt: 1,
}));
assert.deepEqual(
  appendLocalMobDeathDrops(saturatedPool, syntheticEvent, 12_000, SINGLEPLAYER_SAVE_LIMITS.drops),
  { ok: false, reason: "drop_capacity" },
  "the bounded pool never truncates a mob reward",
);
const blockedSimulation = createMobSimulation([{
  id: "pig-blocked",
  kind: "pig",
  x: 0,
  y: 4,
  z: 0,
  yaw: 0,
  homeX: 0,
  homeZ: 0,
  behaviorSeed: 19,
}]);
let rejectedEvent: LocalMobDeathDropEvent | null = null;
const blocked = damageMob(blockedSimulation, "pig-blocked", 100, (event) => {
  rejectedEvent = { ...event, drops: event.drops.map((drop) => ({ ...drop })) };
  return appendLocalMobDeathDrops(saturatedPool, event, 12_000, SINGLEPLAYER_SAVE_LIMITS.drops).ok;
});
assert.equal(blocked.killed, false);
assert.equal(blockedSimulation.mobs[0]!.alive, true);
assert.equal(blockedSimulation.mobs[0]!.health, 10);
assert.equal(blockedSimulation.mobs[0]!.damageSequence, 0, "capacity rejection rolls back the entire fatal hit");
let retriedEvent: LocalMobDeathDropEvent | null = null;
const retried = damageMob(blockedSimulation, "pig-blocked", 100, (event) => {
  retriedEvent = { ...event, drops: event.drops.map((drop) => ({ ...drop })) };
  return true;
});
assert.equal(retried.killed, true);
assert.deepEqual(retriedEvent, rejectedEvent, "retrying after capacity clears offers the identical deterministic reward");

const storage = new MemoryStorage();
const snapshot = createDefaultSinglePlayerSnapshot(42, 10_000);
snapshot.drops = appended.drops;
assert.equal(saveSinglePlayerSnapshot(storage, snapshot, 13_000).ok, true);
const loaded = loadSinglePlayerSave(storage);
assert.equal(loaded.status, "loaded");
if (loaded.status !== "loaded") throw new Error(loaded.status);
assert.deepEqual(loaded.snapshot.drops, appended.drops, "uncollected mob loot survives the verified save journal");

const appSource = readFileSync(new URL("../client/singleplayer/SinglePlayerApp.tsx", import.meta.url), "utf8");
const engineSource = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");
const mobDropBranch = appSource.slice(appSource.indexOf("onMobDrops:"), appSource.indexOf("onLocalCreeperExplosion:"));
assert.ok(mobDropBranch.includes("appendLocalMobDeathDrops"));
assert.ok(mobDropBranch.includes("engine.setDroppedItems"));
assert.equal(mobDropBranch.includes("addItem("), false, "mob deaths never teleport rewards directly into the pack");
assert.ok(engineSource.includes("damageMob(mobSimulation, mobTarget.id, attackDamage, options.onMobDrops)"));

console.log("lakecraft single-player mob world-drop tests: ok");
