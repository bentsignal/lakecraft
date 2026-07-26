import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  LOCAL_DROP_MAX_SUBSTEPS,
  advanceLocalDropGravity,
  createLocalDropGravityClock,
  localDropBlockSupportHeight,
  localDroppedItemHasSupport,
  rebuildActiveLocalDropIndices,
  stepLocalDroppedItemGravity,
  wakeUnsupportedLocalDroppedItems,
  type LocalDroppedItem,
} from "../client/singleplayer/localDropGravity.ts";
import {
  createDefaultSinglePlayerSnapshot,
  validateSinglePlayerSnapshot,
} from "../client/singleplayer/localSave.ts";
import { collectMovedLocalDroppedItems } from "../client/singleplayer/localDroppedItems.ts";
import { BLOCK, type BlockId } from "../client/game/types.ts";
import { createEmptyInventory, type Inventory } from "../shared/game.ts";

function drop(id: string, y: number, settled = false): LocalDroppedItem {
  return {
    dropId: id,
    item: { itemId: "log", count: 1 },
    x: 0.5,
    y,
    z: 0.5,
    droppedAt: 1_000,
    velocityY: 0,
    settled,
  };
}

function blockWorld(entries: ReadonlyArray<readonly [number, BlockId]>) {
  const blocks = new Map(entries.map(([y, block]) => [`0:${y}:0`, block]));
  let reads = 0;
  return {
    blocks,
    read(x: number, y: number, z: number): BlockId {
      reads += 1;
      return blocks.get(`${x}:${y}:${z}`) ?? BLOCK.AIR;
    },
    reads: () => reads,
  };
}

function simulate(
  source: LocalDroppedItem,
  framesPerSecond: number,
  seconds: number,
  readBlock: (x: number, y: number, z: number) => BlockId,
): LocalDroppedItem {
  const drops = [{ ...source, item: { ...source.item } }];
  const active = new Set([0]);
  const clock = createLocalDropGravityClock();
  for (let frame = 0; frame < framesPerSecond * seconds; frame += 1) {
    advanceLocalDropGravity(drops, active, clock, 1 / framesPerSecond, readBlock);
  }
  return drops[0];
}

function simulateStationaryPickup(
  sourceInventory: Inventory,
  sourceDrops: LocalDroppedItem[],
  frames: number,
  readBlock: (x: number, y: number, z: number) => BlockId,
): { inventory: Inventory; drops: LocalDroppedItem[] } {
  let inventory = sourceInventory;
  let drops = sourceDrops.map((item) => ({ ...item, item: { ...item.item } }));
  const active = new Set<number>();
  const moved = new Set<number>();
  const clock = createLocalDropGravityClock();
  const pose = { x: 0.5, y: 1, z: 0.5 };
  rebuildActiveLocalDropIndices(drops, active, pose.x, pose.z, readBlock);
  for (let frame = 0; frame < frames; frame += 1) {
    const gravity = advanceLocalDropGravity(drops, active, clock, 1 / 60, readBlock, moved);
    if (!gravity.changed) continue;
    const collected = collectMovedLocalDroppedItems(inventory, drops, moved, pose);
    if (!collected.changed) continue;
    inventory = collected.inventory;
    drops = collected.drops;
    rebuildActiveLocalDropIndices(drops, active, pose.x, pose.z, readBlock);
  }
  return { inventory, drops };
}

const ground = blockWorld([[0, BLOCK.GRASS]]);
const fallenLog = simulate(drop("tree-top-log", 12), 60, 3, ground.read.bind(ground));
assert.equal(fallenLog.settled, true, "a mined top-of-tree log reaches ground");
assert.equal(fallenLog.y, 1);
assert.equal(fallenLog.velocityY, 0);

const ledge = blockWorld([[4, BLOCK.STONE], [0, BLOCK.STONE]]);
const caveDrop = simulate(drop("cave-ledge", 9), 60, 3, ledge.read.bind(ledge));
assert.equal(caveDrop.y, 5, "the highest crossed cave ledge catches the drop");

const slab = blockWorld([[2, BLOCK.STONE_BRICK_SLAB], [0, BLOCK.STONE]]);
const slabDrop = simulate(drop("slab", 7), 60, 3, slab.read.bind(slab));
assert.equal(localDropBlockSupportHeight(BLOCK.STONE_BRICK_SLAB), 0.5);
assert.equal(slabDrop.y, 2.5, "partial slab geometry supplies its authored half-height top");
assert.equal(localDroppedItemHasSupport(slabDrop, slab.read.bind(slab)), true);
const settledSlabDrops = [slabDrop];
const settledSlabActive = new Set<number>();
rebuildActiveLocalDropIndices(settledSlabDrops, settledSlabActive, 0, 0);
const settledSlabY = settledSlabDrops[0].y;
const settledSlabStats = advanceLocalDropGravity(
  settledSlabDrops,
  settledSlabActive,
  createLocalDropGravityClock(),
  1,
  slab.read.bind(slab),
);
assert.equal(settledSlabDrops[0].y, settledSlabY, "a settled partial-block drop does not jitter");
assert.equal(settledSlabStats.processedSteps, 0);

const closedDoor = blockWorld([[0, BLOCK.DOOR_CLOSED]]);
const doorDrop = simulate(drop("closed-door", 5), 60, 2, closedDoor.read.bind(closedDoor));
assert.equal(localDropBlockSupportHeight(BLOCK.DOOR_CLOSED), 1.9, "drop support matches the authored 1.9-block door mesh");
assert.equal(doorDrop.y, 1.9);

const tunnelWorld = blockWorld([[2, BLOCK.STONE]]);
const fastDrop = { ...drop("fast", 3.2), velocityY: -24 };
const tunneled = stepLocalDroppedItemGravity(fastDrop, 1 / 60, tunnelWorld.read.bind(tunnelWorld)).drop;
assert.equal(tunneled.settled, true, "terminal-speed swept collision cannot tunnel through one support block");
assert.equal(tunneled.y, 3);

for (const fps of [30, 60, 144]) {
  const world = blockWorld([[0, BLOCK.STONE]]);
  const result = simulate(drop(`fps-${fps}`, 20), fps, 1, world.read.bind(world));
  const referenceWorld = blockWorld([[0, BLOCK.STONE]]);
  const reference = simulate(drop("reference", 20), 60, 1, referenceWorld.read.bind(referenceWorld));
  assert.ok(Math.abs(result.y - reference.y) < 1e-9, `${fps} Hz uses the same fixed gravity trajectory`);
  assert.ok(Math.abs(result.velocityY - reference.velocityY) < 1e-9);
}

const stationaryPickup = simulateStationaryPickup(
  createEmptyInventory(),
  [{ ...drop("stationary-fall", 5), item: { itemId: "diamond", count: 3 } }],
  90,
  ground.read.bind(ground),
);
assert.equal(stationaryPickup.drops.length, 0, "a falling active drop is collected without a pose-change callback");
assert.equal(stationaryPickup.inventory.reduce((count, stack) =>
  count + (stack?.itemId === "diamond" ? stack.count : 0), 0), 3);

const fullInventory: Inventory = createEmptyInventory().map((): Inventory[number] => ({ itemId: "stone", count: 64 }));
const fullPickup = simulateStationaryPickup(
  fullInventory,
  [{ ...drop("full-fall", 5), item: { itemId: "diamond", count: 3 } }],
  90,
  ground.read.bind(ground),
);
assert.equal(fullPickup.drops[0].item.count, 3, "a full inventory leaves the complete moving stack in-world");
assert.deepEqual(fullPickup.inventory, fullInventory);

const partialInventory: Inventory = fullInventory.map((stack) => stack ? { ...stack } : null);
partialInventory[0] = { itemId: "diamond", count: 63 };
const partialPickup = simulateStationaryPickup(
  partialInventory,
  [{ ...drop("partial-fall", 5), item: { itemId: "diamond", count: 3 } }],
  90,
  ground.read.bind(ground),
);
assert.equal(partialPickup.inventory[0]?.count, 64);
assert.equal(partialPickup.drops[0].item.count, 2, "partial pickup retains the exact uncollected remainder");
assert.equal((partialPickup.inventory[0]?.count ?? 0) + partialPickup.drops[0].item.count, 66);

const multiplePickup = simulateStationaryPickup(
  createEmptyInventory(),
  [
    { ...drop("multi-a", 5), item: { itemId: "log", count: 2 } },
    { ...drop("multi-b", 5.5), x: 0.75, item: { itemId: "log", count: 3 } },
  ],
  120,
  ground.read.bind(ground),
);
assert.equal(multiplePickup.drops.length, 0);
assert.equal(multiplePickup.inventory.reduce((count, stack) =>
  count + (stack?.itemId === "log" ? stack.count : 0), 0), 5,
  "multiple moved drops are collected once with exact conservation");

const removedSupport = blockWorld([[0, BLOCK.STONE], [-4, BLOCK.STONE]]);
const unsupportedDrops = [drop("support-removal", 1, true)];
removedSupport.blocks.delete("0:0:0");
assert.equal(
  wakeUnsupportedLocalDroppedItems(unsupportedDrops, [{ x: 0, z: 0 }], removedSupport.read.bind(removedSupport)),
  1,
);
assert.equal(unsupportedDrops[0].settled, false, "removing support reactivates a settled drop");
const resumedActive = new Set<number>();
rebuildActiveLocalDropIndices(unsupportedDrops, resumedActive, 0, 0, removedSupport.read.bind(removedSupport));
const resumed = simulate(unsupportedDrops[0], 60, 2, removedSupport.read.bind(removedSupport));
assert.equal(resumed.y, -3, "a reactivated drop falls to the next solid support");

const snapshot = createDefaultSinglePlayerSnapshot(42, 2_000, "gravity-save");
snapshot.drops = [{
  ...drop("saved-moving", 7.25),
  item: { itemId: "diamond", count: 3 },
  velocityY: -3.5,
}];
const validated = validateSinglePlayerSnapshot(snapshot);
assert.equal(validated.ok, true);
if (!validated.ok) throw new Error(validated.path);
assert.deepEqual(validated.snapshot.drops[0], snapshot.drops[0], "save/reload preserves position, velocity, settled state, and count");

const legacySnapshot = createDefaultSinglePlayerSnapshot(42, 2_000, "legacy-gravity-save") as unknown as {
  drops: Array<Record<string, unknown>>;
};
legacySnapshot.drops = [{
  dropId: "legacy-drop",
  item: { itemId: "dirt", count: 7 },
  x: 8.5,
  y: 19.25,
  z: -2.5,
  droppedAt: 1_000,
}];
const legacy = validateSinglePlayerSnapshot(legacySnapshot);
assert.equal(legacy.ok, true);
if (!legacy.ok) throw new Error(legacy.path);
assert.deepEqual(
  legacy.snapshot.drops[0],
  { ...legacySnapshot.drops[0], velocityY: 0, settled: false },
  "legacy drops resume from their exact saved position without minting or teleporting",
);

const settledWorld = blockWorld([[0, BLOCK.STONE]]);
const settledDrops = Array.from({ length: 256 }, (_, index) => ({
  ...drop(`settled-${index}`, 1, true),
  x: (index % 8) + 0.5,
  z: (Math.floor(index / 8) % 8) + 0.5,
}));
const settledActive = new Set<number>();
rebuildActiveLocalDropIndices(settledDrops, settledActive, 4, 4);
const readsBeforeIdle = settledWorld.reads();
const idleStats = advanceLocalDropGravity(
  settledDrops,
  settledActive,
  createLocalDropGravityClock(),
  1,
  settledWorld.read.bind(settledWorld),
);
assert.deepEqual(
  { active: settledActive.size, processed: idleStats.processedSteps, reads: settledWorld.reads() - readsBeforeIdle },
  { active: 0, processed: 0, reads: 0 },
  "256 settled drops add no per-frame collision work",
);

const offscreen = [drop("offscreen", 20)];
const offscreenActive = new Set<number>();
rebuildActiveLocalDropIndices(offscreen, offscreenActive, 1_000, 1_000);
const offscreenStats = advanceLocalDropGravity(
  offscreen,
  offscreenActive,
  createLocalDropGravityClock(),
  1,
  ground.read.bind(ground),
);
assert.equal(offscreenStats.blockReads, 0, "unstreamed drops sleep without collision reads");
rebuildActiveLocalDropIndices(offscreen, offscreenActive, 0, 0);
assert.equal(offscreenActive.size, 1, "an unsettled drop resumes when its chunk streams back in");

const boundedDrops = [drop("catch-up", 30)];
const boundedStats = advanceLocalDropGravity(
  boundedDrops,
  new Set([0]),
  createLocalDropGravityClock(),
  60,
  ground.read.bind(ground),
);
assert.equal(boundedStats.substeps, LOCAL_DROP_MAX_SUBSTEPS, "long frames discard work beyond the catch-up cap");
assert.equal(boundedDrops[0].item.count, 1, "gravity never changes item identity or quantity");

const singlePlayer = readFileSync(new URL("../client/singleplayer/SinglePlayerApp.tsx", import.meta.url), "utf8");
const multiplayer = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");
const engineTypes = readFileSync(new URL("../client/game/types.ts", import.meta.url), "utf8");
const gravitySource = readFileSync(new URL("../client/singleplayer/localDropGravity.ts", import.meta.url), "utf8");
for (const sourceMarker of [
  "local_container_",
  "local_drop_",
  "plan.drops.map",
  "local_mine_",
  "appendLocalMobDeathDrops",
]) {
  assert.ok(singlePlayer.includes(sourceMarker), `${sourceMarker} remains wired into the local gravity collection`);
}
assert.ok((singlePlayer.match(/velocityY: 0/g) ?? []).length >= 4, "direct local drop creation starts with bounded zero velocity");
assert.ok((singlePlayer.match(/settled: false/g) ?? []).length >= 4, "direct local drop creation starts active");
assert.ok(singlePlayer.includes("onSimulationStep: (elapsedSeconds)"), "single-player owns the optional gravity clock");
assert.ok(singlePlayer.includes("collectMovedLocalDroppedItems(")
  && singlePlayer.indexOf("collectMovedLocalDroppedItems(") < singlePlayer.indexOf("onPointerLockChange:"),
  "the gravity tick checks moved drops even when stationary pose callbacks are idle");
assert.ok(singlePlayer.includes("wakeUnsupportedLocalDroppedItems"), "terrain edits and explosions can wake unsupported drops");
assert.equal(multiplayer.includes("localDropGravity"), false, "Lakebed multiplayer authority is unchanged");
assert.equal(multiplayer.includes("onSimulationStep:"), false, "multiplayer installs no local drop simulation");
assert.ok(engineTypes.includes("onSimulationStep?: (elapsedSeconds: number) => void"));
assert.equal(gravitySource.includes("setInterval"), false, "gravity adds no polling loop");

console.log("bounded deterministic local dropped-item gravity tests passed");
