import assert from "node:assert/strict";
import {
  SINGLEPLAYER_WORLD_SAVE_MAX_SLOT_CHARS,
  browserSinglePlayerStorage,
  canonicalSinglePlayerJson,
  createDefaultSinglePlayerSnapshot,
  loadSinglePlayerSave,
  saveSinglePlayerSnapshot,
  singlePlayerSaveChecksum,
  singlePlayerWorldStorageKeys,
  type SinglePlayerStorageAdapter,
} from "../client/singleplayer/localSave.ts";
import {
  LOCAL_WORLD_CAPACITY_WARNING_CHARS,
  LOCAL_WORLD_CREATE_TRANSACTION_KEY,
  LOCAL_WORLD_DELETE_TRANSACTION_KEY,
  LOCAL_WORLD_NAMESPACE_BUDGET_CHARS,
  LOCAL_WORLD_REGISTRY_MAX_WORLDS,
  LOCAL_WORLD_REGISTRY_SLOT_A_KEY,
  LOCAL_WORLD_REGISTRY_SLOT_B_KEY,
  LOCAL_WORLD_TRANSACTION_LEASE_MS,
  createLocalWorld,
  deleteLocalWorld,
  deterministicLocalWorldSeed,
  importLegacyLocalWorld,
  inspectLegacyLocalWorld,
  inspectLocalWorld,
  isLocalWorldRegistryTransactionReadOnly,
  listLocalWorlds,
  loadLocalWorldRegistry,
  moveLocalWorldSelection,
  normalizeLocalWorldName,
  reconcileLocalWorldSelection,
  resetLegacyLocalWorld,
  resetLocalWorldData,
  resolveLocalWorldPlay,
  saveLocalWorldRegistry,
  touchLocalWorld,
  type LocalWorldRecord,
} from "../client/singleplayer/localWorldRegistry.ts";
import { BLOCK } from "../client/game/types.ts";

class MemoryStorage implements SinglePlayerStorageAdapter {
  values = new Map<string, string>();
  failReadsFor: string | null = null;
  failWritesFor: string | null = null;
  failDeletesFor: string | null = null;
  failReadAfterWriteFor: string | null = null;
  throwAfterWritesFor: string | null = null;
  afterWritesFor = new Map<string, () => void>();
  afterReadsFor = new Map<string, () => void>();
  replaceWritesFor = new Map<string, (value: string) => string>();

  private matches(key: string, configured: string | null): boolean {
    return configured !== null && (key === configured || key.startsWith(`${configured}.`));
  }

  getItem(key: string): string | null {
    if (this.matches(key, this.failReadsFor)) throw new Error("read failed");
    const value = this.values.get(key) ?? null;
    const hook = [...this.afterReadsFor.entries()].find(([configured]) => this.matches(key, configured));
    if (hook) {
      this.afterReadsFor.delete(hook[0]);
      hook[1]();
    }
    return value;
  }

  listKeys(): string[] {
    return [...this.values.keys()];
  }

  setItem(key: string, value: string): void {
    if (this.matches(key, this.failWritesFor)) throw new Error("write failed");
    this.values.set(key, value);
    const replacement = [...this.replaceWritesFor.entries()]
      .find(([configured]) => this.matches(key, configured));
    if (replacement) {
      this.replaceWritesFor.delete(replacement[0]);
      this.values.set(key, replacement[1](value));
    }
    const hook = [...this.afterWritesFor.entries()].find(([configured]) => this.matches(key, configured));
    if (hook) {
      this.afterWritesFor.delete(hook[0]);
      hook[1]();
    }
    if (this.matches(key, this.failReadAfterWriteFor)) {
      this.failReadAfterWriteFor = null;
      this.failReadsFor = key;
    }
    if (this.matches(key, this.throwAfterWritesFor)) {
      this.throwAfterWritesFor = null;
      throw new Error("lost write acknowledgement");
    }
  }

  removeItem(key: string): void {
    if (this.matches(key, this.failDeletesFor)) throw new Error("delete failed");
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
      (total, [storedKey, stored]) => total + (storedKey === key ? 0 : storedKey.length + stored.length),
      key.length + value.length,
    );
    if (used > this.quotaChars) throw new Error("quota exceeded");
    super.setItem(key, value);
  }
}

type RegistryTuple = [
  3,
  string,
  number,
  number,
  LocalWorldRecord[],
  null | [0 | 1, number, string, number, ...unknown[]],
];

const registryKeys = [LOCAL_WORLD_REGISTRY_SLOT_A_KEY, LOCAL_WORLD_REGISTRY_SLOT_B_KEY] as const;

function cloneStorage(source: MemoryStorage): MemoryStorage {
  const clone = new MemoryStorage();
  clone.values = new Map(source.values);
  return clone;
}

function parsedRegistry(storage: MemoryStorage, key: string): RegistryTuple | null {
  const raw = storage.values.get(key);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) && value[0] === 3 && typeof value[2] === "number"
      ? value as RegistryTuple
      : null;
  } catch {
    return null;
  }
}

function highestRegistry(storage: MemoryStorage): [string, RegistryTuple] | null {
  return registryKeys.flatMap((key) => {
    const value = parsedRegistry(storage, key);
    return value ? [[key, value] as [string, RegistryTuple]] : [];
  }).sort((left, right) => right[1][2] - left[1][2])[0] ?? null;
}

function nextRegistryWriteKey(storage: MemoryStorage): string {
  return highestRegistry(storage)?.[0] === LOCAL_WORLD_REGISTRY_SLOT_A_KEY
    ? LOCAL_WORLD_REGISTRY_SLOT_B_KEY
    : LOCAL_WORLD_REGISTRY_SLOT_A_KEY;
}

function pendingRegistry(storage: MemoryStorage): [string, RegistryTuple] {
  const entry = highestRegistry(storage);
  assert.ok(entry?.[1][5], "expected highest registry slot to carry pending state");
  return entry;
}

function encodeRegistry(
  sequence: number,
  savedAt: number,
  worlds: LocalWorldRecord[],
  pending: RegistryTuple[5],
): string {
  const body = [3, sequence, savedAt, [...worlds].sort((a, b) => a.id.localeCompare(b.id)), pending];
  return canonicalSinglePlayerJson([3, singlePlayerSaveChecksum(body), ...body.slice(1)]);
}

function rewritePendingWorlds(storage: MemoryStorage, worlds: LocalWorldRecord[]): void {
  const [key, value] = pendingRegistry(storage);
  storage.values.set(key, encodeRegistry(value[2], value[3], worlds, value[5]));
}

function namespaceValues(storage: MemoryStorage, worldId: string): Array<string | null> {
  return singlePlayerWorldStorageKeys(worldId).map((key) => storage.values.get(key) ?? null);
}

function makePendingCreate(
  source: MemoryStorage,
  input: Parameters<typeof createLocalWorld>[1],
): MemoryStorage {
  const donor = cloneStorage(source);
  const pendingKey = nextRegistryWriteKey(donor);
  donor.afterWritesFor.set(pendingKey, () => {
    donor.failWritesFor = nextRegistryWriteKey(donor);
  });
  const created = createLocalWorld(donor, input);
  assert.equal(created.ok, false);
  donor.failWritesFor = null;
  assert.equal(pendingRegistry(donor)[1][5]?.[0], 0);
  return donor;
}

function makePendingDelete(source: MemoryStorage, worldId: string, deletedAt: number): MemoryStorage {
  const donor = cloneStorage(source);
  donor.failDeletesFor = singlePlayerWorldStorageKeys(worldId)[0];
  const deleted = deleteLocalWorld(donor, worldId, deletedAt);
  assert.deepEqual(deleted, { ok: false, reason: "world_delete_cleanup_pending", mutationStarted: true });
  assert.equal(pendingRegistry(donor)[1][5]?.[0], 1);
  return donor;
}

function assertNoExternalMarkers(storage: MemoryStorage): void {
  assert.equal(
    [...storage.values.keys()].some((key) =>
      key === LOCAL_WORLD_CREATE_TRANSACTION_KEY
      || key.startsWith(`${LOCAL_WORLD_CREATE_TRANSACTION_KEY}.`)
      || key === LOCAL_WORLD_DELETE_TRANSACTION_KEY
      || key.startsWith(`${LOCAL_WORLD_DELETE_TRANSACTION_KEY}.`)),
    false,
  );
}

assert.equal(normalizeLocalWorldName("  Fern   Hollow  "), "Fern Hollow");
assert.equal(normalizeLocalWorldName(""), null);
assert.equal(normalizeLocalWorldName("x".repeat(49)), null);
assert.equal(deterministicLocalWorldSeed("-42"), -42);
assert.equal(deterministicLocalWorldSeed("Fern Hollow"), deterministicLocalWorldSeed("Fern Hollow"));
assert.notEqual(deterministicLocalWorldSeed("Fern Hollow"), deterministicLocalWorldSeed("Fern Valley"));
assert.equal(reconcileLocalWorldSelection("b", ["a", "b"]), "b");
assert.equal(reconcileLocalWorldSelection("b", ["a"]), null);
assert.equal(moveLocalWorldSelection(null, ["a", "b"], "ArrowDown"), "a");
assert.equal(moveLocalWorldSelection(null, ["a", "b"], "ArrowUp"), "b");
assert.equal(moveLocalWorldSelection("a", ["a", "b"], "ArrowUp"), "a");
assert.equal(moveLocalWorldSelection("a", ["a", "b"], "End"), "b");

// Healthy create/touch/reset/delete uses only the crash-safe A/B registry and
// four world keys; pending is cleared by a second atomic registry generation.
{
  const storage = new MemoryStorage();
  const created = createLocalWorld(storage, {
    name: "Fern Hollow",
    seedText: "fern",
    gameMode: "survival",
    now: 100,
  });
  assert.ok(created.ok);
  assert.equal(loadLocalWorldRegistry(storage).sequence, 2);
  assert.equal(highestRegistry(storage)?.[1][5], null);
  assertNoExternalMarkers(storage);
  const touched = touchLocalWorld(storage, created.world.id, 200, created.world);
  assert.ok(touched.ok);
  assert.equal(touched.world.lastPlayedAt, 200);
  assert.ok(resetLocalWorldData(storage, created.world.id, 300).ok);
  assert.ok(deleteLocalWorld(storage, created.world.id, 400).ok);
  assert.equal(loadLocalWorldRegistry(storage).registry?.worlds.length, 0);
  assert.deepEqual(namespaceValues(storage, created.world.id), [null, null, null, null]);
  assertNoExternalMarkers(storage);
}

// A pending create is the sole mutation owner. Re-entrant create and delete
// calls see the same committed pending generation and cannot touch namespaces.
{
  const storage = new MemoryStorage();
  const kept = createLocalWorld(storage, {
    name: "Nested Kept",
    seedText: "nested-kept",
    gameMode: "survival",
    now: 500,
  });
  assert.ok(kept.ok);
  const before = new Map(storage.values);
  const nested: unknown[] = [];
  storage.afterWritesFor.set(nextRegistryWriteKey(storage), () => {
    nested.push(createLocalWorld(storage, {
      name: "Nested Loser",
      seedText: "nested-loser",
      gameMode: "creative",
      now: 501,
    }));
    nested.push(deleteLocalWorld(storage, kept.world.id, 501));
  });
  const outer = createLocalWorld(storage, {
    name: "Nested Winner",
    seedText: "nested-winner",
    gameMode: "survival",
    now: 501,
  });
  assert.ok(outer.ok);
  assert.deepEqual(nested, [
    { ok: false, reason: "world_create_recovery_pending", mutationStarted: false },
    { ok: false, reason: "world_delete_recovery_pending", mutationStarted: false },
  ]);
  assert.deepEqual(namespaceValues(storage, kept.world.id),
    singlePlayerWorldStorageKeys(kept.world.id).map((key) => before.get(key) ?? null));
  assert.equal(loadLocalWorldRegistry(storage).registry?.worlds.length, 2);
}

// A pending delete owns the same window. Nested operations cannot recreate its
// deterministic ID or mutate a healthy sibling before cleanup/finalization.
{
  const storage = new MemoryStorage();
  const doomed = createLocalWorld(storage, {
    name: "Delete Owner",
    seedText: "delete-owner",
    gameMode: "survival",
    now: 600,
  });
  const sibling = createLocalWorld(storage, {
    name: "Delete Sibling",
    seedText: "delete-sibling",
    gameMode: "creative",
    now: 601,
  });
  assert.ok(doomed.ok && sibling.ok);
  const siblingBytes = namespaceValues(storage, sibling.world.id);
  const nested: unknown[] = [];
  storage.afterWritesFor.set(nextRegistryWriteKey(storage), () => {
    nested.push(createLocalWorld(storage, {
      name: "Delete Recreate",
      seedText: "delete-owner",
      gameMode: "creative",
      now: 600,
    }));
    nested.push(deleteLocalWorld(storage, sibling.world.id, 602));
  });
  assert.ok(deleteLocalWorld(storage, doomed.world.id, 602).ok);
  assert.deepEqual(nested, [
    { ok: false, reason: "world_create_recovery_pending", mutationStarted: false },
    { ok: false, reason: "world_delete_recovery_pending", mutationStarted: false },
  ]);
  assert.deepEqual(namespaceValues(storage, sibling.world.id), siblingBytes);
  assert.deepEqual(loadLocalWorldRegistry(storage).registry?.worlds.map(({ id }) => id), [sibling.world.id]);
}

// Create crash phases: definite prewrite failure leaves no bytes; ambiguous
// pending publication recovers after the exact lease; namespace-before-final
// is cleaned; a durable final write wins even when its acknowledgement is lost.
{
  const input = { name: "Create Crash", seedText: "create-crash", gameMode: "survival" as const, now: 700 };
  const prewrite = new MemoryStorage();
  prewrite.failWritesFor = nextRegistryWriteKey(prewrite);
  assert.deepEqual(createLocalWorld(prewrite, input), {
    ok: false,
    reason: "registry_storage_write_failed_transaction_pending",
    mutationStarted: true,
  });
  assert.equal(prewrite.values.size, 0);
  prewrite.failWritesFor = null;
  assert.ok(createLocalWorld(prewrite, input).ok);

  const ambiguous = new MemoryStorage();
  ambiguous.throwAfterWritesFor = nextRegistryWriteKey(ambiguous);
  assert.equal(createLocalWorld(ambiguous, input).ok, false);
  assert.ok(loadLocalWorldRegistry(ambiguous, 700).issues.includes("transaction:active"));
  const recovered = loadLocalWorldRegistry(ambiguous, 700 + LOCAL_WORLD_TRANSACTION_LEASE_MS);
  assert.ok(recovered.issues.includes("create:cleanup_completed"));
  assert.equal(recovered.registry?.worlds.length, 0);

  const namespaceCrash = makePendingCreate(new MemoryStorage(), input);
  const pending = pendingRegistry(namespaceCrash)[1][5]!;
  const intended = pending[4] as LocalWorldRecord;
  assert.ok(namespaceValues(namespaceCrash, intended.id).some((value) => value !== null));
  assert.ok(loadLocalWorldRegistry(
    namespaceCrash,
    input.now + LOCAL_WORLD_TRANSACTION_LEASE_MS,
  ).issues.includes("create:cleanup_completed"));
  assert.deepEqual(namespaceValues(namespaceCrash, intended.id), [null, null, null, null]);

  const finalLost = new MemoryStorage();
  const firstKey = nextRegistryWriteKey(finalLost);
  finalLost.afterWritesFor.set(firstKey, () => {
    finalLost.throwAfterWritesFor = nextRegistryWriteKey(finalLost);
  });
  assert.equal(createLocalWorld(finalLost, input).ok, false);
  assert.equal(loadLocalWorldRegistry(finalLost).registry?.worlds.length, 1);
  assert.ok(createLocalWorld(finalLost, input).ok, "exact retry observes the durable commit");
}

// Delete crash phases preserve the registry commit point and exact cleanup
// payload. Precommit failure keeps the world; durable pending state rolls
// forward; cleanup and clear failures remain recoverable and bounded.
{
  const source = new MemoryStorage();
  const created = createLocalWorld(source, {
    name: "Delete Crash",
    seedText: "delete-crash",
    gameMode: "survival",
    now: 800,
  });
  assert.ok(created.ok);
  const original = namespaceValues(source, created.world.id);

  const prewrite = cloneStorage(source);
  prewrite.failWritesFor = nextRegistryWriteKey(prewrite);
  assert.equal(deleteLocalWorld(prewrite, created.world.id, 801).ok, false);
  assert.ok(loadLocalWorldRegistry(prewrite).registry?.worlds.some(({ id }) => id === created.world.id));
  assert.deepEqual(namespaceValues(prewrite, created.world.id), original);

  const ambiguous = cloneStorage(source);
  ambiguous.throwAfterWritesFor = nextRegistryWriteKey(ambiguous);
  assert.equal(deleteLocalWorld(ambiguous, created.world.id, 802).ok, false);
  assert.equal(loadLocalWorldRegistry(ambiguous, 802).registry?.worlds.some(({ id }) => id === created.world.id), false);
  assert.ok(loadLocalWorldRegistry(
    ambiguous,
    802 + LOCAL_WORLD_TRANSACTION_LEASE_MS,
  ).issues.includes("delete:cleanup_completed"));
  assert.deepEqual(namespaceValues(ambiguous, created.world.id), [null, null, null, null]);

  const cleanup = makePendingDelete(source, created.world.id, 803);
  cleanup.failDeletesFor = null;
  assert.ok(loadLocalWorldRegistry(cleanup, 803).issues.includes("transaction:active"));
  assert.ok(loadLocalWorldRegistry(
    cleanup,
    803 + LOCAL_WORLD_TRANSACTION_LEASE_MS,
  ).issues.includes("delete:cleanup_completed"));
  assert.deepEqual(namespaceValues(cleanup, created.world.id), [null, null, null, null]);

  const clear = cloneStorage(source);
  clear.afterWritesFor.set(nextRegistryWriteKey(clear), () => {
    clear.failWritesFor = nextRegistryWriteKey(clear);
  });
  assert.deepEqual(deleteLocalWorld(clear, created.world.id, 804), {
    ok: false,
    reason: "world_delete_cleanup_pending",
    mutationStarted: true,
  });
  assert.deepEqual(namespaceValues(clear, created.world.id), [null, null, null, null]);
  clear.failWritesFor = null;
  assert.ok(loadLocalWorldRegistry(
    clear,
    804 + LOCAL_WORLD_TRANSACTION_LEASE_MS,
  ).issues.includes("delete:cleanup_completed"));

  const rollback = makePendingDelete(source, created.world.id, 805);
  rollback.failDeletesFor = null;
  rewritePendingWorlds(rollback, [created.world]);
  rollback.values.set(singlePlayerWorldStorageKeys(created.world.id)[0], "partial");
  const rolledBack = loadLocalWorldRegistry(
    rollback,
    805 + LOCAL_WORLD_TRANSACTION_LEASE_MS,
  );
  assert.ok(rolledBack.issues.includes("delete:rollback_completed"));
  assert.deepEqual(namespaceValues(rollback, created.world.id), original);
}

// A same-ID replacement is never crossed. Recovery clears a create/delete
// payload that names an older exact record without changing replacement bytes.
{
  const oldSource = new MemoryStorage();
  const old = createLocalWorld(oldSource, {
    name: "Old Generation",
    seedText: "same-id",
    gameMode: "survival",
    now: 900,
  });
  assert.ok(old.ok);
  const replacementStorage = new MemoryStorage();
  const replacement = createLocalWorld(replacementStorage, {
    name: "Replacement Generation",
    seedText: "same-id",
    gameMode: "creative",
    now: 900,
  });
  assert.ok(replacement.ok);
  assert.equal(replacement.world.id, old.world.id);
  assert.equal(canonicalSinglePlayerJson(replacement.world) === canonicalSinglePlayerJson(old.world), false);
  const replacementBytes = namespaceValues(replacementStorage, replacement.world.id);

  const pendingDelete = makePendingDelete(oldSource, old.world.id, 901);
  pendingDelete.failDeletesFor = null;
  singlePlayerWorldStorageKeys(old.world.id).forEach((key, index) => {
    const value = replacementBytes[index];
    if (value === null) pendingDelete.values.delete(key);
    else pendingDelete.values.set(key, value);
  });
  rewritePendingWorlds(pendingDelete, [replacement.world]);
  const deleteRecovered = loadLocalWorldRegistry(
    pendingDelete,
    901 + LOCAL_WORLD_TRANSACTION_LEASE_MS,
  );
  assert.ok(deleteRecovered.issues.includes("delete:invalid_transaction_cleared"));
  assert.deepEqual(namespaceValues(pendingDelete, old.world.id), replacementBytes);
  assert.equal(deleteRecovered.registry?.worlds[0].name, "Replacement Generation");

  const createInput = {
    name: "Pending Old",
    seedText: "pending-same-id",
    gameMode: "survival" as const,
    now: 910,
  };
  const pendingCreate = makePendingCreate(new MemoryStorage(), createInput);
  const replacementCreateStorage = new MemoryStorage();
  const replacementCreate = createLocalWorld(replacementCreateStorage, {
    ...createInput,
    name: "Pending Replacement",
    gameMode: "creative",
  });
  assert.ok(replacementCreate.ok);
  const createBytes = namespaceValues(replacementCreateStorage, replacementCreate.world.id);
  singlePlayerWorldStorageKeys(replacementCreate.world.id).forEach((key, index) => {
    const value = createBytes[index];
    if (value === null) pendingCreate.values.delete(key);
    else pendingCreate.values.set(key, value);
  });
  rewritePendingWorlds(pendingCreate, [replacementCreate.world]);
  const createRecovered = loadLocalWorldRegistry(
    pendingCreate,
    createInput.now + LOCAL_WORLD_TRANSACTION_LEASE_MS,
  );
  assert.ok(createRecovered.issues.includes("create:invalid_transaction_cleared"));
  assert.deepEqual(namespaceValues(pendingCreate, replacementCreate.world.id), createBytes);
}

// Stale generations and same-sequence conflicts fail closed. A losing writer
// never owns, finalizes, or creates a namespace.
{
  const storage = new MemoryStorage();
  const first = createLocalWorld(storage, {
    name: "Generation Base",
    seedText: "generation",
    gameMode: "survival",
    now: 1_000,
  });
  assert.ok(first.ok);
  const loaded = loadLocalWorldRegistry(storage);
  assert.ok(touchLocalWorld(storage, first.world.id, 1_001).ok);
  assert.deepEqual(saveLocalWorldRegistry(storage, loaded.registry!, 1_002, loaded.sequence), {
    ok: false,
    reason: "stale_registry",
    mutationStarted: false,
  });

  const conflict = new MemoryStorage();
  const target = nextRegistryWriteKey(conflict);
  conflict.afterWritesFor.set(target, () => {
    const current = parsedRegistry(conflict, target)!;
    const other = target === LOCAL_WORLD_REGISTRY_SLOT_A_KEY
      ? LOCAL_WORLD_REGISTRY_SLOT_B_KEY
      : LOCAL_WORLD_REGISTRY_SLOT_A_KEY;
    conflict.values.set(other, encodeRegistry(current[2], current[3], [{
        id: "world-conflict",
        name: "Conflict",
        seed: 1,
        initialGameMode: "survival",
        createdAt: 1_000,
        lastPlayedAt: 0,
        importedLegacy: false,
      }], current[5]));
  });
  const lost = createLocalWorld(conflict, {
    name: "Generation Loser",
    seedText: "loser",
    gameMode: "creative",
    now: 1_000,
  });
  assert.equal(lost.ok, false);
  assert.equal([...conflict.values.keys()].some((key) => key.includes(".save.")), false);
  assert.equal(loadLocalWorldRegistry(conflict).status, "corrupt");
}

// Read-only Play may mount an unchanged healthy world while an unrelated
// delete is pending, but never the selected deletion or drifting namespace.
{
  const storage = new MemoryStorage();
  const selected = createLocalWorld(storage, {
    name: "Playable",
    seedText: "playable",
    gameMode: "survival",
    now: 1_100,
  });
  const sibling = createLocalWorld(storage, {
    name: "Deleting Sibling",
    seedText: "deleting-sibling",
    gameMode: "creative",
    now: 1_101,
  });
  assert.ok(selected.ok && sibling.ok);
  const inspection = inspectLocalWorld(storage, selected.world);
  const pending = makePendingDelete(storage, sibling.world.id, 1_102);
  pending.failDeletesFor = null;
  const touch = touchLocalWorld(pending, selected.world.id, 1_102, selected.world);
  assert.deepEqual(touch, { ok: false, reason: "world_touch_recovery_pending", mutationStarted: false });
  assert.equal(resolveLocalWorldPlay(pending, inspection, touch)?.id, selected.world.id);

  const selectedPending = makePendingDelete(storage, selected.world.id, 1_102);
  selectedPending.failDeletesFor = null;
  assert.equal(resolveLocalWorldPlay(selectedPending, inspection, {
    ok: false,
    reason: "world_touch_recovery_pending",
    mutationStarted: false,
  }), null);

  const drifting = makePendingDelete(storage, sibling.world.id, 1_102);
  drifting.failDeletesFor = null;
  const keys = singlePlayerWorldStorageKeys(selected.world.id);
  drifting.afterReadsFor.set(keys[1], () => {
    drifting.values.set(keys[0], `${drifting.values.get(keys[0])} `);
  });
  assert.equal(resolveLocalWorldPlay(drifting, inspection, {
    ok: false,
    reason: "world_touch_recovery_pending",
    mutationStarted: false,
  }), null);
}

// Namespace capacity is local: unrelated origin data and a large sibling do
// not taint a healthy world's calculation, while oversized writes fail before
// consuming a quota-backed origin.
{
  const storage = new MemoryStorage();
  const first = createLocalWorld(storage, {
    name: "Capacity A",
    seedText: "capacity-a",
    gameMode: "survival",
    now: 1_200,
  });
  const second = createLocalWorld(storage, {
    name: "Capacity B",
    seedText: "capacity-b",
    gameMode: "creative",
    now: 1_201,
  });
  assert.ok(first.ok && second.ok);
  storage.values.set("unrelated.origin.data", "x".repeat(LOCAL_WORLD_NAMESPACE_BUDGET_CHARS * 2));
  const healthy = inspectLocalWorld(storage, first.world);
  assert.ok(healthy.usedChars < LOCAL_WORLD_CAPACITY_WARNING_CHARS);
  const secondSlot = singlePlayerWorldStorageKeys(second.world.id)[2];
  storage.values.set(secondSlot, "x".repeat(SINGLEPLAYER_WORLD_SAVE_MAX_SLOT_CHARS + 1));
  assert.equal(inspectLocalWorld(storage, first.world).capacity, "ok");
  assert.equal(inspectLocalWorld(storage, second.world).capacity, "exceeded");

  const quota = new QuotaStorage(LOCAL_WORLD_NAMESPACE_BUDGET_CHARS * 2);
  const world = createLocalWorld(quota, {
    name: "Quota",
    seedText: "quota",
    gameMode: "survival",
    now: 1_210,
  });
  assert.ok(world.ok);
  const before = new Map(quota.values);
  const snapshot = createDefaultSinglePlayerSnapshot(world.world.seed, 1_210, world.world.id);
  snapshot.world.edits = Array.from({ length: 12_000 }, (_, index) => ({
    x: index,
    y: 1,
    z: index,
    block: BLOCK.STONE,
  }));
  assert.equal(saveSinglePlayerSnapshot(quota, snapshot, 1_211, { worldId: world.world.id }).ok, false);
  assert.deepEqual(quota.values, before);
}

// Three worlds remain isolated, copied save journals fail identity binding,
// and the deterministic six-world limit never consumes a seventh namespace.
{
  const storage = new MemoryStorage();
  const worlds = Array.from({ length: LOCAL_WORLD_REGISTRY_MAX_WORLDS }, (_, index) =>
    createLocalWorld(storage, {
      name: `Isolated ${index}`,
      seedText: `isolated-${index}`,
      gameMode: index % 2 ? "creative" : "survival",
      now: 1_300 + index,
    }));
  assert.ok(worlds.every((result) => result.ok));
  const records = worlds.flatMap((result) => result.ok ? [result.world] : []);
  assert.equal(new Set(records.map(({ id }) => id)).size, LOCAL_WORLD_REGISTRY_MAX_WORLDS);
  const firstSnapshot = loadSinglePlayerSave(storage, { worldId: records[0].id }).snapshot!;
  firstSnapshot.world.edits.push({ x: 2, y: 3, z: 4, block: BLOCK.STONE });
  assert.ok(saveSinglePlayerSnapshot(storage, firstSnapshot, 1_400, { worldId: records[0].id }).ok);
  assert.equal(loadSinglePlayerSave(storage, { worldId: records[1].id }).snapshot?.world.edits.length, 0);
  const copied = cloneStorage(storage);
  const firstKeys = singlePlayerWorldStorageKeys(records[0].id);
  const secondKeys = singlePlayerWorldStorageKeys(records[1].id);
  firstKeys.forEach((key, index) => {
    const value = copied.values.get(key);
    if (value !== undefined) copied.values.set(secondKeys[index], value);
  });
  assert.equal(loadSinglePlayerSave(copied, { worldId: records[1].id }).status, "corrupt");
  const keysBefore = new Set(storage.values.keys());
  assert.deepEqual(createLocalWorld(storage, {
    name: "Seventh",
    seedText: "seventh",
    gameMode: "survival",
    now: 1_500,
  }), { ok: false, reason: "world_limit_reached", mutationStarted: false });
  assert.deepEqual(new Set(storage.values.keys()), keysBefore);
}

// Legacy bytes remain inert until explicit import/reset, and browser getter
// failures are reported without writes.
{
  const storage = new MemoryStorage();
  const legacy = createDefaultSinglePlayerSnapshot(55, 1_600);
  assert.ok(saveSinglePlayerSnapshot(storage, legacy, 1_600).ok);
  assert.equal(inspectLegacyLocalWorld(storage).status, "available");
  assert.equal(loadLocalWorldRegistry(storage).registry?.worlds.length, 0);
  const imported = importLegacyLocalWorld(storage, { name: "Imported", now: 1_601 });
  assert.ok(imported.ok);
  assert.equal(imported.world.importedLegacy, true);
  assert.ok(resetLegacyLocalWorld(storage, 1_602).ok);

  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    get() {
      throw new Error("blocked");
    },
  });
  try {
    const unavailable = browserSinglePlayerStorage();
    assert.throws(() => unavailable.getItem("x"));
    assert.throws(() => unavailable.setItem("x", "y"));
  } finally {
    if (original) Object.defineProperty(globalThis, "window", original);
    else delete (globalThis as { window?: unknown }).window;
  }
}

// A bounded deterministic history keeps IDs unique and every pending state
// settled; failures never leave external transaction keys.
{
  const storage = new MemoryStorage();
  for (let index = 0; index < 80; index += 1) {
    const loaded = loadLocalWorldRegistry(storage, 2_000 + index);
    assert.ok(loaded.registry);
    if (loaded.registry.worlds.length === 0 || (index % 4 !== 0
      && loaded.registry.worlds.length < LOCAL_WORLD_REGISTRY_MAX_WORLDS)) {
      assert.ok(createLocalWorld(storage, {
        name: `History ${index}`,
        seedText: `history-${index}`,
        gameMode: index % 2 ? "creative" : "survival",
        now: 2_000 + index,
      }).ok);
    } else {
      const world = loaded.registry.worlds[index % loaded.registry.worlds.length];
      if (index % 8 === 0) assert.ok(deleteLocalWorld(storage, world.id, 2_000 + index).ok);
      else assert.ok(touchLocalWorld(storage, world.id, 2_000 + index).ok);
    }
    const current = loadLocalWorldRegistry(storage, 10_000 + index);
    assert.ok(current.registry);
    assert.equal(new Set(current.registry.worlds.map(({ id }) => id)).size, current.registry.worlds.length);
    assert.equal(highestRegistry(storage)?.[1][5], null);
    assertNoExternalMarkers(storage);
  }
}

assert.equal(isLocalWorldRegistryTransactionReadOnly({
  status: "recovered",
  registry: { worlds: [] },
  sequence: 1,
  issues: ["transaction:active"],
}), true);
assert.equal(listLocalWorlds(new MemoryStorage()).worlds.length, 0);

console.log("local world registry integrated pending, recovery, isolation, capacity, and legacy tests passed");
