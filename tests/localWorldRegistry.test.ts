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
  LOCAL_WORLD_TRANSACTION_LEASE_MS,
  LOCAL_WORLD_NAMESPACE_BUDGET_CHARS,
  LOCAL_WORLD_REGISTRY_SLOT_A_KEY,
  LOCAL_WORLD_REGISTRY_SLOT_B_KEY,
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
  afterDeletesFor = new Map<string, () => void>();
  replaceDeletesFor = new Map<string, () => string>();
  failNextReadsFor = new Map<string, number>();
  failListKeys = false;
  listKeysCalls = 0;
  afterListKeysFor = new Map<number, () => void>();
  failListKeysFor = new Map<number, () => void>();

  private matches(key: string, configured: string | null): boolean {
    return configured !== null && (key === configured || key.startsWith(`${configured}.`));
  }

  private matchingHook<T>(hooks: Map<string, T>, key: string): [string, T] | null {
    return [...hooks.entries()].find(([configured]) => this.matches(key, configured)) ?? null;
  }

  getItem(key: string): string | null {
    if (this.matches(key, this.failReadsFor)) throw new Error("read failed");
    const remaining = this.failNextReadsFor.get(key) ?? 0;
    if (remaining > 0) {
      if (remaining === 1) this.failNextReadsFor.delete(key);
      else this.failNextReadsFor.set(key, remaining - 1);
      throw new Error("one-shot read failed");
    }
    return this.values.get(key) ?? null;
  }

  listKeys(): string[] {
    this.listKeysCalls += 1;
    const failList = this.failListKeysFor.get(this.listKeysCalls);
    if (failList) {
      this.failListKeysFor.delete(this.listKeysCalls);
      failList();
      throw new Error("one-shot enumeration failed");
    }
    if (this.failListKeys) throw new Error("enumeration failed");
    const keys = [...this.values.keys()];
    const afterList = this.afterListKeysFor.get(this.listKeysCalls);
    if (afterList) {
      this.afterListKeysFor.delete(this.listKeysCalls);
      afterList();
    }
    return keys;
  }

  setItem(key: string, value: string): void {
    if (this.matches(key, this.failWritesFor)) throw new Error("write failed");
    this.values.set(key, value);
    const replacementHook = this.matchingHook(this.replaceWritesFor, key);
    if (replacementHook) {
      this.replaceWritesFor.delete(replacementHook[0]);
      this.values.set(key, replacementHook[1](value));
    }
    const afterWrite = this.matchingHook(this.afterWritesFor, key);
    if (afterWrite) {
      this.afterWritesFor.delete(afterWrite[0]);
      afterWrite[1]();
    }
    if (this.matches(key, this.failReadAfterWriteFor)) {
      this.failReadAfterWriteFor = null;
      this.failNextReadsFor.set(key, 1);
    }
    if (this.matches(key, this.throwAfterWritesFor)) {
      this.throwAfterWritesFor = null;
      throw new Error("write result lost after durable commit");
    }
  }

  removeItem(key: string): void {
    if (this.matches(key, this.failDeletesFor)) throw new Error("delete failed");
    const replacement = this.matchingHook(this.replaceDeletesFor, key);
    if (replacement) {
      this.replaceDeletesFor.delete(replacement[0]);
      this.values.set(key, replacement[1]());
      return;
    }
    this.values.delete(key);
    const afterDelete = this.matchingHook(this.afterDeletesFor, key);
    if (afterDelete) {
      this.afterDeletesFor.delete(afterDelete[0]);
      afterDelete[1]();
    }
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

function transactionEntries(storage: MemoryStorage, prefix: string): Array<[string, string]> {
  return [...storage.values.entries()]
    .filter(([key]) => key === prefix || key.startsWith(`${prefix}.`))
    .sort(([left], [right]) => left.localeCompare(right));
}

function transactionRaw(storage: MemoryStorage, prefix: string): string | undefined {
  return transactionEntries(storage, prefix)[0]?.[1];
}

function transactionEntry(storage: MemoryStorage, prefix: string): [string, string] | undefined {
  return transactionEntries(storage, prefix)[0];
}

function cloneStorage(source: MemoryStorage): MemoryStorage {
  const clone = new MemoryStorage();
  clone.values = new Map(source.values);
  return clone;
}

function pendingCreateEntry(
  source: MemoryStorage,
  input: Parameters<typeof createLocalWorld>[1],
): [string, string] {
  const donor = cloneStorage(source);
  donor.failWritesFor = nextRegistryWriteKey(donor);
  assert.equal(createLocalWorld(donor, input).ok, false);
  const entry = transactionEntry(donor, LOCAL_WORLD_CREATE_TRANSACTION_KEY);
  assert.ok(entry);
  return entry;
}

function pendingDeleteEntry(source: MemoryStorage, worldId: string, deletedAt: number): [string, string] {
  const donor = cloneStorage(source);
  donor.failWritesFor = nextRegistryWriteKey(donor);
  donor.failDeletesFor = LOCAL_WORLD_DELETE_TRANSACTION_KEY;
  assert.equal(deleteLocalWorld(donor, worldId, deletedAt).ok, false);
  const entry = transactionEntry(donor, LOCAL_WORLD_DELETE_TRANSACTION_KEY);
  assert.ok(entry);
  return entry;
}

assert.equal(normalizeLocalWorldName("  Fern   Hollow  "), "Fern Hollow");
assert.equal(normalizeLocalWorldName(""), null);
assert.equal(normalizeLocalWorldName("x".repeat(49)), null);
assert.equal(deterministicLocalWorldSeed("Fern Hollow"), deterministicLocalWorldSeed("Fern Hollow"));
assert.equal(deterministicLocalWorldSeed("-42"), -42);
assert.notEqual(deterministicLocalWorldSeed("Fern Hollow"), deterministicLocalWorldSeed("Fern Valley"));

// Transaction keys bind the canonical envelope type, generation, digest, and
// length. Identical raw retries share one semantic key; distinct valid creates
// cannot share the key that recovery is allowed to remove.
{
  const storage = new MemoryStorage();
  const firstInput = { name: "Address A", seedText: "address-a", gameMode: "survival" as const, now: 10 };
  const secondInput = { name: "Address B", seedText: "address-b", gameMode: "creative" as const, now: 10 };
  const first = pendingCreateEntry(storage, firstInput);
  const replay = pendingCreateEntry(storage, firstInput);
  const second = pendingCreateEntry(storage, secondInput);
  assert.deepEqual(replay, first, "same canonical create bytes are the same ABA transaction");
  assert.notEqual(second[0], first[0], "distinct valid create envelopes have distinct deletable keys");
  assert.notEqual(second[1], first[1]);
  const envelope = JSON.parse(first[1]) as { format: string; generation: number; version: number };
  const suffix = first[0].slice(LOCAL_WORLD_CREATE_TRANSACTION_KEY.length + 1).split(".");
  assert.equal(envelope.format, "lakecraft.local-world-create");
  assert.equal(envelope.version, 2);
  assert.equal(Number.parseInt(suffix[0], 36), envelope.generation);
  assert.match(suffix.slice(1).join("."), /^[0-9a-z]+-[0-9a-f]{8}-[0-9a-f]{8}$/);

  const aba = new MemoryStorage();
  aba.values.set(first[0], first[1]);
  aba.replaceDeletesFor.set(first[0], () => first[1]);
  const pending = loadLocalWorldRegistry(aba);
  assert.ok(pending.issues.includes("create:recovery_pending"));
  assert.equal(aba.values.get(first[0]), first[1], "same-raw replacement remains the same pending transaction");
  assert.ok(loadLocalWorldRegistry(aba).issues.includes("create:cleanup_completed"));
  assert.equal(aba.values.has(first[0]), false);
}

// Two simultaneous creates retain independent immutable markers. Only the
// stable lexicographic winner is eligible; the losing call touches no namespace
// or registry and returns a retryable pending result.
{
  const storage = new MemoryStorage();
  const candidates = [
    {
      input: { name: "Concurrent Create A", seedText: "cc-a", gameMode: "survival" as const, now: 20 },
    },
    {
      input: { name: "Concurrent Create B", seedText: "cc-b", gameMode: "creative" as const, now: 20 },
    },
  ].map((candidate) => ({ ...candidate, entry: pendingCreateEntry(storage, candidate.input) }))
    .sort((left, right) => left.entry[0].localeCompare(right.entry[0]));
  const [winner, loser] = candidates;
  storage.afterWritesFor.set(LOCAL_WORLD_CREATE_TRANSACTION_KEY, () => {
    storage.values.set(winner.entry[0], winner.entry[1]);
  });
  assert.deepEqual(createLocalWorld(storage, loser.input), {
    ok: false,
    reason: "world_create_transaction_pending",
    mutationStarted: true,
  });
  assert.equal(transactionEntries(storage, LOCAL_WORLD_CREATE_TRANSACTION_KEY).length, 2);
  assert.equal([...storage.values.keys()].some((key) => key.includes(".save.")), false);
  assert.equal(storage.values.has(LOCAL_WORLD_REGISTRY_SLOT_A_KEY), false);
  assert.equal(storage.values.has(LOCAL_WORLD_REGISTRY_SLOT_B_KEY), false);
  const recovered = loadLocalWorldRegistry(storage);
  assert.equal(recovered.registry?.worlds.length, 0);
  assert.equal(transactionEntries(storage, LOCAL_WORLD_CREATE_TRANSACTION_KEY).length, 0);
  assert.ok(createLocalWorld(storage, loser.input).ok);
}

// A concurrent create sorts ahead of a delete but cannot make the losing
// delete remove or rewrite anything before election. Restart recovery handles
// both immutable keys in deterministic order.
{
  const storage = new MemoryStorage();
  const kept = createLocalWorld(storage, { name: "Create Delete Kept", seedText: "cd-kept", gameMode: "survival", now: 30 });
  assert.ok(kept.ok);
  const keptKeys = singlePlayerWorldStorageKeys(kept.world.id);
  const keptValues = keptKeys.map((key) => storage.values.get(key) ?? null);
  const registryValues = [LOCAL_WORLD_REGISTRY_SLOT_A_KEY, LOCAL_WORLD_REGISTRY_SLOT_B_KEY]
    .map((key) => storage.values.get(key) ?? null);
  const createEntry = pendingCreateEntry(storage, {
    name: "Create Delete New",
    seedText: "cd-new",
    gameMode: "creative",
    now: 31,
  });
  storage.afterWritesFor.set(LOCAL_WORLD_DELETE_TRANSACTION_KEY, () => {
    storage.values.set(createEntry[0], createEntry[1]);
  });
  assert.deepEqual(deleteLocalWorld(storage, kept.world.id, 31), {
    ok: false,
    reason: "world_delete_transaction_pending",
    mutationStarted: true,
  });
  assert.deepEqual(keptKeys.map((key) => storage.values.get(key) ?? null), keptValues);
  assert.deepEqual(
    [LOCAL_WORLD_REGISTRY_SLOT_A_KEY, LOCAL_WORLD_REGISTRY_SLOT_B_KEY].map((key) => storage.values.get(key) ?? null),
    registryValues,
  );
  assert.equal(
    transactionEntries(storage, LOCAL_WORLD_CREATE_TRANSACTION_KEY).length
      + transactionEntries(storage, LOCAL_WORLD_DELETE_TRANSACTION_KEY).length,
    2,
  );
  const restarted = loadLocalWorldRegistry(storage);
  assert.ok(restarted.registry?.worlds.some(({ id }) => id === kept.world.id));
  assert.deepEqual(keptKeys.map((key) => storage.values.get(key) ?? null), keptValues);
  assert.equal(transactionEntries(storage, LOCAL_WORLD_CREATE_TRANSACTION_KEY).length, 0);
  assert.equal(transactionEntries(storage, LOCAL_WORLD_DELETE_TRANSACTION_KEY).length, 0);
}

// Simultaneous deletes for different IDs also receive distinct immutable keys.
// The stable loser cannot advance the registry or either world namespace.
{
  const storage = new MemoryStorage();
  const first = createLocalWorld(storage, { name: "Delete Race A", seedText: "dd-a", gameMode: "survival", now: 40 });
  const second = createLocalWorld(storage, { name: "Delete Race B", seedText: "dd-b", gameMode: "creative", now: 41 });
  assert.ok(first.ok && second.ok);
  const candidates = [first.world, second.world]
    .map((world) => ({ world, entry: pendingDeleteEntry(storage, world.id, 42) }))
    .sort((left, right) => left.entry[0].localeCompare(right.entry[0]));
  assert.notEqual(candidates[0].entry[0], candidates[1].entry[0]);
  assert.deepEqual(
    pendingDeleteEntry(storage, candidates[0].world.id, 42),
    candidates[0].entry,
    "same delete bytes replay to the same semantic key",
  );
  const [winner, loser] = candidates;
  const worldKeys = [first.world, second.world].flatMap(({ id }) => singlePlayerWorldStorageKeys(id));
  const worldValues = worldKeys.map((key) => storage.values.get(key) ?? null);
  const registryValues = [LOCAL_WORLD_REGISTRY_SLOT_A_KEY, LOCAL_WORLD_REGISTRY_SLOT_B_KEY]
    .map((key) => storage.values.get(key) ?? null);
  storage.afterWritesFor.set(LOCAL_WORLD_DELETE_TRANSACTION_KEY, () => {
    storage.values.set(winner.entry[0], winner.entry[1]);
  });
  assert.deepEqual(deleteLocalWorld(storage, loser.world.id, 42), {
    ok: false,
    reason: "world_delete_transaction_pending",
    mutationStarted: true,
  });
  assert.deepEqual(worldKeys.map((key) => storage.values.get(key) ?? null), worldValues);
  assert.deepEqual(
    [LOCAL_WORLD_REGISTRY_SLOT_A_KEY, LOCAL_WORLD_REGISTRY_SLOT_B_KEY].map((key) => storage.values.get(key) ?? null),
    registryValues,
  );
  const restarted = loadLocalWorldRegistry(storage);
  assert.equal(restarted.registry?.worlds.length, 2);
  assert.deepEqual(worldKeys.map((key) => storage.values.get(key) ?? null), worldValues);
  assert.equal(transactionEntries(storage, LOCAL_WORLD_DELETE_TRANSACTION_KEY).length, 0);
}

// Prefix enumeration is a guarded compatibility boundary. Throws and a key
// appearing between scan passes fail closed while healthy worlds stay readable.
{
  const storage = new MemoryStorage();
  const kept = createLocalWorld(storage, { name: "Enumeration Kept", seedText: "enum", gameMode: "survival", now: 50 });
  assert.ok(kept.ok);
  const keptKeys = singlePlayerWorldStorageKeys(kept.world.id);
  const keptValues = keptKeys.map((key) => storage.values.get(key) ?? null);
  storage.failListKeys = true;
  const readable = listLocalWorlds(storage);
  assert.equal(readable.worlds.length, 1);
  assert.ok(readable.registryLoad.issues.includes("transaction:enumeration_failed"));
  assert.deepEqual(createLocalWorld(storage, {
    name: "Enumeration Blocked",
    seedText: "blocked",
    gameMode: "creative",
    now: 51,
  }), { ok: false, reason: "world_create_recovery_pending", mutationStarted: false });
  assert.deepEqual(deleteLocalWorld(storage, kept.world.id, 51),
    { ok: false, reason: "world_delete_recovery_pending", mutationStarted: false });
  assert.deepEqual(resetLocalWorldData(storage, kept.world.id, 51),
    { ok: false, reason: "world_reset_recovery_pending", mutationStarted: false });
  assert.deepEqual(keptKeys.map((key) => storage.values.get(key) ?? null), keptValues);

  storage.failListKeys = false;
  const inserted = pendingCreateEntry(storage, {
    name: "Enumeration Drift",
    seedText: "drift",
    gameMode: "creative",
    now: 52,
  });
  storage.afterListKeysFor.set(storage.listKeysCalls + 1, () => {
    storage.values.set(inserted[0], inserted[1]);
  });
  const drifted = loadLocalWorldRegistry(storage);
  assert.ok(drifted.issues.includes("transaction:enumeration_failed"));
  assert.equal(storage.values.get(inserted[0]), inserted[1]);
  assert.deepEqual(keptKeys.map((key) => storage.values.get(key) ?? null), keptValues);
  assert.ok(loadLocalWorldRegistry(storage).issues.includes("create:cleanup_completed"));
  assert.equal(storage.values.has(inserted[0]), false);
}

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

// An elected transaction owns its commit window. Re-entrant create/delete
// calls from every create namespace/registry write must remain pre-mutation,
// while the elected writer completes as the only successful operation.
for (const [index, nestedKind] of ["create", "delete", "create"].entries()) {
  const storage = new MemoryStorage();
  const sibling = createLocalWorld(storage, {
    name: `Lease Create Sibling ${index}`,
    seedText: `lease-create-sibling-${index}`,
    gameMode: "survival",
    now: 9_000 + index,
  });
  assert.ok(sibling.ok);
  const outerInput = {
    name: `Lease Outer Create ${index}`,
    seedText: `lease-outer-create-${index}`,
    gameMode: "creative" as const,
    now: 10_000 + index * 10,
  };
  const intended = pendingCreateEntry(storage, outerInput);
  const intendedId = (JSON.parse(intended[1]) as { world: { id: string } }).world.id;
  const targets = [
    singlePlayerWorldStorageKey(intendedId, SINGLEPLAYER_SAVE_SLOT_A_KEY),
    singlePlayerWorldStorageKey(intendedId, SINGLEPLAYER_SAVE_HEAD_KEY),
    nextRegistryWriteKey(storage),
  ];
  let nested: ReturnType<typeof createLocalWorld> | ReturnType<typeof deleteLocalWorld> | null = null;
  storage.afterWritesFor.set(targets[index], () => {
    nested = nestedKind === "create"
      ? createLocalWorld(storage, {
        name: `Lease Nested Create ${index}`,
        seedText: `lease-nested-create-${index}`,
        gameMode: "survival",
        now: outerInput.now + 1,
      })
      : deleteLocalWorld(storage, sibling.world.id, outerInput.now + 1);
  });
  const outer = createLocalWorld(storage, outerInput);
  assert.ok(outer.ok);
  assert.deepEqual(nested, {
    ok: false,
    reason: nestedKind === "create" ? "world_create_recovery_pending" : "world_delete_recovery_pending",
    mutationStarted: false,
  });
  const listed = loadLocalWorldRegistry(storage, outerInput.now + 1);
  assert.deepEqual(
    listed.registry?.worlds.map(({ id }) => id).sort(),
    [sibling.world.id, outer.world.id].sort(),
  );
  assert.equal(transactionEntries(storage, LOCAL_WORLD_CREATE_TRANSACTION_KEY).length, 0);
  assert.equal(transactionEntries(storage, LOCAL_WORLD_DELETE_TRANSACTION_KEY).length, 0);
}

// Delete holds the same lease through its registry commit and each namespace
// removal. Nested create/delete attempts cannot both report success or leave an
// unlisted save behind.
for (const [index, nestedKind] of ["create", "delete", "create", "delete", "create"].entries()) {
  const storage = new MemoryStorage();
  const deleted = createLocalWorld(storage, {
    name: `Lease Delete Target ${index}`,
    seedText: `lease-delete-target-${index}`,
    gameMode: "survival",
    now: 19_000 + index,
  });
  const sibling = createLocalWorld(storage, {
    name: `Lease Delete Sibling ${index}`,
    seedText: `lease-delete-sibling-${index}`,
    gameMode: "creative",
    now: 19_100 + index,
  });
  assert.ok(deleted.ok && sibling.ok);
  const targets = [nextRegistryWriteKey(storage), ...singlePlayerWorldStorageKeys(deleted.world.id)];
  let nested: ReturnType<typeof createLocalWorld> | ReturnType<typeof deleteLocalWorld> | null = null;
  const hook = () => {
    nested = nestedKind === "create"
      ? createLocalWorld(storage, {
        name: `Lease Delete Nested Create ${index}`,
        seedText: `lease-delete-nested-${index}`,
        gameMode: "survival",
        now: 20_001 + index * 10,
      })
      : deleteLocalWorld(storage, sibling.world.id, 20_001 + index * 10);
  };
  if (index === 0) storage.afterWritesFor.set(targets[index], hook);
  else storage.afterDeletesFor.set(targets[index], hook);
  const outer = deleteLocalWorld(storage, deleted.world.id, 20_000 + index * 10);
  assert.ok(outer.ok);
  assert.deepEqual(nested, {
    ok: false,
    reason: nestedKind === "create" ? "world_create_recovery_pending" : "world_delete_recovery_pending",
    mutationStarted: false,
  });
  const listed = loadLocalWorldRegistry(storage, 20_001 + index * 10);
  assert.deepEqual(listed.registry?.worlds.map(({ id }) => id), [sibling.world.id]);
  assert.deepEqual(singlePlayerWorldStorageKeys(deleted.world.id).map((key) => storage.values.get(key) ?? null),
    [null, null, null, null]);
  assert.ok(loadSinglePlayerSave(storage, { migrateLegacy: false, worldId: sibling.world.id }).snapshot);
}

// A restart treats a lease as live until its exact bounded deadline, then
// recovers it as abandoned. A malformed lease is opaque and can only have its
// marker cleared.
{
  const storage = new MemoryStorage();
  storage.failWritesFor = nextRegistryWriteKey(storage);
  const startedAt = 30_000;
  const failed = createLocalWorld(storage, {
    name: "Lease Restart",
    seedText: "lease-restart",
    gameMode: "survival",
    now: startedAt,
  });
  assert.ok(!failed.ok);
  storage.failWritesFor = null;
  const entry = transactionEntry(storage, LOCAL_WORLD_CREATE_TRANSACTION_KEY);
  assert.ok(entry);
  const envelope = JSON.parse(entry[1]) as { recoverAfter: number; world: { id: string } };
  assert.equal(envelope.recoverAfter, startedAt + LOCAL_WORLD_TRANSACTION_LEASE_MS);
  const keys = singlePlayerWorldStorageKeys(envelope.world.id);
  const before = keys.map((key) => storage.values.get(key) ?? null);
  const live = loadLocalWorldRegistry(storage, envelope.recoverAfter - 1);
  assert.ok(live.issues.includes("transaction:active"));
  assert.deepEqual(keys.map((key) => storage.values.get(key) ?? null), before);
  assert.equal(storage.values.get(entry[0]), entry[1]);
  const expired = loadLocalWorldRegistry(storage, envelope.recoverAfter);
  assert.ok(expired.issues.includes("create:cleanup_completed"));
  assert.deepEqual(keys.map((key) => storage.values.get(key) ?? null), [null, null, null, null]);

  const malformed = pendingCreateEntry(storage, {
    name: "Malformed Lease",
    seedText: "malformed-lease",
    gameMode: "creative",
    now: 40_000,
  });
  const malformedRaw = malformed[1].replace(
    `"recoverAfter":${40_000 + LOCAL_WORLD_TRANSACTION_LEASE_MS}`,
    `"recoverAfter":${40_001 + LOCAL_WORLD_TRANSACTION_LEASE_MS}`,
  );
  assert.notEqual(malformedRaw, malformed[1]);
  storage.values.set(malformed[0], malformedRaw);
  const malformedWorld = (JSON.parse(malformed[1]) as { world: { id: string } }).world;
  const unrelatedBefore = singlePlayerWorldStorageKeys(malformedWorld.id)
    .map((key) => storage.values.get(key) ?? null);
  const cleared = loadLocalWorldRegistry(storage, 40_000);
  assert.ok(cleared.issues.includes("create:invalid_transaction_cleared"));
  assert.deepEqual(singlePlayerWorldStorageKeys(malformedWorld.id).map((key) => storage.values.get(key) ?? null),
    unrelatedBefore);
}

// A registry generation changed after election is never overwritten from a
// stale snapshot. The exact intent remains pending until expiry decides its
// namespace against the newer authoritative registry.
{
  const storage = new MemoryStorage();
  const sibling = createLocalWorld(storage, {
    name: "Generation Authority",
    seedText: "generation-authority",
    gameMode: "survival",
    now: 50_000,
  });
  assert.ok(sibling.ok);
  const competitor = cloneStorage(storage);
  const advanced = touchLocalWorld(competitor, sibling.world.id, 50_010);
  assert.ok(advanced.ok);
  const target = nextRegistryWriteKey(storage);
  const competingRaw = competitor.values.get(target);
  assert.ok(competingRaw);
  const outerInput = {
    name: "Stale Generation Create",
    seedText: "stale-generation-create",
    gameMode: "creative" as const,
    now: 50_020,
  };
  const intended = pendingCreateEntry(storage, outerInput);
  const intendedWorld = (JSON.parse(intended[1]) as { world: { id: string } }).world;
  storage.afterWritesFor.set(
    singlePlayerWorldStorageKey(intendedWorld.id, SINGLEPLAYER_SAVE_SLOT_A_KEY),
    () => storage.values.set(target, competingRaw),
  );
  const stale = createLocalWorld(storage, outerInput);
  assert.deepEqual(stale, {
    ok: false,
    reason: "registry_stale_registry_transaction_pending",
    mutationStarted: true,
  });
  assert.equal(loadLocalWorldRegistry(storage, outerInput.now + 1).issues.includes("transaction:active"), true);
  assert.equal(storage.values.get(target), competingRaw);
  assert.equal(transactionEntries(storage, LOCAL_WORLD_CREATE_TRANSACTION_KEY).length, 1);
  const recovered = loadLocalWorldRegistry(
    storage,
    outerInput.now + LOCAL_WORLD_TRANSACTION_LEASE_MS,
  );
  assert.ok(recovered.issues.includes("create:cleanup_completed"));
  assert.equal(recovered.registry?.worlds.some(({ id }) => id === intendedWorld.id), false);
  assert.deepEqual(singlePlayerWorldStorageKeys(intendedWorld.id).map((key) => storage.values.get(key) ?? null),
    [null, null, null, null]);
}

// If a peer publishes a different payload at the same next generation during
// readback, neither slot wins by name. The writer reports pending and restart
// exposes the conflict without clearing the intent or either namespace.
{
  const storage = new MemoryStorage();
  const sibling = createLocalWorld(storage, {
    name: "Equal Generation Authority",
    seedText: "equal-generation-authority",
    gameMode: "survival",
    now: 55_000,
  });
  assert.ok(sibling.ok);
  const competitor = cloneStorage(storage);
  assert.ok(touchLocalWorld(competitor, sibling.world.id, 55_010).ok);
  const target = nextRegistryWriteKey(storage);
  const previous = target === LOCAL_WORLD_REGISTRY_SLOT_A_KEY
    ? LOCAL_WORLD_REGISTRY_SLOT_B_KEY
    : LOCAL_WORLD_REGISTRY_SLOT_A_KEY;
  const competingRaw = competitor.values.get(target);
  assert.ok(competingRaw);
  storage.afterWritesFor.set(target, () => storage.values.set(previous, competingRaw));
  const outer = createLocalWorld(storage, {
    name: "Equal Generation Create",
    seedText: "equal-generation-create",
    gameMode: "creative",
    now: 55_020,
  });
  assert.deepEqual(outer, {
    ok: false,
    reason: "registry_stale_registry_transaction_pending",
    mutationStarted: true,
  });
  const marker = transactionEntry(storage, LOCAL_WORLD_CREATE_TRANSACTION_KEY);
  assert.ok(marker);
  const intendedId = (JSON.parse(marker[1]) as { world: { id: string } }).world.id;
  const restarted = loadLocalWorldRegistry(
    storage,
    55_020 + LOCAL_WORLD_TRANSACTION_LEASE_MS,
  );
  assert.equal(restarted.status, "corrupt");
  assert.ok(restarted.issues.includes("registry:generation_conflict"));
  assert.ok(restarted.issues.includes("create:recovery_pending"));
  assert.equal(storage.values.get(marker[0]), marker[1]);
  assert.ok(singlePlayerWorldStorageKeys(intendedId).some((key) => storage.values.has(key)));
  assert.ok(loadSinglePlayerSave(storage, { migrateLegacy: false, worldId: sibling.world.id }).snapshot);
}

// Opaque transaction enumeration makes even a healthy listing read-only.
// Play and every mutation fail before writing until enumeration recovers.
{
  const storage = new MemoryStorage();
  const created = createLocalWorld(storage, {
    name: "Read Only Play",
    seedText: "read-only-play",
    gameMode: "survival",
    now: 60_000,
  });
  assert.ok(created.ok);
  storage.failListKeys = true;
  const listing = listLocalWorlds(storage);
  const selected = listing.worlds.find(({ world }) => world.id === created.world.id);
  assert.ok(selected && selected.health === "healthy");
  assert.equal(isLocalWorldRegistryTransactionReadOnly(listing.registryLoad), true);
  const storageBefore = new Map(storage.values);
  const touched = touchLocalWorld(storage, created.world.id, 60_001, selected.world);
  assert.deepEqual(touched, {
    ok: false,
    reason: "world_touch_recovery_pending",
    mutationStarted: false,
  });
  const playable = resolveLocalWorldPlay(storage, selected, touched);
  let mounted = 0;
  if (playable) mounted += 1;
  assert.equal(mounted, 0);
  assert.equal(playable, null);
  assert.deepEqual(storage.values, storageBefore);
  assert.deepEqual(deleteLocalWorld(storage, created.world.id, 60_001),
    { ok: false, reason: "world_delete_recovery_pending", mutationStarted: false });
  assert.deepEqual(resetLocalWorldData(storage, created.world.id, 60_001),
    { ok: false, reason: "world_reset_recovery_pending", mutationStarted: false });
  assert.deepEqual(createLocalWorld(storage, {
    name: "Blocked Create",
    seedText: "blocked-create",
    gameMode: "creative",
    now: 60_001,
  }), { ok: false, reason: "world_create_recovery_pending", mutationStarted: false });
  assert.deepEqual(importLegacyLocalWorld(storage, { name: "Blocked Import", now: 60_001 }),
    { ok: false, reason: "world_import_recovery_pending", mutationStarted: false });
  assert.equal(resolveLocalWorldPlay(storage, selected, {
    ok: false,
    reason: "registry_readback_failed",
    mutationStarted: true,
  }), null);
  assert.deepEqual(storage.values, storageBefore);
  storage.failListKeys = false;
  assert.equal(isLocalWorldRegistryTransactionReadOnly(listLocalWorlds(storage).registryLoad), false);
  assert.equal(resolveLocalWorldPlay(storage, selected, touched)?.id, created.world.id);
}

// A stale selection from before a committed delete cannot use the read-only
// fallback merely because deletion-marker cleanup is still active.
{
  const storage = new MemoryStorage();
  const created = createLocalWorld(storage, {
    name: "Deleted Before Play",
    seedText: "deleted-before-play",
    gameMode: "survival",
    now: 70_000,
  });
  assert.ok(created.ok);
  const selected = listLocalWorlds(storage).worlds[0];
  assert.equal(selected.world.id, created.world.id);
  storage.failDeletesFor = LOCAL_WORLD_DELETE_TRANSACTION_KEY;
  assert.deepEqual(deleteLocalWorld(storage, created.world.id, 70_010), {
    ok: false,
    reason: "world_delete_cleanup_pending",
    mutationStarted: true,
  });
  const touched = touchLocalWorld(storage, created.world.id, 70_011, selected.world);
  assert.deepEqual(touched, { ok: false, reason: "world_not_found", mutationStarted: false });
  assert.equal(resolveLocalWorldPlay(storage, selected, touched), null);
  assert.deepEqual(singlePlayerWorldStorageKeys(created.world.id).map((key) => storage.values.has(key)),
    [false, false, false, false]);
  assert.equal(loadSinglePlayerSave(storage, { migrateLegacy: false, worldId: created.world.id }).status, "empty");
}

// A selected world's live pre-commit delete marker is also unsafe: its owner
// can still resume and commit after Play returns, so healthy bytes alone are
// not sufficient fallback proof.
{
  const storage = new MemoryStorage();
  const created = createLocalWorld(storage, {
    name: "Delete Owner Before Play",
    seedText: "delete-owner-before-play",
    gameMode: "survival",
    now: 70_100,
  });
  assert.ok(created.ok);
  const selected = listLocalWorlds(storage).worlds[0];
  storage.failWritesFor = nextRegistryWriteKey(storage);
  storage.failDeletesFor = LOCAL_WORLD_DELETE_TRANSACTION_KEY;
  assert.deepEqual(deleteLocalWorld(storage, created.world.id, 70_110), {
    ok: false,
    reason: "registry_storage_write_failed_transaction_pending",
    mutationStarted: true,
  });
  storage.failWritesFor = null;
  const touched = touchLocalWorld(storage, created.world.id, 70_111, selected.world);
  assert.deepEqual(touched, {
    ok: false,
    reason: "world_touch_recovery_pending",
    mutationStarted: false,
  });
  assert.equal(resolveLocalWorldPlay(storage, selected, touched), null);
  assert.ok(loadSinglePlayerSave(storage, { migrateLegacy: false, worldId: created.world.id }).snapshot);
}

// A selected-world delete that publishes its marker immediately after the
// opening transaction scan must still be observed by the closing scan. This is
// the exact cross-tab window between transaction and registry revalidation.
{
  const storage = new MemoryStorage();
  const created = createLocalWorld(storage, {
    name: "Delete Published During Play",
    seedText: "delete-published-during-play",
    gameMode: "survival",
    now: 70_150,
  });
  assert.ok(created.ok);
  const selected = listLocalWorlds(storage).worlds[0];
  const pausedOwner = new MemoryStorage();
  pausedOwner.values = new Map(storage.values);
  pausedOwner.failWritesFor = nextRegistryWriteKey(pausedOwner);
  pausedOwner.failDeletesFor = LOCAL_WORLD_DELETE_TRANSACTION_KEY;
  assert.deepEqual(deleteLocalWorld(pausedOwner, created.world.id, 70_160), {
    ok: false,
    reason: "registry_storage_write_failed_transaction_pending",
    mutationStarted: true,
  });
  const marker = transactionEntry(pausedOwner, LOCAL_WORLD_DELETE_TRANSACTION_KEY);
  assert.ok(marker);

  storage.failListKeys = true;
  const touched = touchLocalWorld(storage, created.world.id, 70_161, selected.world);
  storage.failListKeys = false;
  assert.deepEqual(touched, {
    ok: false,
    reason: "world_touch_recovery_pending",
    mutationStarted: false,
  });
  const before = new Map(storage.values);
  storage.afterListKeysFor.set(storage.listKeysCalls + 3, () => {
    storage.values.set(marker[0], marker[1]);
  });
  assert.equal(resolveLocalWorldPlay(storage, selected, touched), null);
  assert.equal(storage.values.get(marker[0]), marker[1]);
  for (const [key, value] of before) assert.equal(storage.values.get(key), value);
  assert.equal(storage.values.size, before.size + 1);
}

// Failed scans are never comparable. In the exact reviewer bypass, the opening
// list throws while publishing a selected-world delete marker, then the closing
// list sees its key while the marker body read throws. Both opaque results must
// block Play without changing any pre-existing byte.
{
  const storage = new MemoryStorage();
  const created = createLocalWorld(storage, {
    name: "Opaque Delete During Play",
    seedText: "opaque-delete-during-play",
    gameMode: "survival",
    now: 70_170,
  });
  assert.ok(created.ok);
  const selected = listLocalWorlds(storage).worlds[0];
  const pausedOwner = new MemoryStorage();
  pausedOwner.values = new Map(storage.values);
  pausedOwner.failWritesFor = nextRegistryWriteKey(pausedOwner);
  pausedOwner.failDeletesFor = LOCAL_WORLD_DELETE_TRANSACTION_KEY;
  assert.deepEqual(deleteLocalWorld(pausedOwner, created.world.id, 70_180), {
    ok: false,
    reason: "registry_storage_write_failed_transaction_pending",
    mutationStarted: true,
  });
  const marker = transactionEntry(pausedOwner, LOCAL_WORLD_DELETE_TRANSACTION_KEY);
  assert.ok(marker);

  storage.failListKeys = true;
  const touched = touchLocalWorld(storage, created.world.id, 70_181, selected.world);
  storage.failListKeys = false;
  assert.deepEqual(touched, {
    ok: false,
    reason: "world_touch_recovery_pending",
    mutationStarted: false,
  });
  const before = new Map(storage.values);
  const openingList = storage.listKeysCalls + 1;
  storage.failListKeysFor.set(openingList, () => storage.values.set(marker[0], marker[1]));
  storage.afterListKeysFor.set(openingList + 1, () => {
    storage.failReadsFor = marker[0];
  });
  assert.equal(resolveLocalWorldPlay(storage, selected, touched), null);
  storage.failReadsFor = null;
  assert.equal(storage.values.get(marker[0]), marker[1]);
  for (const [key, value] of before) assert.equal(storage.values.get(key), value);
  assert.equal(storage.values.size, before.size + 1);
}

// A delete-cleanup marker for another world does not unnecessarily hide an
// unchanged registered healthy sibling.
{
  const storage = new MemoryStorage();
  const kept = createLocalWorld(storage, {
    name: "Sibling Play During Delete",
    seedText: "sibling-play-during-delete",
    gameMode: "creative",
    now: 70_200,
  });
  const deleted = createLocalWorld(storage, {
    name: "Other Delete During Play",
    seedText: "other-delete-during-play",
    gameMode: "survival",
    now: 70_201,
  });
  assert.ok(kept.ok && deleted.ok);
  const selected = listLocalWorlds(storage).worlds.find(({ world }) => world.id === kept.world.id);
  assert.ok(selected);
  storage.failDeletesFor = LOCAL_WORLD_DELETE_TRANSACTION_KEY;
  assert.deepEqual(deleteLocalWorld(storage, deleted.world.id, 70_210), {
    ok: false,
    reason: "world_delete_cleanup_pending",
    mutationStarted: true,
  });
  const touched = touchLocalWorld(storage, kept.world.id, 70_211, selected.world);
  assert.deepEqual(touched, {
    ok: false,
    reason: "world_touch_recovery_pending",
    mutationStarted: false,
  });
  const before = [LOCAL_WORLD_REGISTRY_SLOT_A_KEY, LOCAL_WORLD_REGISTRY_SLOT_B_KEY]
    .map((key) => storage.values.get(key) ?? null);
  assert.equal(resolveLocalWorldPlay(storage, selected, touched)?.id, kept.world.id);
  assert.deepEqual([LOCAL_WORLD_REGISTRY_SLOT_A_KEY, LOCAL_WORLD_REGISTRY_SLOT_B_KEY]
    .map((key) => storage.values.get(key) ?? null), before);
}

// An unchanged unrelated transaction is safe, but an error or any transaction
// drift inside the closing scan fails the read-only fallback closed.
for (const closingChange of ["throw", "appear", "replace"] as const) {
  const storage = new MemoryStorage();
  const kept = createLocalWorld(storage, {
    name: `Closing Scan ${closingChange}`,
    seedText: `closing-scan-${closingChange}`,
    gameMode: "creative",
    now: 70_300,
  });
  const other = createLocalWorld(storage, {
    name: `Closing Scan Other ${closingChange}`,
    seedText: `closing-scan-other-${closingChange}`,
    gameMode: "survival",
    now: 70_301,
  });
  assert.ok(kept.ok && other.ok);
  const selected = listLocalWorlds(storage).worlds.find(({ world }) => world.id === kept.world.id);
  assert.ok(selected);
  storage.failWritesFor = nextRegistryWriteKey(storage);
  storage.failDeletesFor = LOCAL_WORLD_DELETE_TRANSACTION_KEY;
  assert.deepEqual(deleteLocalWorld(storage, other.world.id, 70_310), {
    ok: false,
    reason: "registry_storage_write_failed_transaction_pending",
    mutationStarted: true,
  });
  storage.failWritesFor = null;
  const existingMarker = transactionEntry(storage, LOCAL_WORLD_DELETE_TRANSACTION_KEY);
  assert.ok(existingMarker);
  const touched = touchLocalWorld(storage, kept.world.id, 70_311, selected.world);
  assert.deepEqual(touched, {
    ok: false,
    reason: "world_touch_recovery_pending",
    mutationStarted: false,
  });
  const before = new Map(storage.values);
  const closingFirstList = storage.listKeysCalls + 4;
  storage.afterListKeysFor.set(closingFirstList, () => {
    if (closingChange === "throw") {
      storage.failListKeys = true;
    } else if (closingChange === "appear") {
      storage.values.set(`${LOCAL_WORLD_CREATE_TRANSACTION_KEY}.appeared`, "{}");
    } else {
      storage.values.set(existingMarker[0], `${existingMarker[1]} `);
    }
  });
  assert.equal(resolveLocalWorldPlay(storage, selected, touched), null);
  storage.failListKeys = false;
  if (closingChange === "throw") assert.deepEqual(storage.values, before);
  else {
    for (const [key, value] of before) {
      if (closingChange === "replace" && key === existingMarker[0]) continue;
      assert.equal(storage.values.get(key), value);
    }
  }
}

// A stale record with the same ID is also rejected before the recovery gate,
// so old metadata cannot authorize mounting a replaced registry generation.
{
  const storage = new MemoryStorage();
  const created = createLocalWorld(storage, {
    name: "Changed Before Play",
    seedText: "changed-before-play",
    gameMode: "creative",
    now: 71_000,
  });
  assert.ok(created.ok);
  const selected = listLocalWorlds(storage).worlds[0];
  assert.ok(touchLocalWorld(storage, created.world.id, 71_010).ok);
  storage.failListKeys = true;
  const touched = touchLocalWorld(storage, created.world.id, 71_011, selected.world);
  assert.deepEqual(touched, { ok: false, reason: "world_changed", mutationStarted: false });
  assert.equal(resolveLocalWorldPlay(storage, selected, touched), null);
}

// Even with an exact pre-mutation enumeration failure, current missing or
// corrupt save bytes invalidate the stale healthy inspection.
for (const damage of ["missing", "corrupt"] as const) {
  const storage = new MemoryStorage();
  const created = createLocalWorld(storage, {
    name: `Damaged Before Play ${damage}`,
    seedText: `damaged-before-play-${damage}`,
    gameMode: "survival",
    now: damage === "missing" ? 72_000 : 73_000,
  });
  assert.ok(created.ok);
  const selected = listLocalWorlds(storage).worlds[0];
  const keys = singlePlayerWorldStorageKeys(created.world.id);
  if (damage === "missing") {
    for (const key of keys) storage.values.delete(key);
  } else {
    storage.values.set(singlePlayerWorldStorageKey(created.world.id, SINGLEPLAYER_SAVE_SLOT_A_KEY), "{");
    storage.values.set(singlePlayerWorldStorageKey(created.world.id, SINGLEPLAYER_SAVE_SLOT_B_KEY), "[");
  }
  storage.failListKeys = true;
  const touched = touchLocalWorld(
    storage,
    created.world.id,
    damage === "missing" ? 72_001 : 73_001,
    selected.world,
  );
  assert.deepEqual(touched, {
    ok: false,
    reason: "world_touch_recovery_pending",
    mutationStarted: false,
  });
  assert.equal(resolveLocalWorldPlay(storage, selected, touched), null);
}

// Marker-clear failure after a committed create leaves a registered healthy
// world. This is the positive pending-cleanup case: Play mounts read-only
// without changing registry bytes.
{
  const storage = new MemoryStorage();
  const now = Date.now();
  storage.failDeletesFor = LOCAL_WORLD_CREATE_TRANSACTION_KEY;
  const created = createLocalWorld(storage, {
    name: "Create Marker Play",
    seedText: "create-marker-play",
    gameMode: "survival",
    now,
  });
  assert.ok(created.ok);
  const selected = listLocalWorlds(storage).worlds[0];
  assert.equal(selected.health, "healthy");
  const before = [LOCAL_WORLD_REGISTRY_SLOT_A_KEY, LOCAL_WORLD_REGISTRY_SLOT_B_KEY]
    .map((key) => storage.values.get(key) ?? null);
  const touched = touchLocalWorld(storage, created.world.id, now + 1, selected.world);
  assert.deepEqual(touched, {
    ok: false,
    reason: "world_touch_recovery_pending",
    mutationStarted: false,
  });
  assert.equal(resolveLocalWorldPlay(storage, selected, touched)?.id, created.world.id);
  assert.deepEqual([LOCAL_WORLD_REGISTRY_SLOT_A_KEY, LOCAL_WORLD_REGISTRY_SLOT_B_KEY]
    .map((key) => storage.values.get(key) ?? null), before);
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
  assert.equal(transactionEntries(markerStorage, LOCAL_WORLD_CREATE_TRANSACTION_KEY).length, 1);
  assert.equal([...markerStorage.values.keys()].some((key) => key.includes(".save.")), false);
  assert.ok(loadLocalWorldRegistry(markerStorage).issues.includes("create:cleanup_completed"));
  assert.equal(transactionEntries(markerStorage, LOCAL_WORLD_CREATE_TRANSACTION_KEY).length, 0);

  const registryStorage = new MemoryStorage();
  const registryInput = { name: "Registry Durable", seedText: "registry-durable", gameMode: "creative" as const, now: 103 };
  registryStorage.throwAfterWritesFor = nextRegistryWriteKey(registryStorage);
  const ambiguous = createLocalWorld(registryStorage, registryInput);
  assert.deepEqual(ambiguous, {
    ok: false,
    reason: "registry_storage_write_failed_transaction_pending",
    mutationStarted: true,
  });
  assert.equal(transactionEntries(registryStorage, LOCAL_WORLD_CREATE_TRANSACTION_KEY).length, 1);
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
  const pendingRaw = transactionRaw(storage, LOCAL_WORLD_CREATE_TRANSACTION_KEY);
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
  const otherIntent = transactionRaw(donor, LOCAL_WORLD_CREATE_TRANSACTION_KEY);
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
  assert.ok(loadLocalWorldRegistry(storage).issues.includes("create:invalid_transaction_cleared"));
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
  const transaction = JSON.parse(transactionRaw(storage, LOCAL_WORLD_CREATE_TRANSACTION_KEY)!) as { world: { id: string } };
  const intendedKeys = singlePlayerWorldStorageKeys(transaction.world.id);
  storage.failWritesFor = null;
  storage.failDeletesFor = intendedKeys[1];
  for (let retry = 0; retry < 2; retry += 1) {
    assert.ok(loadLocalWorldRegistry(storage).issues.includes("create:recovery_pending"));
    assert.equal(transactionEntries(storage, LOCAL_WORLD_CREATE_TRANSACTION_KEY).length, 1);
    assert.deepEqual(siblingKeys.map((key) => storage.values.get(key) ?? null), siblingValues);
  }
  storage.failDeletesFor = null;
  assert.ok(loadLocalWorldRegistry(storage).issues.includes("create:cleanup_completed"));
  assert.deepEqual(intendedKeys.map((key) => storage.values.get(key) ?? null), [null, null, null, null]);
  const retried = createLocalWorld(storage, input);
  assert.ok(retried.ok);
  assert.equal(loadLocalWorldRegistry(storage).registry?.worlds.length, 2);
  assert.equal(transactionEntries(storage, LOCAL_WORLD_CREATE_TRANSACTION_KEY).length, 0);
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
  assert.equal(transactionEntries(storage, LOCAL_WORLD_CREATE_TRANSACTION_KEY).length, 1);
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
  assert.equal(transactionEntries(storage, LOCAL_WORLD_CREATE_TRANSACTION_KEY).length, 0);
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
  assert.equal(transactionEntries(storage, LOCAL_WORLD_DELETE_TRANSACTION_KEY).length, 0);
}

// A valid but stale delete key recovered after its ID has been deliberately
// reused is bound to the old exact world record. It is garbage-collected without
// restoring or deleting a byte from the replacement generation.
{
  const storage = new MemoryStorage();
  const old = createLocalWorld(storage, {
    name: "Stale Delete Old",
    seedText: "stale-delete",
    gameMode: "survival",
    now: 145,
  });
  assert.ok(old.ok);
  const stale = pendingDeleteEntry(storage, old.world.id, 146);
  assert.ok(deleteLocalWorld(storage, old.world.id, 147).ok);
  const replacement = createLocalWorld(storage, {
    name: "Stale Delete Replacement",
    seedText: "stale-delete",
    gameMode: "creative",
    now: 145,
  });
  assert.ok(replacement.ok);
  assert.equal(replacement.world.id, old.world.id);
  const replacementKeys = singlePlayerWorldStorageKeys(replacement.world.id);
  const replacementValues = replacementKeys.map((key) => storage.values.get(key) ?? null);
  storage.values.set(stale[0], stale[1]);
  const recovered = loadLocalWorldRegistry(storage);
  assert.ok(recovered.issues.includes("delete:invalid_transaction_cleared"));
  assert.equal(recovered.registry?.worlds.find(({ id }) => id === replacement.world.id)?.initialGameMode, "creative");
  assert.deepEqual(replacementKeys.map((key) => storage.values.get(key) ?? null), replacementValues);
  assert.equal(storage.values.has(stale[0]), false);
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
  const otherTransaction = transactionEntry(other, LOCAL_WORLD_CREATE_TRANSACTION_KEY);
  assert.ok(otherTransaction);
  const [otherTransactionKey, otherRaw] = otherTransaction;
  const otherId = (JSON.parse(otherRaw) as { world: { id: string } }).world.id;
  const otherKeys = singlePlayerWorldStorageKeys(otherId);

  const storage = new MemoryStorage();
  storage.afterWritesFor.set(LOCAL_WORLD_REGISTRY_SLOT_A_KEY, () => {
    storage.values.set(otherTransactionKey, otherRaw);
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
  assert.equal(storage.values.get(otherTransactionKey), otherRaw,
    "A cannot blindly clear B's later marker");
  assert.ok(otherKeys.some((key) => storage.values.has(key)));
  const recovered = loadLocalWorldRegistry(storage);
  assert.ok(recovered.issues.includes("create:cleanup_completed"));
  assert.ok(recovered.registry?.worlds.some(({ id }) => id === first.world.id));
  assert.deepEqual(otherKeys.map((key) => storage.values.get(key) ?? null), [null, null, null, null]);
}

// Even quarantine and remove/readback ambiguity preserve a replacement marker.
// Both create and delete use this same identity-conditional clear primitive.
for (const prefix of [LOCAL_WORLD_CREATE_TRANSACTION_KEY, LOCAL_WORLD_DELETE_TRANSACTION_KEY]) {
  const storage = new MemoryStorage();
  const key = `${prefix}.corrupt`;
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
  assert.equal(transactionEntries(storage, LOCAL_WORLD_DELETE_TRANSACTION_KEY).length, 1);
  storage.values.set(initialWorldKeys[1], "interrupted-primary");
  storage.failWritesFor = null;
  storage.failDeletesFor = null;
  assert.ok(loadLocalWorldRegistry(storage).registry);
  assert.deepEqual(initialWorldKeys.map((key) => storage.values.get(key) ?? null), initialJournal,
    "a pre-commit transaction restores the complete original journal");
  assert.equal(transactionEntries(storage, LOCAL_WORLD_DELETE_TRANSACTION_KEY).length, 0);
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
  assert.equal(transactionEntries(storage, LOCAL_WORLD_DELETE_TRANSACTION_KEY).length, 1);
  assert.ok(transactionRaw(storage, LOCAL_WORLD_DELETE_TRANSACTION_KEY)?.includes('"checksum"'));
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
  assert.equal(transactionEntries(storage, LOCAL_WORLD_DELETE_TRANSACTION_KEY).length, 0);
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
  assert.equal(transactionEntries(storage, LOCAL_WORLD_DELETE_TRANSACTION_KEY).length, 1,
    "an ambiguous registry commit retains the complete cleanup transaction");
  assert.ok(deletedKeys.some((key) => storage.values.has(key)),
    "primary namespace cleanup cannot begin before the ambiguous commit is resolved");

  if (siblingCount === 1) {
    storage.failDeletesFor = deletedKeys[1];
    for (let retry = 0; retry < 2; retry += 1) {
      const pending = loadLocalWorldRegistry(storage);
      assert.ok(pending.registry && !pending.registry.worlds.some(({ id }) => id === deleted.world.id));
      assert.ok(pending.issues.includes("delete:recovery_pending"));
      assert.equal(transactionEntries(storage, LOCAL_WORLD_DELETE_TRANSACTION_KEY).length, 1);
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
  assert.equal(transactionEntries(storage, LOCAL_WORLD_DELETE_TRANSACTION_KEY).length, 0);
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
  assert.equal(transactionEntries(storage, LOCAL_WORLD_DELETE_TRANSACTION_KEY).length, 1);
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
  assert.equal(transactionEntries(storage, LOCAL_WORLD_DELETE_TRANSACTION_KEY).length, 1);
  const recovered = loadLocalWorldRegistry(storage);
  assert.ok(recovered.registry?.worlds.some(({ id }) => id === kept.world.id));
  assert.ok(recovered.registry?.worlds.some(({ id }) => id === sibling.world.id));
  assert.ok(recovered.issues.includes("delete:rollback_completed"));
  assert.deepEqual(keptKeys.map((key) => storage.values.get(key) ?? null), keptValues,
    "pre-commit recovery conserves every target-world save slot");
  assert.deepEqual(siblingKeys.map((key) => storage.values.get(key) ?? null), siblingValues,
    "interleaving or corruption cannot mutate a sibling namespace");
  assert.equal(transactionEntries(storage, LOCAL_WORLD_DELETE_TRANSACTION_KEY).length, 0);
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
  assert.equal(transactionEntries(storage, LOCAL_WORLD_DELETE_TRANSACTION_KEY).length, 1);
  const recovered = loadLocalWorldRegistry(storage);
  assert.ok(recovered.registry?.worlds.some(({ id }) => id === kept.world.id));
  assert.ok(recovered.issues.includes("delete:rollback_completed"));
  assert.deepEqual(keys.map((key) => storage.values.get(key) ?? null), values);
  assert.equal(transactionEntries(storage, LOCAL_WORLD_DELETE_TRANSACTION_KEY).length, 0);
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
  assert.equal(transactionEntries(storage, LOCAL_WORLD_DELETE_TRANSACTION_KEY).length, 0);
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
  const validTransaction = transactionEntry(storage, LOCAL_WORLD_DELETE_TRANSACTION_KEY);
  assert.ok(validTransaction);
  const [validKey, validRaw] = validTransaction;
  const tamperedRaw = validRaw.replace(`"worldId":"${first.world.id}"`, `"worldId":"${second.world.id}"`);
  assert.notEqual(tamperedRaw, validRaw);
  storage.values.set(validKey, tamperedRaw);
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

  storage.values.set(`${LOCAL_WORLD_DELETE_TRANSACTION_KEY}.unreadable`, "{");
  storage.failReadsFor = LOCAL_WORLD_DELETE_TRANSACTION_KEY;
  const unreadable = listLocalWorlds(storage);
  assert.deepEqual(unreadable.worlds.map(({ world }) => world.id).sort(), healthyIds);
  assert.ok(unreadable.registryLoad.issues.includes("transaction:enumeration_failed"));
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

  const throwingList = Object.defineProperties({
    getItem: () => null,
    setItem: () => undefined,
  }, {
    listKeys: { get: () => { throw new Error("enumeration getter denied"); } },
  }) as SinglePlayerStorageAdapter;
  const guardedEnumeration = loadLocalWorldRegistry(throwingList);
  assert.ok(guardedEnumeration.issues.includes("transaction:enumeration_failed"));
  assert.equal(guardedEnumeration.registry?.worlds.length, 0);

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
