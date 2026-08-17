import assert from "node:assert/strict";
import {
  SINGLEPLAYER_SAVE_HEAD_KEY,
  SINGLEPLAYER_GENERATOR_VERSION,
  SINGLEPLAYER_LEGACY_GENERATOR_VERSION,
  SINGLEPLAYER_SAVE_LIMITS,
  SINGLEPLAYER_SAVE_MAX_SLOT_CHARS,
  SINGLEPLAYER_SAVE_SLOT_A_KEY,
  SINGLEPLAYER_SAVE_SLOT_B_KEY,
  SINGLEPLAYER_SAVE_VERSION,
  canonicalSinglePlayerJson,
  createDefaultSinglePlayerSnapshot,
  loadSinglePlayerSave,
  resetSinglePlayerSave,
  saveSinglePlayerSnapshot,
  serializeSinglePlayerSave,
  unsupportedSinglePlayerSaveMessage,
  validateSinglePlayerSnapshot,
  type SinglePlayerSnapshot,
  type SinglePlayerStorageAdapter,
} from "../client/singleplayer/localSave.ts";
import { createMobSimulation, exportMobSimulationSnapshot } from "../client/game/mobs.ts";
import { VOXEL_RUNTIME_SNAPSHOT_VERSION } from "../client/game/types.ts";
import { singlePlayerStartsDead } from "../client/singleplayer/deathPresentation.ts";

class MemoryStorage implements SinglePlayerStorageAdapter {
  readonly values = new Map<string, string>();
  corruptWritesFor: string | null = null;
  failWritesFor: string | null = null;
  failReadsFor: string | null = null;
  failDeletesFor: string | null = null;
  readonly deleteAttempts: string[] = [];
  readonly operations: string[] = [];

  getItem(key: string): string | null {
    this.operations.push(`get:${key}`);
    if (this.failReadsFor === key) throw new Error("simulated read failure");
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.failWritesFor === key) throw new Error("simulated quota failure");
    this.values.set(key, this.corruptWritesFor === key ? `${value.slice(0, -1)}!` : value);
  }

  removeItem(key: string): void {
    this.deleteAttempts.push(key);
    this.operations.push(`remove:${key}`);
    if (this.failDeletesFor === key) throw new Error("simulated delete failure");
    this.values.delete(key);
  }
}

// Pre-coordinate-reset journals fail closed as an explicit, user-actionable
// unsupported format. They are never guessed, shifted, or overwritten.
{
  const storage = new MemoryStorage();
  storage.values.set(SINGLEPLAYER_SAVE_SLOT_A_KEY, JSON.stringify({
    format: "lakecraft.singleplayer",
    version: 1,
  }));
  const loaded = loadSinglePlayerSave(storage);
  assert.equal(SINGLEPLAYER_SAVE_VERSION, 2);
  assert.equal(loaded.status, "unsupported");
  if (loaded.status !== "unsupported") throw new Error(loaded.status);
  assert.deepEqual(loaded.versions, [1]);
  assert.match(unsupportedSinglePlayerSaveMessage(loaded.versions), /retired terrain coordinate system/);
  assert.match(unsupportedSinglePlayerSaveMessage(loaded.versions), /No data was changed/);
  assert.match(unsupportedSinglePlayerSaveMessage([99]), /newer Lakecraft version/);
}

// The base terrain version is independent of the journal envelope: existing
// version-2 worlds remain valid while fresh worlds opt into biome generation.
{
  assert.equal(createDefaultSinglePlayerSnapshot().world.generatorVersion, SINGLEPLAYER_GENERATOR_VERSION);
  const legacy = createDefaultSinglePlayerSnapshot();
  legacy.world.generatorVersion = SINGLEPLAYER_LEGACY_GENERATOR_VERSION;
  assert.equal(validateSinglePlayerSnapshot(legacy).ok, true);
}

function richSnapshot(): SinglePlayerSnapshot {
  const snapshot = createDefaultSinglePlayerSnapshot(42);
  snapshot.world.weather = { kind: "rain", remainingMs: 9_000 };
  snapshot.world.edits = [{ x: -4, y: 8, z: 19, block: 32 }];
  snapshot.player.inventory[0] = { itemId: "diamond_pickaxe", count: 1, durability: 812 };
  snapshot.player.equipment.head = { itemId: "iron_helmet", durability: 44 };
  snapshot.player.selectedHotbar = 0;
  snapshot.player.hunger = 8;
  snapshot.progression = { experience: 123, recipes: ["crafting_table", "torch"], advancements: ["stone_age"] };
  snapshot.drops = [{
    dropId: "local-drop-1",
    item: { itemId: "diamond", count: 2 },
    x: 2,
    y: 9,
    z: 3,
    droppedAt: 100,
    velocityY: -3.5,
    settled: false,
  }];
  snapshot.chests = [{ coordKey: "2:8:3", inventory: new Array(27).fill(null) }];
  snapshot.chests[0]!.inventory[4] = { itemId: "brick", count: 17 };
  snapshot.furnaces = [{
    coordKey: "4:8:3", input: { itemId: "raw_iron", count: 3 }, fuel: { itemId: "coal", count: 2 },
    output: { itemId: "iron_ingot", count: 1 }, burnRemainingMs: 4_500, cookProgressMs: 2_000, lastMaterializedAtMs: 500,
  }];
  const mobs = createMobSimulation([{
    id: "pig-1", kind: "pig", x: 7, y: 9, z: -2, yaw: 0.3,
    homeX: 7, homeZ: -2, behaviorSeed: 123,
  }]);
  snapshot.runtime = {
    version: VOXEL_RUNTIME_SNAPSHOT_VERSION,
    pose: { x: 1.25, y: 14, z: -9.5, yaw: 0.75, pitch: -0.2 },
    respawnPoint: { x: 3, y: 15, z: 7, yaw: -1, pitch: 0 },
    playerHealth: 13,
    worldTimeMs: 12_345,
    dayNight: { cycleLengthMs: 480_000, epochMs: 0, epochPhase: 0 },
    mobAccumulatorSeconds: 0.04,
    mobSimulation: exportMobSimulationSnapshot(mobs),
  };
  snapshot.primedTnt = [{ eventId: "tnt_1", x: 6, y: 8, z: 5, ignitedAt: 1_000, dueAt: 5_000 }];
  return snapshot;
}

// Full-state round trip, including every reserved integration surface.
{
  const storage = new MemoryStorage();
  const snapshot = richSnapshot();
  const saved = saveSinglePlayerSnapshot(storage, snapshot, 10_000);
  assert.equal(saved.ok, true);
  if (!saved.ok) throw new Error(saved.reason);
  assert.equal(saved.slot, "a");
  assert.equal(saved.sequence, 1);
  assert.ok(saved.chars < SINGLEPLAYER_SAVE_MAX_SLOT_CHARS);
  const loaded = loadSinglePlayerSave(storage);
  assert.equal(loaded.status, "loaded");
  if (loaded.status !== "loaded") throw new Error(loaded.status);
  assert.equal(loaded.sequence, 1);
  assert.deepEqual(loaded.snapshot, snapshot);
}

// A dead runtime survives the verified journal and must reopen the respawn UI after reload.
{
  const storage = new MemoryStorage();
  const snapshot = richSnapshot();
  snapshot.runtime!.playerHealth = 0;
  assert.equal(saveSinglePlayerSnapshot(storage, snapshot, 10_001).ok, true);
  const loaded = loadSinglePlayerSave(storage);
  assert.equal(loaded.status, "loaded");
  if (loaded.status !== "loaded") throw new Error(loaded.status);
  assert.equal(loaded.snapshot.runtime?.playerHealth, 0);
  assert.equal(singlePlayerStartsDead(loaded.snapshot.runtime?.playerHealth), true);
}

// The advisory head can be stale: the highest valid sequence still wins.
{
  const storage = new MemoryStorage();
  const first = richSnapshot();
  assert.equal(saveSinglePlayerSnapshot(storage, first, 1).ok, true);
  const second = richSnapshot();
  second.runtime!.playerHealth = 7;
  const saved = saveSinglePlayerSnapshot(storage, second, 2);
  assert.equal(saved.ok && saved.slot, "b");
  storage.values.set(SINGLEPLAYER_SAVE_HEAD_KEY, canonicalSinglePlayerJson({ sequence: 1, slot: "a" }));
  const loaded = loadSinglePlayerSave(storage);
  assert.equal(loaded.status, "recovered");
  if (loaded.status !== "recovered") throw new Error(loaded.status);
  assert.equal(loaded.slot, "b");
  assert.equal(loaded.sequence, 2);
  assert.equal(loaded.snapshot.runtime?.playerHealth, 7);
}

// A damaged newest slot falls back to the previous-good opposite slot.
{
  const storage = new MemoryStorage();
  const first = richSnapshot();
  assert.equal(saveSinglePlayerSnapshot(storage, first, 1).ok, true);
  const second = richSnapshot();
  second.player.hunger = 1;
  assert.equal(saveSinglePlayerSnapshot(storage, second, 2).ok, true);
  const newest = storage.values.get(SINGLEPLAYER_SAVE_SLOT_B_KEY)!;
  storage.values.set(SINGLEPLAYER_SAVE_SLOT_B_KEY, newest.replace(/"hunger":1/, '"hunger":2'));
  const loaded = loadSinglePlayerSave(storage);
  assert.equal(loaded.status, "recovered");
  if (loaded.status !== "recovered") throw new Error(loaded.status);
  assert.equal(loaded.slot, "a");
  assert.equal(loaded.snapshot.player.hunger, first.player.hunger);
  assert.ok(loaded.issues.some((issue) => issue.includes("checksum_mismatch")));
}

// No permissive reset when both journal slots contain data but neither validates.
{
  const storage = new MemoryStorage();
  storage.values.set(SINGLEPLAYER_SAVE_SLOT_A_KEY, "not json");
  storage.values.set(SINGLEPLAYER_SAVE_SLOT_B_KEY, "{}");
  const loaded = loadSinglePlayerSave(storage);
  assert.equal(loaded.status, "corrupt");
  if (loaded.status !== "corrupt") throw new Error(loaded.status);
  assert.equal(loaded.reason, "no_valid_snapshot");
}

// A clearly newer format is reported as unsupported instead of overwritten or normalized.
{
  const storage = new MemoryStorage();
  storage.values.set(SINGLEPLAYER_SAVE_SLOT_A_KEY, JSON.stringify({ format: "lakecraft.singleplayer", version: 99 }));
  const loaded = loadSinglePlayerSave(storage);
  assert.equal(loaded.status, "unsupported");
  if (loaded.status !== "unsupported") throw new Error(loaded.status);
  assert.deepEqual(loaded.versions, [99]);
}

// Interrupted/corrupt writes fail readback verification and leave the current opposite slot loadable.
{
  const storage = new MemoryStorage();
  const first = richSnapshot();
  assert.equal(saveSinglePlayerSnapshot(storage, first, 1).ok, true);
  const previousA = storage.values.get(SINGLEPLAYER_SAVE_SLOT_A_KEY);
  storage.corruptWritesFor = SINGLEPLAYER_SAVE_SLOT_B_KEY;
  const failed = saveSinglePlayerSnapshot(storage, richSnapshot(), 2);
  assert.deepEqual(failed, { ok: false, reason: "readback_failed", previousSequence: 1 });
  assert.equal(storage.values.get(SINGLEPLAYER_SAVE_SLOT_A_KEY), previousA, "the previous-good slot is never touched");
  const loaded = loadSinglePlayerSave(storage);
  assert.equal(loaded.status, "recovered");
  if (loaded.status !== "recovered") throw new Error(loaded.status);
  assert.equal(loaded.sequence, 1);
  assert.deepEqual(loaded.snapshot, first);
}

// Bounds are hard failures; the codec does not slice arrays, clamp coordinates, or repair durability.
{
  const tooManyEdits = richSnapshot();
  tooManyEdits.world.edits = new Array(SINGLEPLAYER_SAVE_LIMITS.edits + 1).fill({ x: 0, y: 0, z: 0, block: 1 });
  assert.deepEqual(validateSinglePlayerSnapshot(tooManyEdits), { ok: false, reason: "invalid_snapshot", path: "$.world.edits" });

  const badCoordinate = richSnapshot();
  badCoordinate.world.edits[0]!.x = SINGLEPLAYER_SAVE_LIMITS.worldCoordinate + 1;
  assert.equal(validateSinglePlayerSnapshot(badCoordinate).ok, false);

  const badDurability = richSnapshot();
  badDurability.player.inventory[0] = { itemId: "diamond_pickaxe", count: 1, durability: 0 };
  assert.deepEqual(validateSinglePlayerSnapshot(badDurability), { ok: false, reason: "invalid_snapshot", path: "$.player.inventory" });

  const badStack = richSnapshot();
  badStack.player.inventory[1] = { itemId: "diamond", count: 65 };
  assert.equal(validateSinglePlayerSnapshot(badStack).ok, false);

  const accumulatedYaw = richSnapshot();
  accumulatedYaw.runtime!.pose.yaw = Math.PI * 5;
  assert.deepEqual(validateSinglePlayerSnapshot(accumulatedYaw), {
    ok: false,
    reason: "invalid_snapshot",
    path: "$.runtime.pose.yaw",
  });
}

// Serialization/checksum output is deterministic even when runtime object keys were inserted in another order.
{
  const snapshot = richSnapshot();
  const reordered = JSON.parse(canonicalSinglePlayerJson(snapshot)) as SinglePlayerSnapshot;
  const first = serializeSinglePlayerSave(snapshot, 8, 90);
  const second = serializeSinglePlayerSave(reordered, 8, 90);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (!first.ok || !second.ok) throw new Error("fixtures must serialize");
  assert.equal(first.raw, second.raw);
  assert.equal(first.envelope.checksum, second.envelope.checksum);
}

// A valid state that exceeds the explicit slot budget is rejected before relying on quota exceptions.
{
  const huge = createDefaultSinglePlayerSnapshot();
  huge.world.edits = Array.from({ length: SINGLEPLAYER_SAVE_LIMITS.edits }, (_, index) => ({
    x: index, y: 2, z: -index, block: 32 as const,
  }));
  huge.chests = Array.from({ length: SINGLEPLAYER_SAVE_LIMITS.chests }, (_, index) => ({
    coordKey: `${index}:2:0`,
    inventory: Array.from({ length: 27 }, () => ({ itemId: "brick" as const, count: 64 })),
  }));
  huge.progression.recipes = Array.from({ length: SINGLEPLAYER_SAVE_LIMITS.progressionEntries }, (_, index) =>
    `recipe_${index}`.padEnd(SINGLEPLAYER_SAVE_LIMITS.identifierChars, "x"));
  huge.progression.advancements = Array.from({ length: SINGLEPLAYER_SAVE_LIMITS.progressionEntries }, (_, index) =>
    `advancement_${index}`.padEnd(SINGLEPLAYER_SAVE_LIMITS.identifierChars, "x"));
  const serialized = serializeSinglePlayerSave(huge, 1, 1);
  assert.deepEqual(serialized, { ok: false, reason: "too_large" });
}

// A synchronous storage failure is explicit and cannot erase a previous-good snapshot.
{
  const storage = new MemoryStorage();
  const first = richSnapshot();
  assert.equal(saveSinglePlayerSnapshot(storage, first, 1).ok, true);
  storage.failWritesFor = SINGLEPLAYER_SAVE_SLOT_B_KEY;
  assert.deepEqual(saveSinglePlayerSnapshot(storage, richSnapshot(), 2), {
    ok: false, reason: "storage_write_failed", previousSequence: 1,
  });
  storage.failWritesFor = null;
  const loaded = loadSinglePlayerSave(storage);
  assert.equal(loaded.status, "loaded");
  if (loaded.status !== "loaded") throw new Error(loaded.status);
  assert.deepEqual(loaded.snapshot, first);
}

// Corrupt worlds only become writable after an explicit, verified reset;
// unrelated browser keys are retained.
{
  const storage = new MemoryStorage();
  storage.values.set(SINGLEPLAYER_SAVE_SLOT_A_KEY, "not json");
  storage.values.set(SINGLEPLAYER_SAVE_SLOT_B_KEY, "{}");
  storage.values.set("lakecraft.settings.v1", "keep-me");
  assert.equal(loadSinglePlayerSave(storage).status, "corrupt");
  const reset = resetSinglePlayerSave(storage);
  assert.equal(reset.ok, true);
  if (!reset.ok) throw new Error(reset.reason);
  assert.deepEqual(new Set(reset.removedKeys), new Set([
    SINGLEPLAYER_SAVE_HEAD_KEY,
    SINGLEPLAYER_SAVE_SLOT_A_KEY,
    SINGLEPLAYER_SAVE_SLOT_B_KEY,
  ]));
  assert.equal(storage.values.get("lakecraft.settings.v1"), "keep-me");
  assert.equal(loadSinglePlayerSave(storage).status, "empty");
  assert.equal(saveSinglePlayerSnapshot(storage, richSnapshot(), 3).ok, true);
}

// A future-format world follows the same explicit recovery path and is never
// overwritten by an ordinary save attempt.
{
  const storage = new MemoryStorage();
  storage.values.set(SINGLEPLAYER_SAVE_SLOT_A_KEY, JSON.stringify({
    format: "lakecraft.singleplayer",
    version: 99,
  }));
  assert.equal(loadSinglePlayerSave(storage).status, "unsupported");
  assert.deepEqual(saveSinglePlayerSnapshot(storage, richSnapshot(), 4), {
    ok: false,
    reason: "unsafe_existing_data",
    previousSequence: 0,
  });
  assert.equal(resetSinglePlayerSave(storage).ok, true);
  assert.equal(loadSinglePlayerSave(storage).status, "empty");
}

// If reset is interrupted, the selected valid snapshot is removed last and
// remains loadable rather than being silently replaced by a new world.
{
  const storage = new MemoryStorage();
  const previousGood = richSnapshot();
  assert.equal(saveSinglePlayerSnapshot(storage, previousGood, 1).ok, true);
  storage.values.set(SINGLEPLAYER_SAVE_SLOT_B_KEY, "interrupted write");
  storage.failDeletesFor = SINGLEPLAYER_SAVE_SLOT_A_KEY;
  storage.operations.length = 0;
  assert.deepEqual(resetSinglePlayerSave(storage), {
    ok: false,
    reason: "storage_delete_failed",
    key: SINGLEPLAYER_SAVE_SLOT_A_KEY,
    mutationStarted: true,
  });
  assert.deepEqual(storage.operations, [
    `get:${SINGLEPLAYER_SAVE_SLOT_A_KEY}`,
    `get:${SINGLEPLAYER_SAVE_SLOT_B_KEY}`,
    `remove:${SINGLEPLAYER_SAVE_HEAD_KEY}`,
    `get:${SINGLEPLAYER_SAVE_HEAD_KEY}`,
    `remove:${SINGLEPLAYER_SAVE_SLOT_B_KEY}`,
    `get:${SINGLEPLAYER_SAVE_SLOT_B_KEY}`,
    `remove:${SINGLEPLAYER_SAVE_SLOT_A_KEY}`,
  ], "every non-selected deletion is verified before the selected valid slot is touched");
  const loaded = loadSinglePlayerSave(storage);
  assert.equal(loaded.status, "loaded");
  if (loaded.status !== "loaded") throw new Error(loaded.status);
  assert.deepEqual(loaded.snapshot, previousGood);
}

// An incomplete preliminary slot scan fails closed before any mutation. Even
// if later removals would have produced a destructive partial reset, the
// previous-good slot remains byte-for-byte intact.
{
  const storage = new MemoryStorage();
  const previousGood = richSnapshot();
  assert.equal(saveSinglePlayerSnapshot(storage, previousGood, 1).ok, true);
  const previousRaw = storage.values.get(SINGLEPLAYER_SAVE_SLOT_A_KEY);
  storage.values.set(SINGLEPLAYER_SAVE_SLOT_B_KEY, "interrupted write");
  storage.failReadsFor = SINGLEPLAYER_SAVE_SLOT_A_KEY;
  storage.failDeletesFor = SINGLEPLAYER_SAVE_SLOT_B_KEY;
  assert.deepEqual(resetSinglePlayerSave(storage), {
    ok: false,
    reason: "storage_read_failed",
    mutationStarted: false,
  });
  assert.deepEqual(storage.deleteAttempts, [], "failed preflight cannot attempt any deletion");
  assert.equal(storage.values.get(SINGLEPLAYER_SAVE_SLOT_A_KEY), previousRaw);
  assert.equal(storage.values.get(SINGLEPLAYER_SAVE_SLOT_B_KEY), "interrupted write");
  storage.failReadsFor = null;
  storage.failDeletesFor = null;
  const loaded = loadSinglePlayerSave(storage);
  assert.equal(loaded.status, "recovered");
  if (loaded.status !== "recovered") throw new Error(loaded.status);
  assert.deepEqual(loaded.snapshot, previousGood);
}

console.log("durable current-format single-player save journal roundtrip, recovery, bounds, determinism, and budget tests passed");
