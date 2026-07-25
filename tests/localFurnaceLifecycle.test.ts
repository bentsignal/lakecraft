import assert from "node:assert/strict";
import {
  materializeFurnace,
  type FurnaceState,
} from "../shared/furnaces.ts";
import {
  createEmptyInventory,
  type Inventory,
  type ItemStack,
} from "../shared/game.ts";
import {
  exportLocalContainersSnapshot,
  importLocalContainersSnapshot,
  materializeLocalFurnace,
  openLocalFurnace,
  recoverLocalContainerContents,
  transferLocalFurnaceFullStack,
  type LocalContainers,
} from "../client/singleplayer/localContainers.ts";

const COORD = "8:9:-4";
const START = 1_000;

function importedFurnaces(...furnaces: FurnaceState[]): LocalContainers {
  const imported = importLocalContainersSnapshot({ chests: [], furnaces });
  assert.equal(imported.ok, true);
  if (!imported.ok) throw new Error(imported.reason);
  return imported.containers;
}

function loadedFurnace(
  coordKey = COORD,
  lastMaterializedAtMs = START,
  inputCount = 3,
  output: ItemStack | null = null,
): FurnaceState {
  return {
    coordKey,
    input: { itemId: "raw_iron", count: inputCount },
    fuel: { itemId: "coal", count: 1 },
    output,
    burnRemainingMs: 0,
    cookProgressMs: 0,
    lastMaterializedAtMs,
  };
}

function furnaceAt(containers: LocalContainers, coordKey = COORD): FurnaceState {
  const state = containers.furnaces.get(coordKey);
  assert.ok(state);
  return state;
}

// Reopening is a canonical elapsed-time boundary. Each exact ten-second
// interval consumes one input and exposes one output immediately.
let progression = importedFurnaces(loadedFurnace());
for (const [now, inputCount, outputCount, progress] of [
  [START + 9_999, 3, 0, 9_999],
  [START + 10_000, 2, 1, 0],
  [START + 19_999, 2, 1, 9_999],
  [START + 20_000, 1, 2, 0],
  [START + 30_000, 0, 3, 0],
] as const) {
  const opened = openLocalFurnace(progression, COORD, now);
  assert.equal(opened.ok, true);
  if (!opened.ok) throw new Error(opened.reason);
  progression = opened.containers;
  assert.equal(opened.furnace.input?.count ?? 0, inputCount, `input at ${now}`);
  assert.equal(opened.furnace.output?.count ?? 0, outputCount, `output at ${now}`);
  assert.equal(opened.furnace.cookProgressMs, progress, `progress at ${now}`);
}
assert.deepEqual(
  [0, 1, 2, 3].map((seconds) => {
    const projected = materializeFurnace(loadedFurnace(), START + seconds * 10_000);
    assert.equal(projected.ok, true);
    return projected.ok ? projected.state.output?.count ?? 0 : -1;
  }),
  [0, 1, 2, 3],
  "visible pure projection has deterministic 0→1→2→3 output progression",
);

// Close/pause/reopen does not reset partial progress, and fuel exhaustion keeps
// the unfinished item without consuming it.
const partial = importedFurnaces({
  ...loadedFurnace(),
  input: { itemId: "raw_iron", count: 10 },
  fuel: null,
  burnRemainingMs: 5_000,
  cookProgressMs: 7_000,
});
const exhausted = materializeLocalFurnace(partial, COORD, START + 10_000);
assert.equal(exhausted.ok, true);
if (!exhausted.ok) throw new Error(exhausted.reason);
assert.deepEqual(exhausted.furnace.input, { itemId: "raw_iron", count: 9 });
assert.deepEqual(exhausted.furnace.output, { itemId: "iron_ingot", count: 1 });
assert.equal(exhausted.furnace.burnRemainingMs, 0);
assert.equal(exhausted.furnace.cookProgressMs, 2_000);
const reopenedExhausted = openLocalFurnace(exhausted.containers, COORD, START + 60_000);
assert.equal(reopenedExhausted.ok, true);
if (!reopenedExhausted.ok) throw new Error(reopenedExhausted.reason);
assert.deepEqual(reopenedExhausted.furnace, {
  ...exhausted.furnace,
  lastMaterializedAtMs: START + 60_000,
}, "elapsed time cannot consume input after fuel exhaustion");

// Full and incompatible output both block cooking while an already-lit fuel
// item burns down; neither case consumes queued fuel or input.
for (const output of [
  { itemId: "iron_ingot", count: 64 },
  { itemId: "glass", count: 2 },
] as ItemStack[]) {
  const blocked = importedFurnaces({
    ...loadedFurnace(),
    fuel: { itemId: "coal", count: 2 },
    output,
    burnRemainingMs: 50_000,
    cookProgressMs: 4_000,
  });
  const opened = openLocalFurnace(blocked, COORD, START + 60_000);
  assert.equal(opened.ok, true);
  if (!opened.ok) throw new Error(opened.reason);
  assert.deepEqual(opened.furnace.input, { itemId: "raw_iron", count: 3 });
  assert.deepEqual(opened.furnace.fuel, { itemId: "coal", count: 2 });
  assert.deepEqual(opened.furnace.output, output);
  assert.equal(opened.furnace.burnRemainingMs, 0);
  assert.equal(opened.furnace.cookProgressMs, 4_000);
}

// Save preparation advances every row once at a shared timestamp. Export,
// reload, and same-time replay are deterministic and idempotent.
const saveBase = 50_000;
const saveIron = loadedFurnace("1:8:1", saveBase, 3);
const saveSand: FurnaceState = {
  ...loadedFurnace("2:8:2", saveBase, 2),
  input: { itemId: "sand", count: 2 },
};
const saveMaterialized = exportLocalContainersSnapshot(
  importedFurnaces(saveIron, saveSand),
  saveBase + 30_000,
);
assert.equal(saveMaterialized.ok, true);
if (!saveMaterialized.ok) throw new Error(saveMaterialized.reason);
assert.deepEqual(furnaceAt(saveMaterialized.containers, "1:8:1").output, { itemId: "iron_ingot", count: 3 });
assert.deepEqual(furnaceAt(saveMaterialized.containers, "2:8:2").output, { itemId: "glass", count: 2 });
const saved = exportLocalContainersSnapshot(saveMaterialized.containers);
assert.equal(saved.ok, true);
if (!saved.ok) throw new Error(saved.reason);
const reloaded = importLocalContainersSnapshot(JSON.parse(JSON.stringify(saved.snapshot)));
assert.equal(reloaded.ok, true);
if (!reloaded.ok) throw new Error(reloaded.reason);
const replayedSave = exportLocalContainersSnapshot(reloaded.containers, saveBase + 30_000);
assert.equal(replayedSave.ok, true);
if (!replayedSave.ok) throw new Error(replayedSave.reason);
assert.deepEqual(replayedSave.snapshot, reloaded.snapshot);
const rejectedSaveClock = exportLocalContainersSnapshot(reloaded.containers, saveBase + 29_999);
assert.equal(rejectedSaveClock.ok, false);
if (!rejectedSaveClock.ok) assert.equal(rejectedSaveClock.reason, "invalid_time");
assert.deepEqual(
  furnaceAt(reloaded.containers, "1:8:1"),
  furnaceAt(saveMaterialized.containers, "1:8:1"),
  "a rejected save-time materialization leaves the canonical map untouched",
);

// Breaking materializes and recovers atomically. A capacity rejection preserves
// the exact pre-operation row so retrying cannot lose or duplicate contents.
const breakBase = importedFurnaces(loadedFurnace());
const fullPack: Inventory = Array.from({ length: 36 }, () => ({ itemId: "dirt", count: 64 }));
const blockedBreak = recoverLocalContainerContents(breakBase, COORD, fullPack, 0, START + 20_000);
assert.equal(blockedBreak.ok, false);
if (!blockedBreak.ok) {
  assert.equal(blockedBreak.reason, "no_capacity");
  assert.deepEqual(furnaceAt(blockedBreak.containers), loadedFurnace());
  assert.deepEqual(blockedBreak.inventory, fullPack);
}
const recoveredBreak = recoverLocalContainerContents(breakBase, COORD, fullPack, 2, START + 20_000);
assert.equal(recoveredBreak.ok, true);
if (!recoveredBreak.ok) throw new Error(recoveredBreak.reason);
assert.equal(recoveredBreak.containers.furnaces.has(COORD), false);
assert.deepEqual(recoveredBreak.overflow, [
  { itemId: "raw_iron", count: 1 },
  { itemId: "iron_ingot", count: 2 },
]);
assert.deepEqual(recoveredBreak.recovered, recoveredBreak.overflow);
const rollbackClock = recoverLocalContainerContents(breakBase, COORD, createEmptyInventory(), 3, START - 1);
assert.equal(rollbackClock.ok, false);
if (!rollbackClock.ok) {
  assert.equal(rollbackClock.reason, "invalid_time");
  assert.deepEqual(furnaceAt(rollbackClock.containers), loadedFurnace());
}

// Randomized local lifecycle histories alternate open, direct materialization,
// transfer attempts, and save/reload boundaries. Every local result must equal
// the pure shared reducer and preserve exact cook/fuel deltas.
let seed = 0x134f00d;
function randomInt(maximum: number): number {
  seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
  return seed % maximum;
}

for (let scenario = 0; scenario < 750; scenario += 1) {
  let now = 1_000_000 + scenario * 1_000_000;
  let state = loadedFurnace(COORD, now, 1 + randomInt(64));
  state = {
    ...state,
    fuel: { itemId: randomInt(2) === 0 ? "coal" : "charcoal", count: 1 + randomInt(8) },
    output: randomInt(5) === 0 ? { itemId: "glass", count: 1 + randomInt(63) }
      : randomInt(5) === 0 ? { itemId: "iron_ingot", count: 64 }
        : null,
  };
  let local = importedFurnaces(state);
  let player = createEmptyInventory();

  for (let step = 0; step < 12; step += 1) {
    now += randomInt(180_001);
    const before = furnaceAt(local);
    const expected = materializeFurnace(before, now);
    assert.equal(expected.ok, true, `scenario ${scenario} expected step ${step}`);
    if (!expected.ok) break;
    const advanced = randomInt(2) === 0
      ? openLocalFurnace(local, COORD, now)
      : materializeLocalFurnace(local, COORD, now);
    assert.equal(advanced.ok, true, `scenario ${scenario} local step ${step}`);
    if (!advanced.ok) break;
    local = advanced.containers;
    assert.deepEqual(advanced.furnace, expected.state, `scenario ${scenario} state step ${step}`);
    assert.equal(advanced.cooked, expected.cooked, `scenario ${scenario} cooked step ${step}`);
    assert.equal(advanced.fuelConsumed, expected.fuelConsumed, `scenario ${scenario} fuel step ${step}`);
    assert.equal(
      (before.input?.count ?? 0) - (advanced.furnace.input?.count ?? 0),
      advanced.cooked,
      `scenario ${scenario} exact input step ${step}`,
    );

    if (step % 3 === 1) {
      const snapshot = exportLocalContainersSnapshot(local);
      assert.equal(snapshot.ok, true);
      if (!snapshot.ok) break;
      const restored = importLocalContainersSnapshot(JSON.parse(JSON.stringify(snapshot.snapshot)));
      assert.equal(restored.ok, true);
      if (!restored.ok) break;
      local = restored.containers;
    }

    if (step % 4 === 3 && advanced.furnace.output) {
      const transfer = transferLocalFurnaceFullStack(local, COORD, player, { kind: "take_output" }, now);
      assert.equal(transfer.ok, true, `scenario ${scenario} output transfer step ${step}`);
      if (!transfer.ok) break;
      player = transfer.inventory;
      local = transfer.containers;
      assert.equal(furnaceAt(local).output, null);
    }
  }
}

console.log("local furnace open/save/reload/recovery lifecycle tests: ok (750 randomized histories)");
