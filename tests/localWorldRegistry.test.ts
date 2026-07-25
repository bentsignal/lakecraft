import assert from "node:assert/strict";
import {
  SINGLEPLAYER_LEGACY_SAVE_KEY,
  SINGLEPLAYER_SAVE_MAX_SLOT_CHARS,
  SINGLEPLAYER_SAVE_SLOT_A_KEY,
  SINGLEPLAYER_SAVE_SLOT_B_KEY,
  createDefaultSinglePlayerSnapshot,
  loadSinglePlayerSave,
  saveSinglePlayerSnapshot,
  singlePlayerWorldStorageKey,
  type SinglePlayerStorageAdapter,
} from "../client/singleplayer/localSave.ts";
import {
  LOCAL_WORLD_REGISTRY_SLOT_A_KEY,
  LOCAL_WORLD_REGISTRY_SLOT_B_KEY,
  createLocalWorld,
  deleteLocalWorld,
  deterministicLocalWorldSeed,
  importLegacyLocalWorld,
  inspectLegacyLocalWorld,
  inspectLocalWorld,
  listLocalWorlds,
  loadLocalWorldRegistry,
  normalizeLocalWorldName,
  resetLegacyLocalWorld,
  resetLocalWorldData,
  touchLocalWorld,
} from "../client/singleplayer/localWorldRegistry.ts";
import { BLOCK } from "../client/game/types.ts";

class MemoryStorage implements SinglePlayerStorageAdapter {
  values = new Map<string, string>();
  failReadsFor: string | null = null;
  failWritesFor: string | null = null;
  failDeletesFor: string | null = null;

  getItem(key: string): string | null {
    if (key === this.failReadsFor) throw new Error("read failed");
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (key === this.failWritesFor) throw new Error("write failed");
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    if (key === this.failDeletesFor) throw new Error("delete failed");
    this.values.delete(key);
  }
}

assert.equal(normalizeLocalWorldName("  Fern   Hollow  "), "Fern Hollow");
assert.equal(normalizeLocalWorldName(""), null);
assert.equal(normalizeLocalWorldName("x".repeat(49)), null);
assert.equal(deterministicLocalWorldSeed("Fern Hollow"), deterministicLocalWorldSeed("Fern Hollow"));
assert.equal(deterministicLocalWorldSeed("-42"), -42);
assert.notEqual(deterministicLocalWorldSeed("Fern Hollow"), deterministicLocalWorldSeed("Fern Valley"));

// Three worlds keep every snapshot-owned state family isolated.
{
  const storage = new MemoryStorage();
  const first = createLocalWorld(storage, { name: "Fern Hollow", seedText: "alpha", gameMode: "survival", now: 1_000 });
  const second = createLocalWorld(storage, { name: "Red Mesa", seedText: "beta", gameMode: "creative", now: 2_000 });
  const third = createLocalWorld(storage, { name: "Snow Fort", seedText: "gamma", gameMode: "survival", now: 3_000 });
  assert.ok(first.ok && second.ok && third.ok);
  assert.equal(new Set([first.world.id, second.world.id, third.world.id]).size, 3);

  const worlds = [first.world, second.world, third.world];
  for (let index = 0; index < worlds.length; index += 1) {
    const loaded = loadSinglePlayerSave(storage, { migrateLegacy: false, worldId: worlds[index].id });
    assert.ok(loaded.snapshot);
    const snapshot = loaded.snapshot;
    snapshot.world.edits = [{ x: index, y: 63, z: -index, block: BLOCK.BRICKS }];
    snapshot.world.gameMode = index === 1 ? "creative" : "survival";
    snapshot.player.inventory[0] = { itemId: index === 0 ? "apple" : index === 1 ? "diamond" : "coal", count: index + 1 };
    snapshot.chests = [{
      coordKey: `${index}:63:${-index}`,
      inventory: Array.from({ length: 27 }, (_, slot) => slot === 0
        ? { itemId: index === 0 ? "stick" : index === 1 ? "brick" : "feather", count: index + 1 }
        : null),
    }];
    assert.equal(saveSinglePlayerSnapshot(storage, snapshot, 10_000 + index, { worldId: worlds[index].id }).ok, true);
  }

  const snapshots = worlds.map(({ id }) => loadSinglePlayerSave(storage, { migrateLegacy: false, worldId: id }).snapshot!);
  assert.deepEqual(snapshots.map(({ world }) => world.edits[0].x), [0, 1, 2]);
  assert.deepEqual(snapshots.map(({ player }) => player.inventory[0]?.itemId), ["apple", "diamond", "coal"]);
  assert.deepEqual(snapshots.map(({ chests }) => chests[0].inventory[0]?.itemId), ["stick", "brick", "feather"]);
  assert.deepEqual(snapshots.map(({ world }) => world.gameMode), ["survival", "creative", "survival"]);

  // Corrupt and oversize one world without affecting either sibling.
  storage.values.set(singlePlayerWorldStorageKey(second.world.id, SINGLEPLAYER_SAVE_SLOT_A_KEY), "corrupt");
  storage.values.set(singlePlayerWorldStorageKey(second.world.id, SINGLEPLAYER_SAVE_SLOT_B_KEY), "x".repeat(SINGLEPLAYER_SAVE_MAX_SLOT_CHARS + 1));
  const list = listLocalWorlds(storage);
  assert.equal(list.worlds.length, 3);
  assert.equal(list.worlds.find(({ world }) => world.id === second.world.id)?.health, "corrupt");
  assert.equal(list.worlds.find(({ world }) => world.id === second.world.id)?.capacity, "exceeded");
  assert.equal(list.worlds.find(({ world }) => world.id === first.world.id)?.health, "healthy");
  assert.equal(list.worlds.find(({ world }) => world.id === third.world.id)?.health, "healthy");

  // Confirmed reset affects only the selected namespace.
  assert.equal(resetLocalWorldData(storage, second.world.id, 20_000).ok, true);
  const resetSecond = loadSinglePlayerSave(storage, { migrateLegacy: false, worldId: second.world.id });
  assert.ok(resetSecond.snapshot);
  assert.equal(resetSecond.snapshot.world.gameMode, "creative");
  assert.deepEqual(resetSecond.snapshot.world.edits, []);
  assert.equal(loadSinglePlayerSave(storage, { migrateLegacy: false, worldId: first.world.id }).snapshot?.player.inventory[0]?.itemId, "apple");

  // Search ordering metadata is pure registry state, not save state.
  assert.equal(touchLocalWorld(storage, first.world.id, 30_000).ok, true);
  assert.equal(listLocalWorlds(storage).worlds[0].world.id, first.world.id);

  assert.equal(deleteLocalWorld(storage, third.world.id, 40_000).ok, true);
  assert.equal(listLocalWorlds(storage).worlds.length, 2);
  assert.equal(loadSinglePlayerSave(storage, { migrateLegacy: false, worldId: third.world.id }).status, "empty");
}

// The registry itself recovers from an interrupted newest-slot write.
{
  const storage = new MemoryStorage();
  assert.equal(createLocalWorld(storage, { name: "One", seedText: "1", gameMode: "survival", now: 1 }).ok, true);
  assert.equal(createLocalWorld(storage, { name: "Two", seedText: "2", gameMode: "creative", now: 2 }).ok, true);
  const newestKey = storage.values.has(LOCAL_WORLD_REGISTRY_SLOT_B_KEY)
    ? LOCAL_WORLD_REGISTRY_SLOT_B_KEY
    : LOCAL_WORLD_REGISTRY_SLOT_A_KEY;
  storage.values.set(newestKey, "interrupted");
  const recovered = loadLocalWorldRegistry(storage);
  assert.equal(recovered.status, "recovered");
  assert.ok(recovered.registry && recovered.registry.worlds.length >= 1);
}

// Legacy data is inert until the explicit import or reset action.
{
  const storage = new MemoryStorage();
  const legacy = createDefaultSinglePlayerSnapshot(99, 100, "local-default");
  legacy.player.inventory[0] = { itemId: "diamond", count: 3 };
  assert.equal(saveSinglePlayerSnapshot(storage, legacy, 200).ok, true);
  assert.equal(inspectLegacyLocalWorld(storage).status, "available");
  assert.equal(loadLocalWorldRegistry(storage).status, "empty", "inspection never silently migrates legacy data");
  const imported = importLegacyLocalWorld(storage, { name: "Imported World", now: 300 });
  assert.ok(imported.ok);
  assert.equal(loadSinglePlayerSave(storage, { migrateLegacy: false, worldId: imported.world.id }).snapshot?.player.inventory[0]?.itemId, "diamond");
  assert.equal(inspectLegacyLocalWorld(storage).status, "available", "import preserves the source until explicit reset");
  assert.equal(resetLegacyLocalWorld(storage).ok, true);
  assert.equal(inspectLegacyLocalWorld(storage).status, "none");
  assert.ok(loadSinglePlayerSave(storage, { migrateLegacy: false, worldId: imported.world.id }).snapshot);
}

// The old one-key format also migrates only behind the explicit import action.
{
  const storage = new MemoryStorage();
  storage.values.set(SINGLEPLAYER_LEGACY_SAVE_KEY, JSON.stringify({
    inventory: createDefaultSinglePlayerSnapshot().player.inventory,
    equipment: createDefaultSinglePlayerSnapshot().player.equipment,
    selected: 2,
    hunger: 20,
    edits: [],
    drops: [],
  }));
  assert.equal(inspectLegacyLocalWorld(storage).status, "available");
  assert.equal(loadLocalWorldRegistry(storage).status, "empty");
  const imported = importLegacyLocalWorld(storage, { name: "Old World", now: 500 });
  assert.ok(imported.ok);
  assert.equal(imported.world.importedLegacy, true);
}

// Seeded create/touch/reset/delete histories preserve uniqueness and bounds.
{
  let randomState = 0x13579bdf;
  const random = () => {
    randomState = (Math.imul(randomState, 1_664_525) + 1_013_904_223) >>> 0;
    return randomState;
  };
  for (let history = 0; history < 200; history += 1) {
    const storage = new MemoryStorage();
    for (let step = 0; step < 80; step += 1) {
      const listed = listLocalWorlds(storage).worlds;
      const operation = random() % 4;
      if ((operation === 0 || listed.length === 0) && listed.length < 12) {
        createLocalWorld(storage, {
          name: `World ${history}-${step}`,
          seedText: String(random() | 0),
          gameMode: random() % 2 ? "survival" : "creative",
          now: history * 1_000 + step,
        });
      } else {
        const selected = listed[random() % listed.length].world;
        if (operation === 1) touchLocalWorld(storage, selected.id, history * 1_000 + step + 1);
        else if (operation === 2) resetLocalWorldData(storage, selected.id, history * 1_000 + step + 1);
        else deleteLocalWorld(storage, selected.id, history * 1_000 + step + 1);
      }
      const registry = loadLocalWorldRegistry(storage);
      assert.ok(registry.registry);
      assert.ok(registry.registry.worlds.length <= 12);
      assert.equal(new Set(registry.registry.worlds.map(({ id }) => id)).size, registry.registry.worlds.length);
    }
  }
}

console.log("local world registry isolation, recovery, legacy, capacity, and randomized history tests passed");
