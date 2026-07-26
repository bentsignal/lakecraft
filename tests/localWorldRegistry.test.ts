import assert from "node:assert/strict";
import {
  SINGLEPLAYER_LEGACY_SAVE_KEY,
  SINGLEPLAYER_SAVE_HEAD_KEY,
  SINGLEPLAYER_SAVE_MAX_SLOT_CHARS,
  SINGLEPLAYER_SAVE_SLOT_A_KEY,
  SINGLEPLAYER_SAVE_SLOT_B_KEY,
  SINGLEPLAYER_WORLD_SAVE_MAX_SLOT_CHARS,
  browserSinglePlayerStorage,
  createDefaultSinglePlayerSnapshot,
  loadSinglePlayerSave,
  resetSinglePlayerSave,
  saveSinglePlayerSnapshot,
  singlePlayerWorldStorageKey,
  singlePlayerWorldStorageKeys,
  type SinglePlayerStorageAdapter,
} from "../client/singleplayer/localSave.ts";
import {
  LOCAL_WORLD_CAPACITY_WARNING_CHARS,
  LOCAL_WORLD_CREATE_TRANSACTION_KEY,
  LOCAL_WORLD_DELETE_TRANSACTION_KEY,
  LOCAL_WORLD_NAMESPACE_BUDGET_CHARS,
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
  moveLocalWorldSelection,
  normalizeLocalWorldName,
  reconcileLocalWorldSelection,
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
  failReadAfterWriteFor: string | null = null;
  throwAfterWritesFor: string | null = null;
  replaceWritesFor = new Map<string, (value: string) => string>();
  afterWritesFor = new Map<string, () => void>();
  replaceDeletesFor = new Map<string, () => string>();
  failNextReadsFor = new Map<string, number>();

  getItem(key: string): string | null {
    if (key === this.failReadsFor) throw new Error("read failed");
    const remaining = this.failNextReadsFor.get(key) ?? 0;
    if (remaining > 0) {
      if (remaining === 1) this.failNextReadsFor.delete(key);
      else this.failNextReadsFor.set(key, remaining - 1);
      throw new Error("one-shot read failed");
    }
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (key === this.failWritesFor) throw new Error("write failed");
    this.values.set(key, value);
    const replace = this.replaceWritesFor.get(key);
    if (replace) {
      this.replaceWritesFor.delete(key);
      this.values.set(key, replace(value));
    }
    const afterWrite = this.afterWritesFor.get(key);
    if (afterWrite) {
      this.afterWritesFor.delete(key);
      afterWrite();
    }
    if (key === this.failReadAfterWriteFor) {
      this.failReadAfterWriteFor = null;
      this.failNextReadsFor.set(key, 1);
    }
    if (key === this.throwAfterWritesFor) {
      this.throwAfterWritesFor = null;
      throw new Error("write result lost after durable commit");
    }
  }

  removeItem(key: string): void {
    if (key === this.failDeletesFor) throw new Error("delete failed");
    const replacement = this.replaceDeletesFor.get(key);
    if (replacement) {
      this.replaceDeletesFor.delete(key);
      this.values.set(key, replacement());
      return;
    }
    this.values.delete(key);
  }
}

class QuotaStorage extends MemoryStorage {
  private readonly quotaChars: number;

  constructor(quotaChars: number) {
    super();
    this.quotaChars = quotaChars;
  }

  override setItem(key: string, value: string): void {
    const used = [...this.values.entries()].reduce(
      (total, [storedKey, storedValue]) => total + (storedKey === key ? 0 : storedKey.length + storedValue.length),
      key.length + value.length,
    );
    if (used > this.quotaChars) throw new Error("quota exceeded");
    super.setItem(key, value);
  }
}

function nextRegistryWriteKey(storage: MemoryStorage): string {
  const slots = [LOCAL_WORLD_REGISTRY_SLOT_A_KEY, LOCAL_WORLD_REGISTRY_SLOT_B_KEY]
    .flatMap((key) => {
      const raw = storage.values.get(key);
      if (!raw) return [];
      try {
        const sequence = (JSON.parse(raw) as { sequence?: unknown }).sequence;
        return typeof sequence === "number" ? [{ key, sequence }] : [];
      } catch {
        return [];
      }
    })
    .sort((left, right) => right.sequence - left.sequence);
  return slots[0]?.key === LOCAL_WORLD_REGISTRY_SLOT_A_KEY
    ? LOCAL_WORLD_REGISTRY_SLOT_B_KEY
    : LOCAL_WORLD_REGISTRY_SLOT_A_KEY;
}

assert.equal(normalizeLocalWorldName("  Fern   Hollow  "), "Fern Hollow");
assert.equal(normalizeLocalWorldName(""), null);
assert.equal(normalizeLocalWorldName("x".repeat(49)), null);
assert.equal(deterministicLocalWorldSeed("Fern Hollow"), deterministicLocalWorldSeed("Fern Hollow"));
assert.equal(deterministicLocalWorldSeed("-42"), -42);
assert.notEqual(deterministicLocalWorldSeed("Fern Hollow"), deterministicLocalWorldSeed("Fern Valley"));

// Filtering clears hidden selection, and the roving listbox model implements
// the complete non-wrapping Arrow/Home/End keyboard contract.
{
  const ids = ["world-a", "world-b", "world-c"];
  assert.equal(reconcileLocalWorldSelection("world-b", ids), "world-b");
  assert.equal(reconcileLocalWorldSelection("world-a", ["world-b"]), null);
  assert.equal(moveLocalWorldSelection(null, ids, "ArrowDown"), "world-a");
  assert.equal(moveLocalWorldSelection(null, ids, "ArrowUp"), "world-c");
  assert.equal(moveLocalWorldSelection("world-b", ids, "ArrowDown"), "world-c");
  assert.equal(moveLocalWorldSelection("world-c", ids, "ArrowDown"), "world-c");
  assert.equal(moveLocalWorldSelection("world-b", ids, "ArrowUp"), "world-a");
  assert.equal(moveLocalWorldSelection("world-a", ids, "ArrowUp"), "world-a");
  assert.equal(moveLocalWorldSelection("world-b", ids, "Home"), "world-a");
  assert.equal(moveLocalWorldSelection("world-b", ids, "End"), "world-c");
  assert.equal(moveLocalWorldSelection("world-b", [], "End"), null);
}

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
    snapshot.furnaces = [{
      coordKey: `${index + 10}:63:${-index}`,
      input: { itemId: "raw_iron", count: index + 1 },
      fuel: { itemId: "coal", count: 1 },
      output: index === 0 ? null : { itemId: "iron_ingot", count: index },
      burnRemainingMs: index * 1_000,
      cookProgressMs: index * 500,
      lastMaterializedAtMs: 9_000 + index,
    }];
    assert.equal(saveSinglePlayerSnapshot(storage, snapshot, 10_000 + index, { worldId: worlds[index].id }).ok, true);
  }

  const snapshots = worlds.map(({ id }) => loadSinglePlayerSave(storage, { migrateLegacy: false, worldId: id }).snapshot!);
  assert.deepEqual(snapshots.map(({ world }) => world.edits[0].x), [0, 1, 2]);
  assert.deepEqual(snapshots.map(({ player }) => player.inventory[0]?.itemId), ["apple", "diamond", "coal"]);
  assert.deepEqual(snapshots.map(({ chests }) => chests[0].inventory[0]?.itemId), ["stick", "brick", "feather"]);
  assert.deepEqual(snapshots.map(({ furnaces }) => furnaces[0].input?.count), [1, 2, 3]);
  assert.deepEqual(snapshots.map(({ furnaces }) => furnaces[0].output?.count ?? 0), [0, 1, 2]);
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

// Create establishes a checksummed intent before touching a world namespace.
// A definite prewrite exception leaves no orphan, and retry keeps the exact
// requested identity without consuming an extra registry slot.
{
  const storage = new MemoryStorage();
  storage.failWritesFor = LOCAL_WORLD_CREATE_TRANSACTION_KEY;
  const input = { name: "Prewrite Create", seedText: "prewrite", gameMode: "creative" as const, now: 101 };
  const failed = createLocalWorld(storage, input);
  assert.deepEqual(failed, {
    ok: false,
    reason: "world_create_transaction_failed",
    mutationStarted: true,
  });
  assert.equal(loadLocalWorldRegistry(storage).registry?.worlds.length, 0);
  assert.equal([...storage.values.keys()].some((key) => key.includes(".save.")), false);
  storage.failWritesFor = null;
  const retried = createLocalWorld(storage, input);
  assert.ok(retried.ok);
  assert.equal(retried.world.name, input.name);
  assert.equal(retried.world.seed, deterministicLocalWorldSeed(input.seedText));
  assert.equal(retried.world.initialGameMode, input.gameMode);
  assert.equal(retried.world.createdAt, input.now);
}

// Both a lost marker acknowledgement and a lost registry acknowledgement are
// reconciled at the registry commit point. The former never reaches namespace
// writes; the latter returns the already-created world on an identical retry.
{
  const markerStorage = new MemoryStorage();
  markerStorage.throwAfterWritesFor = LOCAL_WORLD_CREATE_TRANSACTION_KEY;
  const markerInput = { name: "Marker Durable", seedText: "marker-durable", gameMode: "survival" as const, now: 102 };
  assert.deepEqual(createLocalWorld(markerStorage, markerInput), {
    ok: false,
    reason: "world_create_transaction_pending",
    mutationStarted: true,
  });
  assert.equal(markerStorage.values.has(LOCAL_WORLD_CREATE_TRANSACTION_KEY), true);
  assert.equal([...markerStorage.values.keys()].some((key) => key.includes(".save.")), false);
  assert.ok(loadLocalWorldRegistry(markerStorage).issues.includes("create:cleanup_completed"));
  assert.equal(markerStorage.values.has(LOCAL_WORLD_CREATE_TRANSACTION_KEY), false);

  const registryStorage = new MemoryStorage();
  const registryInput = { name: "Registry Durable", seedText: "registry-durable", gameMode: "creative" as const, now: 103 };
  registryStorage.throwAfterWritesFor = nextRegistryWriteKey(registryStorage);
  const ambiguous = createLocalWorld(registryStorage, registryInput);
  assert.deepEqual(ambiguous, {
    ok: false,
    reason: "registry_storage_write_failed_transaction_pending",
    mutationStarted: true,
  });
  assert.equal(registryStorage.values.has(LOCAL_WORLD_CREATE_TRANSACTION_KEY), true);
  const recovered = loadLocalWorldRegistry(registryStorage);
  assert.ok(recovered.issues.includes("create:commit_completed"));
  assert.equal(recovered.registry?.worlds.length, 1);
  const replayed = createLocalWorld(registryStorage, registryInput);
  assert.ok(replayed.ok);
  assert.equal(replayed.world.id, recovered.registry?.worlds[0].id);
  assert.equal(loadLocalWorldRegistry(registryStorage).registry?.worlds.length, 1);
}

// Registry readback loss covers both alternating slots. A durable write rolls
// forward, while a competing-tab replacement rolls back only the intended
// namespace and conserves every sibling byte.
for (const mode of ["read_throw", "tab_replace"] as const) {
  const storage = new MemoryStorage();
  const sibling = createLocalWorld(storage, {
    name: `Create Sibling ${mode}`,
    seedText: `sibling-${mode}`,
    gameMode: "survival",
    now: 110,
  });
  assert.ok(sibling.ok);
  const siblingKeys = singlePlayerWorldStorageKeys(sibling.world.id);
  const siblingValues = siblingKeys.map((key) => storage.values.get(key) ?? null);
  const target = nextRegistryWriteKey(storage);
  if (mode === "read_throw") {
    storage.failReadAfterWriteFor = target;
  } else {
    const authoritative = target === LOCAL_WORLD_REGISTRY_SLOT_A_KEY
      ? storage.values.get(LOCAL_WORLD_REGISTRY_SLOT_B_KEY)
      : storage.values.get(LOCAL_WORLD_REGISTRY_SLOT_A_KEY);
    assert.ok(authoritative);
    storage.replaceWritesFor.set(target, () => authoritative);
  }
  const input = { name: `Ambiguous ${mode}`, seedText: mode, gameMode: "creative" as const, now: 111 };
  const ambiguous = createLocalWorld(storage, input);
  assert.ok(!ambiguous.ok && ambiguous.reason === "registry_readback_failed_transaction_pending");
  const pendingRaw = storage.values.get(LOCAL_WORLD_CREATE_TRANSACTION_KEY);
  assert.ok(pendingRaw);
  const intendedId = (JSON.parse(pendingRaw) as { world: { id: string } }).world.id;
  assert.ok(singlePlayerWorldStorageKeys(intendedId).some((key) => storage.values.has(key)));
  const recovered = loadLocalWorldRegistry(storage);
  if (mode === "read_throw") {
    assert.ok(recovered.issues.includes("create:commit_completed"));
    assert.ok(recovered.registry?.worlds.some(({ id }) => id === intendedId));
  } else {
    assert.ok(recovered.issues.includes("create:cleanup_completed"));
    assert.deepEqual(singlePlayerWorldStorageKeys(intendedId).map((key) => storage.values.get(key) ?? null),
      [null, null, null, null]);
  }
  assert.deepEqual(siblingKeys.map((key) => storage.values.get(key) ?? null), siblingValues);
}

// Corrupt or interleaved markers are opaque: recovery may clear the global
// marker but can never derive a namespace mutation from untrusted identity.
{
  const storage = new MemoryStorage();
  const sibling = createLocalWorld(storage, { name: "Marker Guard", seedText: "guard", gameMode: "survival", now: 120 });
  assert.ok(sibling.ok);
  const siblingKeys = singlePlayerWorldStorageKeys(sibling.world.id);
  const siblingValues = siblingKeys.map((key) => storage.values.get(key) ?? null);
  storage.values.set(LOCAL_WORLD_CREATE_TRANSACTION_KEY, `{"world":{"id":"${sibling.world.id}"}}`);
  storage.failDeletesFor = LOCAL_WORLD_CREATE_TRANSACTION_KEY;
  for (let retry = 0; retry < 2; retry += 1) {
    const pending = loadLocalWorldRegistry(storage);
    assert.ok(pending.issues.includes("create:invalid_transaction_pending"));
    assert.deepEqual(siblingKeys.map((key) => storage.values.get(key) ?? null), siblingValues);
    assert.deepEqual(createLocalWorld(storage, {
      name: "Blocked Nested Create",
      seedText: "blocked",
      gameMode: "creative",
      now: 121,
    }), { ok: false, reason: "world_create_recovery_pending", mutationStarted: false });
  }
  storage.failDeletesFor = null;
  assert.ok(loadLocalWorldRegistry(storage).issues.includes("create:invalid_transaction_cleared"));
  assert.deepEqual(siblingKeys.map((key) => storage.values.get(key) ?? null), siblingValues);
}

// A second tab can replace the marker between setItem and readback. Because the
// attempted create has not written its namespace yet, recovery follows only
// the replacement's valid identity and leaves existing worlds byte-exact.
{
  const donor = new MemoryStorage();
  donor.failWritesFor = nextRegistryWriteKey(donor);
  assert.equal(createLocalWorld(donor, {
    name: "Other Tab Intent",
    seedText: "other-tab",
    gameMode: "creative",
    now: 125,
  }).ok, false);
  const otherIntent = donor.values.get(LOCAL_WORLD_CREATE_TRANSACTION_KEY);
  assert.ok(otherIntent);

  const storage = new MemoryStorage();
  const sibling = createLocalWorld(storage, { name: "Tab Sibling", seedText: "tab-sibling", gameMode: "survival", now: 124 });
  assert.ok(sibling.ok);
  const siblingKeys = singlePlayerWorldStorageKeys(sibling.world.id);
  const siblingValues = siblingKeys.map((key) => storage.values.get(key) ?? null);
  storage.replaceWritesFor.set(LOCAL_WORLD_CREATE_TRANSACTION_KEY, () => otherIntent);
  assert.deepEqual(createLocalWorld(storage, {
    name: "Losing Tab",
    seedText: "losing-tab",
    gameMode: "survival",
    now: 126,
  }), { ok: false, reason: "world_create_transaction_pending", mutationStarted: true });
  const siblingKeySet = new Set(siblingKeys);
  assert.ok([...storage.values.keys()].filter((key) => key.includes(".save."))
    .every((key) => siblingKeySet.has(key)));
  assert.ok(loadLocalWorldRegistry(storage).issues.includes("create:cleanup_completed"));
  assert.deepEqual(siblingKeys.map((key) => storage.values.get(key) ?? null), siblingValues);
}

// A definitely uncommitted registry write leaves a complete namespace only
// while its valid intent is pending. Repeated failed cleanup is bounded to that
// namespace; successful recovery restores capacity and permits one exact retry.
{
  const storage = new MemoryStorage();
  const sibling = createLocalWorld(storage, { name: "Capacity Sibling", seedText: "capacity-sibling", gameMode: "survival", now: 130 });
  assert.ok(sibling.ok);
  const siblingKeys = singlePlayerWorldStorageKeys(sibling.world.id);
  const siblingValues = siblingKeys.map((key) => storage.values.get(key) ?? null);
  const target = nextRegistryWriteKey(storage);
  storage.failWritesFor = target;
  const input = { name: "Cleanup Retry", seedText: "cleanup-retry", gameMode: "creative" as const, now: 131 };
  const failed = createLocalWorld(storage, input);
  assert.ok(!failed.ok && failed.reason === "registry_storage_write_failed_transaction_pending");
  const transaction = JSON.parse(storage.values.get(LOCAL_WORLD_CREATE_TRANSACTION_KEY)!) as { world: { id: string } };
  const intendedKeys = singlePlayerWorldStorageKeys(transaction.world.id);
  storage.failWritesFor = null;
  storage.failDeletesFor = intendedKeys[1];
  for (let retry = 0; retry < 2; retry += 1) {
    assert.ok(loadLocalWorldRegistry(storage).issues.includes("create:recovery_pending"));
    assert.equal(storage.values.has(LOCAL_WORLD_CREATE_TRANSACTION_KEY), true);
    assert.deepEqual(siblingKeys.map((key) => storage.values.get(key) ?? null), siblingValues);
  }
  storage.failDeletesFor = null;
  assert.ok(loadLocalWorldRegistry(storage).issues.includes("create:cleanup_completed"));
  assert.deepEqual(intendedKeys.map((key) => storage.values.get(key) ?? null), [null, null, null, null]);
  const retried = createLocalWorld(storage, input);
  assert.ok(retried.ok);
  assert.equal(loadLocalWorldRegistry(storage).registry?.worlds.length, 2);
  assert.equal(storage.values.has(LOCAL_WORLD_CREATE_TRANSACTION_KEY), false);
  assert.deepEqual(siblingKeys.map((key) => storage.values.get(key) ?? null), siblingValues);
}

// Failure to clear a committed marker never turns a successful create into a
// duplicate-prone error. Loads remain fail-closed until removal verifies.
{
  const storage = new MemoryStorage();
  storage.failDeletesFor = LOCAL_WORLD_CREATE_TRANSACTION_KEY;
  const input = { name: "Clear Pending", seedText: "clear-pending", gameMode: "survival" as const, now: 132 };
  const created = createLocalWorld(storage, input);
  assert.ok(created.ok);
  assert.equal(storage.values.has(LOCAL_WORLD_CREATE_TRANSACTION_KEY), true);
  assert.ok(loadLocalWorldRegistry(storage).issues.includes("create:recovery_pending"));
  assert.deepEqual(resetLocalWorldData(storage, created.world.id, 133), {
    ok: false,
    reason: "world_reset_recovery_pending",
    mutationStarted: false,
  });
  assert.deepEqual(deleteLocalWorld(storage, created.world.id, 133), {
    ok: false,
    reason: "world_delete_recovery_pending",
    mutationStarted: false,
  });
  assert.deepEqual(importLegacyLocalWorld(storage, { name: "Blocked By Create", now: 133 }), {
    ok: false,
    reason: "world_import_recovery_pending",
    mutationStarted: false,
  });
  const replayed = createLocalWorld(storage, input);
  assert.ok(replayed.ok);
  assert.equal(replayed.world.id, created.world.id);
  assert.equal(loadLocalWorldRegistry(storage).registry?.worlds.length, 1);
  storage.failDeletesFor = null;
  assert.ok(loadLocalWorldRegistry(storage).issues.includes("create:commit_completed"));
  assert.equal(storage.values.has(LOCAL_WORLD_CREATE_TRANSACTION_KEY), false);
}

// An unresolved delete owns its world ID generation until cleanup verifies.
// A replacement with the same deterministic ID, plus reset/delete/import from
// sibling flows, must wait so old journal bytes can never overwrite new state.
{
  const storage = new MemoryStorage();
  const sibling = createLocalWorld(storage, {
    name: "Generation Sibling",
    seedText: "generation-sibling",
    gameMode: "creative",
    now: 139,
  });
  const old = createLocalWorld(storage, {
    name: "Old Generation",
    seedText: "reused-generation",
    gameMode: "survival",
    now: 140,
  });
  assert.ok(sibling.ok && old.ok);
  const oldId = old.world.id;
  const oldHead = singlePlayerWorldStorageKey(oldId, SINGLEPLAYER_SAVE_HEAD_KEY);
  const siblingBefore = loadSinglePlayerSave(storage, {
    migrateLegacy: false,
    worldId: sibling.world.id,
  }).snapshot;
  storage.failDeletesFor = oldHead;
  assert.deepEqual(deleteLocalWorld(storage, oldId, 141), {
    ok: false,
    reason: "world_delete_cleanup_pending",
    mutationStarted: true,
  });
  assert.ok(loadLocalWorldRegistry(storage).issues.includes("delete:recovery_pending"));
  const replacementInput = {
    name: "Replacement Generation",
    seedText: "reused-generation",
    gameMode: "creative" as const,
    now: 140,
  };
  assert.deepEqual(createLocalWorld(storage, replacementInput), {
    ok: false,
    reason: "world_create_recovery_pending",
    mutationStarted: false,
  });
  assert.deepEqual(resetLocalWorldData(storage, sibling.world.id, 142), {
    ok: false,
    reason: "world_reset_recovery_pending",
    mutationStarted: false,
  });
  assert.deepEqual(deleteLocalWorld(storage, sibling.world.id, 142), {
    ok: false,
    reason: "world_delete_recovery_pending",
    mutationStarted: false,
  });
  assert.deepEqual(importLegacyLocalWorld(storage, { name: "Blocked Import", now: 142 }), {
    ok: false,
    reason: "world_import_recovery_pending",
    mutationStarted: false,
  });
  assert.deepEqual(loadSinglePlayerSave(storage, {
    migrateLegacy: false,
    worldId: sibling.world.id,
  }).snapshot, siblingBefore, "pending cleanup leaves sibling play state readable and byte-equivalent");

  // Simulate a later restart after the transient deletion fault clears.
  storage.failDeletesFor = null;
  assert.ok(loadLocalWorldRegistry(storage).issues.includes("delete:cleanup_completed"));
  const replacement = createLocalWorld(storage, replacementInput);
  assert.ok(replacement.ok);
  assert.equal(replacement.world.id, oldId);
  assert.equal(replacement.world.initialGameMode, "creative");
  const replacementSave = loadSinglePlayerSave(storage, { migrateLegacy: false, worldId: oldId });
  assert.equal(replacementSave.snapshot?.world.worldId, oldId);
  assert.equal(replacementSave.snapshot?.world.gameMode, "creative");
  assert.equal(loadLocalWorldRegistry(storage).registry?.worlds
    .find(({ id }) => id === oldId)?.initialGameMode, "creative");
  assert.equal(storage.values.has(LOCAL_WORLD_DELETE_TRANSACTION_KEY), false);
}

// Finalization is conditional on the exact marker snapshot. If another tab
// installs a valid create after this tab's marker readback, successful commit
// cannot erase the replacement or its namespace; the next load reconciles it.
{
  const other = new MemoryStorage();
  other.failWritesFor = nextRegistryWriteKey(other);
  assert.equal(createLocalWorld(other, {
    name: "Concurrent B",
    seedText: "concurrent-b",
    gameMode: "creative",
    now: 151,
  }).ok, false);
  const otherRaw = other.values.get(LOCAL_WORLD_CREATE_TRANSACTION_KEY);
  assert.ok(otherRaw);
  const otherId = (JSON.parse(otherRaw) as { world: { id: string } }).world.id;
  const otherKeys = singlePlayerWorldStorageKeys(otherId);

  const storage = new MemoryStorage();
  storage.afterWritesFor.set(LOCAL_WORLD_REGISTRY_SLOT_A_KEY, () => {
    storage.values.set(LOCAL_WORLD_CREATE_TRANSACTION_KEY, otherRaw);
    for (const key of otherKeys) {
      const value = other.values.get(key);
      if (value !== undefined) storage.values.set(key, value);
    }
  });
  const first = createLocalWorld(storage, {
    name: "Concurrent A",
    seedText: "concurrent-a",
    gameMode: "survival",
    now: 150,
  });
  assert.ok(first.ok);
  assert.equal(storage.values.get(LOCAL_WORLD_CREATE_TRANSACTION_KEY), otherRaw,
    "A cannot blindly clear B's later marker");
  assert.ok(otherKeys.some((key) => storage.values.has(key)));
  const recovered = loadLocalWorldRegistry(storage);
  assert.ok(recovered.issues.includes("create:cleanup_completed"));
  assert.ok(recovered.registry?.worlds.some(({ id }) => id === first.world.id));
  assert.deepEqual(otherKeys.map((key) => storage.values.get(key) ?? null), [null, null, null, null]);
}

// Even quarantine and remove/readback ambiguity preserve a replacement marker.
// Both create and delete use this same identity-conditional clear primitive.
for (const key of [LOCAL_WORLD_CREATE_TRANSACTION_KEY, LOCAL_WORLD_DELETE_TRANSACTION_KEY]) {
  const storage = new MemoryStorage();
  storage.values.set(key, "{");
  storage.replaceDeletesFor.set(key, () => "[");
  const first = loadLocalWorldRegistry(storage);
  assert.ok(first.issues.some((issue) => issue.includes("invalid_transaction_pending")));
  assert.equal(storage.values.get(key), "[");
  const second = loadLocalWorldRegistry(storage);
  assert.ok(second.issues.some((issue) => issue.includes("invalid_transaction_cleared")));
  assert.equal(storage.values.has(key), false);
}

// Capacity is a deterministic per-namespace calculation. Unrelated origin
// data and sibling saves cannot taint a world's status, while the registry's
// own two-slot footprint is apportioned across the listed worlds.
{
  const storage = new MemoryStorage();
  const first = createLocalWorld(storage, { name: "Capacity A", seedText: "a", gameMode: "survival", now: 1 });
  const second = createLocalWorld(storage, { name: "Capacity B", seedText: "b", gameMode: "creative", now: 2 });
  assert.ok(first.ok && second.ok);
  const before = listLocalWorlds(storage);
  const firstBefore = before.worlds.find(({ world }) => world.id === first.world.id)!;
  storage.values.set("unrelated.application.payload", "x".repeat(LOCAL_WORLD_NAMESPACE_BUDGET_CHARS * 4));
  const afterUnrelated = listLocalWorlds(storage);
  const firstAfterUnrelated = afterUnrelated.worlds.find(({ world }) => world.id === first.world.id)!;
  assert.equal(firstAfterUnrelated.usedChars, firstBefore.usedChars);
  assert.equal(firstAfterUnrelated.capacity, firstBefore.capacity);

  const registryChars = [LOCAL_WORLD_REGISTRY_SLOT_A_KEY, LOCAL_WORLD_REGISTRY_SLOT_B_KEY]
    .reduce((total, key) => total + (storage.values.has(key) ? key.length + storage.values.get(key)!.length : 0), 0);
  const namespaceChars = singlePlayerWorldStorageKeys(first.world.id)
    .reduce((total, key) => total + (storage.values.has(key) ? key.length + storage.values.get(key)!.length : 0), 0);
  assert.equal(firstAfterUnrelated.usedChars, namespaceChars + Math.ceil(registryChars / 2));

  const firstLegacyKey = singlePlayerWorldStorageKey(first.world.id, SINGLEPLAYER_LEGACY_SAVE_KEY);
  storage.values.set(firstLegacyKey, "x".repeat(LOCAL_WORLD_CAPACITY_WARNING_CHARS));
  const warningList = listLocalWorlds(storage);
  assert.equal(warningList.worlds.find(({ world }) => world.id === first.world.id)?.capacity, "warning");
  assert.equal(warningList.worlds.find(({ world }) => world.id === second.world.id)?.capacity, "ok");
  storage.values.set(firstLegacyKey, "x".repeat(LOCAL_WORLD_NAMESPACE_BUDGET_CHARS));
  assert.equal(
    listLocalWorlds(storage).worlds.find(({ world }) => world.id === first.world.id)?.capacity,
    "exceeded",
  );
}

// Namespaced saves enforce a per-world budget before touching a quota-backed
// origin, so one oversized world cannot consume the space needed by siblings.
{
  const storage = new QuotaStorage(SINGLEPLAYER_WORLD_SAVE_MAX_SLOT_CHARS * 2);
  const worlds = [
    createLocalWorld(storage, { name: "One", seedText: "one", gameMode: "survival", now: 1 }),
    createLocalWorld(storage, { name: "Two", seedText: "two", gameMode: "creative", now: 2 }),
    createLocalWorld(storage, { name: "Three", seedText: "three", gameMode: "survival", now: 3 }),
  ];
  assert.ok(worlds.every((world) => world.ok));
  const first = worlds[0].ok ? worlds[0].world : null;
  const second = worlds[1].ok ? worlds[1].world : null;
  const third = worlds[2].ok ? worlds[2].world : null;
  assert.ok(first && second && third);
  const oversized = loadSinglePlayerSave(storage, { migrateLegacy: false, worldId: first.id }).snapshot!;
  oversized.world.edits = Array.from({ length: 8_000 }, (_, index) => ({
    x: index - 4_000,
    y: 63,
    z: 0,
    block: BLOCK.BRICKS,
  }));
  const before = [...storage.values.entries()];
  const rejected = saveSinglePlayerSnapshot(storage, oversized, 4, { worldId: first.id });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.ok ? "" : rejected.reason, "too_large");
  assert.deepEqual([...storage.values.entries()], before, "oversize rejection consumes no origin capacity");

  for (const world of [second, third]) {
    const snapshot = loadSinglePlayerSave(storage, { migrateLegacy: false, worldId: world.id }).snapshot!;
    snapshot.player.inventory[0] = { itemId: "apple", count: 1 };
    assert.equal(saveSinglePlayerSnapshot(storage, snapshot, 5, { worldId: world.id }).ok, true);
  }
}

// A storage namespace is cryptographically checked and bound to the embedded
// world identity. Cross-world writes fail closed and a copied journal cannot be
// loaded under another registry entry.
{
  const storage = new MemoryStorage();
  const first = createLocalWorld(storage, { name: "World A", seedText: "a", gameMode: "survival", now: 1 });
  const second = createLocalWorld(storage, { name: "World B", seedText: "b", gameMode: "creative", now: 2 });
  assert.ok(first.ok && second.ok);
  const snapshot = loadSinglePlayerSave(storage, { migrateLegacy: false, worldId: first.world.id }).snapshot!;
  const rejected = saveSinglePlayerSnapshot(storage, snapshot, 3, { worldId: second.world.id });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.ok ? "" : rejected.reason, "invalid_snapshot");
  assert.equal(rejected.ok ? "" : rejected.path, "$.world.worldId");

  for (const key of [SINGLEPLAYER_SAVE_SLOT_A_KEY, SINGLEPLAYER_SAVE_SLOT_B_KEY]) {
    const source = storage.values.get(singlePlayerWorldStorageKey(first.world.id, key));
    if (source) storage.values.set(singlePlayerWorldStorageKey(second.world.id, key), source);
  }
  const copied = loadSinglePlayerSave(storage, { migrateLegacy: false, worldId: second.world.id });
  assert.equal(copied.status, "corrupt");
  assert.ok(copied.status === "corrupt" && copied.issues.some((issue) => issue.includes("$.world.worldId")));
}

// Even the optional old-format migration is rebound before it enters a
// namespace; a later strict load observes the same embedded identity.
{
  const storage = new MemoryStorage();
  const worldId = "world-namespaced-migration";
  storage.values.set(singlePlayerWorldStorageKey(worldId, SINGLEPLAYER_LEGACY_SAVE_KEY), JSON.stringify({
    inventory: createDefaultSinglePlayerSnapshot().player.inventory,
    equipment: createDefaultSinglePlayerSnapshot().player.equipment,
    selected: 2,
    hunger: 20,
    edits: [],
    drops: [],
  }));
  const migrated = loadSinglePlayerSave(storage, { worldId, migrateLegacy: true, now: () => 123 });
  assert.equal(migrated.status, "migrated");
  assert.equal(migrated.snapshot?.world.worldId, worldId);
  assert.equal(loadSinglePlayerSave(storage, { worldId, migrateLegacy: false }).snapshot?.world.worldId, worldId);
}

// Delete commits registry visibility first. A registry write failure preserves
// the journal. An interrupted post-commit cleanup retains a complete recovery
// transaction and deterministically rolls forward on the next successful read.
{
  const storage = new MemoryStorage();
  const created = createLocalWorld(storage, { name: "Keep Me", seedText: "keep", gameMode: "survival", now: 1 });
  assert.ok(created.ok);
  const initialWorldKeys = singlePlayerWorldStorageKeys(created.world.id);
  const initialJournal = initialWorldKeys.map((key) => storage.values.get(key) ?? null);
  storage.failWritesFor = LOCAL_WORLD_REGISTRY_SLOT_B_KEY;
  storage.failDeletesFor = LOCAL_WORLD_DELETE_TRANSACTION_KEY;
  const blocked = deleteLocalWorld(storage, created.world.id, 2);
  assert.equal(blocked.ok, false);
  assert.equal(storage.values.has(LOCAL_WORLD_DELETE_TRANSACTION_KEY), true);
  storage.values.set(initialWorldKeys[1], "interrupted-primary");
  storage.failWritesFor = null;
  storage.failDeletesFor = null;
  assert.ok(loadLocalWorldRegistry(storage).registry);
  assert.deepEqual(initialWorldKeys.map((key) => storage.values.get(key) ?? null), initialJournal,
    "a pre-commit transaction restores the complete original journal");
  assert.equal(storage.values.has(LOCAL_WORLD_DELETE_TRANSACTION_KEY), false);
  assert.ok(loadSinglePlayerSave(storage, { migrateLegacy: false, worldId: created.world.id }).snapshot);
  assert.equal(loadLocalWorldRegistry(storage).registry?.worlds.some(({ id }) => id === created.world.id), true);

  const current = loadSinglePlayerSave(storage, { migrateLegacy: false, worldId: created.world.id }).snapshot!;
  current.player.inventory[0] = { itemId: "diamond", count: 2 };
  assert.equal(saveSinglePlayerSnapshot(storage, current, 3, { worldId: created.world.id }).ok, true);
  const worldKeys = singlePlayerWorldStorageKeys(created.world.id);
  const completeJournal = worldKeys.map((key) => storage.values.get(key) ?? null);
  storage.failDeletesFor = singlePlayerWorldStorageKey(created.world.id, SINGLEPLAYER_SAVE_SLOT_A_KEY);
  const interrupted = deleteLocalWorld(storage, created.world.id, 4);
  assert.equal(interrupted.ok, false);
  assert.equal(storage.values.has(LOCAL_WORLD_DELETE_TRANSACTION_KEY), true);
  assert.ok(storage.values.get(LOCAL_WORLD_DELETE_TRANSACTION_KEY)?.includes('"checksum"'));
  assert.notDeepEqual(worldKeys.map((key) => storage.values.get(key) ?? null), completeJournal,
    "the injected interruption occurs after at least one primary key is removed");
  const pending = loadLocalWorldRegistry(storage);
  assert.equal(pending.status, "recovered", "pending cleanup preserves access to the committed registry");
  assert.ok(pending.registry && !pending.registry.worlds.some(({ id }) => id === created.world.id));
  assert.ok(pending.issues.includes("delete:recovery_pending"));

  storage.failDeletesFor = null;
  const recovered = loadLocalWorldRegistry(storage);
  assert.ok(recovered.registry);
  assert.equal(recovered.registry.worlds.some(({ id }) => id === created.world.id), false);
  assert.deepEqual(worldKeys.map((key) => storage.values.get(key) ?? null), [null, null, null, null]);
  assert.equal(storage.values.has(LOCAL_WORLD_DELETE_TRANSACTION_KEY), false);
  assert.ok(recovered.issues.includes("delete:cleanup_completed"));
}

// A registry write can commit durably even when its immediate result is
// unknowable. Preserve the complete tombstone until a later authoritative
// registry read decides rollback versus roll-forward, across both journal slots.
for (const siblingCount of [0, 1]) {
  const storage = new MemoryStorage();
  const deleted = createLocalWorld(storage, {
    name: `Ambiguous Delete ${siblingCount}`,
    seedText: `delete-${siblingCount}`,
    gameMode: "survival",
    now: 10 + siblingCount,
  });
  assert.ok(deleted.ok);
  const siblings = siblingCount
    ? [createLocalWorld(storage, { name: "Untouched Sibling", seedText: "sibling", gameMode: "creative", now: 20 })]
    : [];
  assert.ok(siblings.every((world) => world.ok));
  const deletedKeys = singlePlayerWorldStorageKeys(deleted.world.id);
  const sibling = siblings[0]?.ok ? siblings[0].world : null;
  const siblingKeys = sibling ? singlePlayerWorldStorageKeys(sibling.id) : [];
  const siblingValues = siblingKeys.map((key) => storage.values.get(key) ?? null);
  const targetRegistryKey = nextRegistryWriteKey(storage);
  assert.equal(targetRegistryKey, siblingCount === 0 ? LOCAL_WORLD_REGISTRY_SLOT_B_KEY : LOCAL_WORLD_REGISTRY_SLOT_A_KEY,
    "the injected ambiguity covers both alternating registry slots");
  storage.failReadAfterWriteFor = targetRegistryKey;

  const ambiguous = deleteLocalWorld(storage, deleted.world.id, 30 + siblingCount);
  assert.deepEqual(ambiguous, {
    ok: false,
    reason: "registry_readback_failed_transaction_pending",
    mutationStarted: true,
  });
  assert.equal(storage.values.has(LOCAL_WORLD_DELETE_TRANSACTION_KEY), true,
    "an ambiguous registry commit retains the complete cleanup transaction");
  assert.ok(deletedKeys.some((key) => storage.values.has(key)),
    "primary namespace cleanup cannot begin before the ambiguous commit is resolved");

  if (siblingCount === 1) {
    storage.failDeletesFor = deletedKeys[1];
    for (let retry = 0; retry < 2; retry += 1) {
      const pending = loadLocalWorldRegistry(storage);
      assert.ok(pending.registry && !pending.registry.worlds.some(({ id }) => id === deleted.world.id));
      assert.ok(pending.issues.includes("delete:recovery_pending"));
      assert.equal(storage.values.has(LOCAL_WORLD_DELETE_TRANSACTION_KEY), true);
      assert.deepEqual(siblingKeys.map((key) => storage.values.get(key) ?? null), siblingValues,
        "repeated cleanup failure cannot touch a sibling namespace");
    }
    storage.failDeletesFor = null;
  }
  const recovered = loadLocalWorldRegistry(storage);
  assert.ok(recovered.registry && !recovered.registry.worlds.some(({ id }) => id === deleted.world.id),
    "the next authoritative registry read observes the committed deletion");
  assert.ok(recovered.issues.includes("delete:cleanup_completed"));
  assert.deepEqual(deletedKeys.map((key) => storage.values.get(key) ?? null), [null, null, null, null]);
  assert.equal(storage.values.has(LOCAL_WORLD_DELETE_TRANSACTION_KEY), false);
  assert.deepEqual(siblingKeys.map((key) => storage.values.get(key) ?? null), siblingValues,
    "roll-forward cleanup never touches a sibling namespace");
}

// A setItem exception is also ambiguous because an adapter may throw after its
// durable write. The transaction remains retryable and rolls forward exactly.
{
  const storage = new MemoryStorage();
  const deleted = createLocalWorld(storage, { name: "Durable Throw", seedText: "throw", gameMode: "survival", now: 1 });
  assert.ok(deleted.ok);
  const keys = singlePlayerWorldStorageKeys(deleted.world.id);
  storage.throwAfterWritesFor = nextRegistryWriteKey(storage);
  assert.deepEqual(deleteLocalWorld(storage, deleted.world.id, 2), {
    ok: false,
    reason: "registry_storage_write_failed_transaction_pending",
    mutationStarted: true,
  });
  assert.equal(storage.values.has(LOCAL_WORLD_DELETE_TRANSACTION_KEY), true);
  assert.ok(loadLocalWorldRegistry(storage).issues.includes("delete:cleanup_completed"));
  assert.deepEqual(keys.map((key) => storage.values.get(key) ?? null), [null, null, null, null]);
}

// A competing tab or corrupt target slot can replace the attempted registry
// value before readback. The still-authoritative registry keeps the world, so
// recovery restores the exact original namespace rather than guessing delete.
for (const replacement of ["valid_interleaving", "checksum_corruption"] as const) {
  const storage = new MemoryStorage();
  const kept = createLocalWorld(storage, { name: `Keep ${replacement}`, seedText: replacement, gameMode: "survival", now: 1 });
  const sibling = createLocalWorld(storage, { name: `Sibling ${replacement}`, seedText: `${replacement}-2`, gameMode: "creative", now: 2 });
  assert.ok(kept.ok && sibling.ok);
  const keptKeys = singlePlayerWorldStorageKeys(kept.world.id);
  const keptValues = keptKeys.map((key) => storage.values.get(key) ?? null);
  const siblingKeys = singlePlayerWorldStorageKeys(sibling.world.id);
  const siblingValues = siblingKeys.map((key) => storage.values.get(key) ?? null);
  const targetRegistryKey = nextRegistryWriteKey(storage);
  const authoritativeKey = targetRegistryKey === LOCAL_WORLD_REGISTRY_SLOT_A_KEY
    ? LOCAL_WORLD_REGISTRY_SLOT_B_KEY
    : LOCAL_WORLD_REGISTRY_SLOT_A_KEY;
  const authoritativeRaw = storage.values.get(authoritativeKey);
  assert.ok(authoritativeRaw);
  storage.replaceWritesFor.set(targetRegistryKey, (attempted) => replacement === "valid_interleaving"
    ? authoritativeRaw
    : `${attempted.slice(0, -1)}!`);

  const ambiguous = deleteLocalWorld(storage, kept.world.id, 3);
  assert.equal(ambiguous.ok, false);
  assert.ok(!ambiguous.ok && ambiguous.mutationStarted);
  assert.equal(storage.values.has(LOCAL_WORLD_DELETE_TRANSACTION_KEY), true);
  const recovered = loadLocalWorldRegistry(storage);
  assert.ok(recovered.registry?.worlds.some(({ id }) => id === kept.world.id));
  assert.ok(recovered.registry?.worlds.some(({ id }) => id === sibling.world.id));
  assert.ok(recovered.issues.includes("delete:rollback_completed"));
  assert.deepEqual(keptKeys.map((key) => storage.values.get(key) ?? null), keptValues,
    "pre-commit recovery conserves every target-world save slot");
  assert.deepEqual(siblingKeys.map((key) => storage.values.get(key) ?? null), siblingValues,
    "interleaving or corruption cannot mutate a sibling namespace");
  assert.equal(storage.values.has(LOCAL_WORLD_DELETE_TRANSACTION_KEY), false);
}

// Marker write/readback failures happen before the registry commit. They still
// report a mutation attempt and retain any durable marker for verified rollback.
for (const failure of ["readback", "throw_after_write"] as const) {
  const storage = new MemoryStorage();
  const kept = createLocalWorld(storage, { name: `Marker ${failure}`, seedText: failure, gameMode: "survival", now: 1 });
  assert.ok(kept.ok);
  const keys = singlePlayerWorldStorageKeys(kept.world.id);
  const values = keys.map((key) => storage.values.get(key) ?? null);
  if (failure === "readback") storage.failReadAfterWriteFor = LOCAL_WORLD_DELETE_TRANSACTION_KEY;
  else storage.throwAfterWritesFor = LOCAL_WORLD_DELETE_TRANSACTION_KEY;
  assert.deepEqual(deleteLocalWorld(storage, kept.world.id, 2), {
    ok: false,
    reason: "world_delete_transaction_pending",
    mutationStarted: true,
  });
  assert.equal(storage.values.has(LOCAL_WORLD_DELETE_TRANSACTION_KEY), true);
  const recovered = loadLocalWorldRegistry(storage);
  assert.ok(recovered.registry?.worlds.some(({ id }) => id === kept.world.id));
  assert.ok(recovered.issues.includes("delete:rollback_completed"));
  assert.deepEqual(keys.map((key) => storage.values.get(key) ?? null), values);
  assert.equal(storage.values.has(LOCAL_WORLD_DELETE_TRANSACTION_KEY), false);
}

// A competing tab replacing the marker between write and readback cannot make
// this delete trust a different transaction or advance the registry commit.
{
  const storage = new MemoryStorage();
  const kept = createLocalWorld(storage, { name: "Marker Interleave", seedText: "marker-tab", gameMode: "survival", now: 1 });
  const sibling = createLocalWorld(storage, { name: "Marker Sibling", seedText: "marker-sibling", gameMode: "creative", now: 2 });
  assert.ok(kept.ok && sibling.ok);
  const keptKeys = singlePlayerWorldStorageKeys(kept.world.id);
  const keptValues = keptKeys.map((key) => storage.values.get(key) ?? null);
  const siblingKeys = singlePlayerWorldStorageKeys(sibling.world.id);
  const siblingValues = siblingKeys.map((key) => storage.values.get(key) ?? null);
  storage.replaceWritesFor.set(LOCAL_WORLD_DELETE_TRANSACTION_KEY, () => "{");
  assert.deepEqual(deleteLocalWorld(storage, kept.world.id, 3), {
    ok: false,
    reason: "world_delete_transaction_pending",
    mutationStarted: true,
  });
  const recovered = loadLocalWorldRegistry(storage);
  assert.ok(recovered.registry?.worlds.some(({ id }) => id === kept.world.id));
  assert.ok(recovered.registry?.worlds.some(({ id }) => id === sibling.world.id));
  assert.ok(recovered.issues.includes("delete:invalid_transaction_cleared"));
  assert.deepEqual(keptKeys.map((key) => storage.values.get(key) ?? null), keptValues);
  assert.deepEqual(siblingKeys.map((key) => storage.values.get(key) ?? null), siblingValues);
}

// Failure while reading the source namespace is definitely pre-write.
{
  const storage = new MemoryStorage();
  const kept = createLocalWorld(storage, { name: "Preflight Read", seedText: "preflight", gameMode: "survival", now: 1 });
  assert.ok(kept.ok);
  storage.failReadsFor = singlePlayerWorldStorageKeys(kept.world.id)[0];
  assert.deepEqual(deleteLocalWorld(storage, kept.world.id, 2), {
    ok: false,
    reason: "world_delete_transaction_failed",
    mutationStarted: false,
  });
  assert.equal(storage.values.has(LOCAL_WORLD_DELETE_TRANSACTION_KEY), false);
  storage.failReadsFor = null;
  assert.ok(loadLocalWorldRegistry(storage).registry?.worlds.some(({ id }) => id === kept.world.id));
}

// An unreadable or checksum-invalid global tombstone is never trusted for a
// namespace mutation. Healthy registries stay usable even when marker removal
// is denied, and a later load can clear only the opaque marker.
{
  const storage = new MemoryStorage();
  const first = createLocalWorld(storage, { name: "Healthy One", seedText: "one", gameMode: "survival", now: 1 });
  const second = createLocalWorld(storage, { name: "Healthy Two", seedText: "two", gameMode: "creative", now: 2 });
  assert.ok(first.ok && second.ok);
  const healthyIds = [first.world.id, second.world.id].sort();
  const secondKeys = singlePlayerWorldStorageKeys(second.world.id);
  const secondValues = secondKeys.map((key) => storage.values.get(key) ?? null);

  storage.values.set(LOCAL_WORLD_DELETE_TRANSACTION_KEY, "{");
  const malformed = listLocalWorlds(storage);
  assert.equal(malformed.registryLoad.status, "recovered");
  assert.deepEqual(malformed.worlds.map(({ world }) => world.id).sort(), healthyIds);
  assert.ok(malformed.registryLoad.issues.includes("delete:invalid_transaction_cleared"));
  assert.equal(storage.values.has(LOCAL_WORLD_DELETE_TRANSACTION_KEY), false);

  // Leave a valid pre-commit marker, then change its bound ID without updating
  // the checksum. Recovery may clear the opaque marker but cannot touch either
  // world namespace.
  storage.failWritesFor = LOCAL_WORLD_REGISTRY_SLOT_A_KEY;
  storage.failDeletesFor = LOCAL_WORLD_DELETE_TRANSACTION_KEY;
  assert.equal(deleteLocalWorld(storage, first.world.id, 3).ok, false);
  const validRaw = storage.values.get(LOCAL_WORLD_DELETE_TRANSACTION_KEY);
  assert.ok(validRaw);
  const tamperedRaw = validRaw.replace(`"worldId":"${first.world.id}"`, `"worldId":"${second.world.id}"`);
  assert.notEqual(tamperedRaw, validRaw);
  storage.values.set(LOCAL_WORLD_DELETE_TRANSACTION_KEY, tamperedRaw);
  storage.failWritesFor = null;
  storage.failDeletesFor = null;
  const tampered = listLocalWorlds(storage);
  assert.deepEqual(tampered.worlds.map(({ world }) => world.id).sort(), healthyIds);
  assert.ok(tampered.registryLoad.issues.includes("delete:invalid_transaction_cleared"));
  assert.deepEqual(secondKeys.map((key) => storage.values.get(key) ?? null), secondValues,
    "a checksum-invalid worldId cannot mutate the named healthy namespace");

  storage.values.set(LOCAL_WORLD_DELETE_TRANSACTION_KEY, "{");
  storage.failDeletesFor = LOCAL_WORLD_DELETE_TRANSACTION_KEY;
  for (let retry = 0; retry < 2; retry += 1) {
    const removalDenied = listLocalWorlds(storage);
    assert.equal(removalDenied.registryLoad.status, "recovered");
    assert.deepEqual(removalDenied.worlds.map(({ world }) => world.id).sort(), healthyIds);
    assert.ok(removalDenied.registryLoad.issues.includes("delete:invalid_transaction_pending"));
    assert.equal(storage.values.get(LOCAL_WORLD_DELETE_TRANSACTION_KEY), "{");
  }
  const nestedDelete = deleteLocalWorld(storage, first.world.id, 4);
  assert.deepEqual(nestedDelete, { ok: false, reason: "world_delete_recovery_pending", mutationStarted: false });
  assert.equal(storage.values.get(LOCAL_WORLD_DELETE_TRANSACTION_KEY), "{",
    "another delete cannot overwrite a pending recovery marker");
  storage.failDeletesFor = null;
  const cleared = listLocalWorlds(storage);
  assert.deepEqual(cleared.worlds.map(({ world }) => world.id).sort(), healthyIds);
  assert.ok(cleared.registryLoad.issues.includes("delete:invalid_transaction_cleared"));
  assert.equal(storage.values.has(LOCAL_WORLD_DELETE_TRANSACTION_KEY), false);

  storage.failReadsFor = LOCAL_WORLD_DELETE_TRANSACTION_KEY;
  const unreadable = listLocalWorlds(storage);
  assert.deepEqual(unreadable.worlds.map(({ world }) => world.id).sort(), healthyIds);
  assert.ok(unreadable.registryLoad.issues.includes("delete:transaction_read_failed"));
  storage.failReadsFor = null;
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

// Storage can fail while resolving the browser getter or an adapter method
// property, before a method body is called. Both boundaries fail closed.
{
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  try {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      get: () => { throw new Error("localStorage getter denied"); },
    });
    const guarded = browserSinglePlayerStorage();
    assert.doesNotThrow(() => listLocalWorlds(guarded));
    assert.equal(loadLocalWorldRegistry(guarded).status, "corrupt");
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }

  const throwingGet = Object.defineProperty({
    setItem: () => undefined,
  }, "getItem", {
    get: () => { throw new Error("method getter denied"); },
  }) as SinglePlayerStorageAdapter;
  assert.doesNotThrow(() => loadLocalWorldRegistry(throwingGet));
  assert.equal(loadLocalWorldRegistry(throwingGet).status, "corrupt");

  const values = new Map<string, string>();
  const throwingRemove = Object.defineProperties({}, {
    getItem: { value: (key: string) => values.get(key) ?? null },
    setItem: { value: (key: string, value: string) => values.set(key, value) },
    removeItem: { get: () => { throw new Error("remove getter denied"); } },
  }) as SinglePlayerStorageAdapter;
  assert.deepEqual(
    resetSinglePlayerSave(throwingRemove),
    { ok: false, reason: "storage_delete_unavailable", mutationStarted: false },
  );
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
