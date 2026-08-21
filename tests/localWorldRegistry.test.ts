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
  LOCAL_WORLD_NAMESPACE_BUDGET_CHARS,
  LOCAL_WORLD_REGISTRY_MAX_CHARS,
  LOCAL_WORLD_REGISTRY_MAX_WORLDS,
  LOCAL_WORLD_REGISTRY_SLOT_A_KEY,
  LOCAL_WORLD_REGISTRY_SLOT_B_KEY,
  LOCAL_WORLD_TRANSACTION_LEASE_MS,
  createLocalWorld,
  deleteLocalWorld,
  deterministicLocalWorldSeed,
  inspectLocalWorld,
  isLocalWorldRegistryTransactionReadOnly,
  listLocalWorlds,
  loadLocalWorldRegistry,
  moveLocalWorldSelection,
  normalizeLocalWorldName,
  recordFirstLocalWorldPlay,
  reconcileLocalWorldSelection,
  resolveLocalWorldPlay,
  saveLocalWorldRegistry,
  touchLocalWorld,
  type LocalWorldRecord,
} from "../client/singleplayer/localWorldRegistry.ts";
import { BLOCK } from "../client/game/types.ts";

const LOCAL_WORLD_CREATE_TRANSACTION_KEY = "lakecraft.singleplayer.worlds.create";
const LOCAL_WORLD_DELETE_TRANSACTION_KEY = "lakecraft.singleplayer.worlds.delete";

class MemoryStorage implements SinglePlayerStorageAdapter {
  values = new Map<string, string>();
  failReadsFor: string | null = null;
  failWritesFor: string | null = null;
  failDeletesFor: string | null = null;
  failReadAfterWriteFor: string | null = null;
  throwAfterWritesFor: string | null = null;
  afterWritesFor = new Map<string, () => void>();
  afterReadsFor = new Map<string, () => void>();
  afterDeletesFor = new Map<string, () => void>();
  replaceWritesFor = new Map<string, (value: string) => string>();
  replaceDeletesFor = new Map<string, () => string>();
  listKeysCalls = 0;
  failListKeysFor = new Set<number>();
  afterListKeysFor = new Map<number, () => void>();
  replaceListKeysFor = new Map<number, () => string[]>();

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
    this.listKeysCalls += 1;
    if (this.failListKeysFor.delete(this.listKeysCalls)) throw new Error("enumeration failed");
    const replacement = this.replaceListKeysFor.get(this.listKeysCalls);
    if (replacement) this.replaceListKeysFor.delete(this.listKeysCalls);
    const keys = replacement ? replacement() : [...this.values.keys()];
    const hook = this.afterListKeysFor.get(this.listKeysCalls);
    if (hook) {
      this.afterListKeysFor.delete(this.listKeysCalls);
      hook();
    }
    return keys;
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
    const replacement = [...this.replaceDeletesFor.entries()]
      .find(([configured]) => this.matches(key, configured));
    if (replacement) {
      this.replaceDeletesFor.delete(replacement[0]);
      this.values.set(key, replacement[1]());
      return;
    }
    this.values.delete(key);
    const hook = [...this.afterDeletesFor.entries()].find(([configured]) => this.matches(key, configured));
    if (hook) {
      this.afterDeletesFor.delete(hook[0]);
      hook[1]();
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
      (total, [storedKey, stored]) => total + (storedKey === key ? 0 : storedKey.length + stored.length),
      key.length + value.length,
    );
    if (used > this.quotaChars) throw new Error("quota exceeded");
    super.setItem(key, value);
  }
}

type RegistryTuple = [
  4,
  string,
  number,
  number,
  LocalWorldRecord[],
  null | [0 | 1, number, number, ...unknown[]],
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
    return Array.isArray(value) && value[0] === 4 && typeof value[2] === "number"
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

function failFinalRegistryWrite(
  storage: MemoryStorage,
  fault: "read" | "replace" | "throw" | "write",
  writesBefore = 2,
): void {
  const arm = (remaining: number) => {
    if (remaining === 0) {
      const target = nextRegistryWriteKey(storage);
      if (fault === "read") storage.failReadAfterWriteFor = target;
      else if (fault === "replace") storage.replaceWritesFor.set(target, () => "{");
      else if (fault === "throw") storage.throwAfterWritesFor = target;
      else storage.failWritesFor = target;
      return;
    }
    storage.afterWritesFor.set(nextRegistryWriteKey(storage), () => arm(remaining - 1));
  };
  arm(writesBefore);
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
  const body = [4, sequence, savedAt, [...worlds].sort((a, b) => a.id.localeCompare(b.id)), pending];
  return canonicalSinglePlayerJson([4, singlePlayerSaveChecksum(body), ...body.slice(1)]);
}

function rewritePendingWorlds(storage: MemoryStorage, worlds: LocalWorldRecord[]): void {
  const [, value] = pendingRegistry(storage);
  const raw = encodeRegistry(value[2], value[3], worlds, value[5]);
  for (const key of registryKeys) storage.values.set(key, raw);
}

function namespaceValues(storage: MemoryStorage, worldId: string): Array<string | null> {
  return singlePlayerWorldStorageKeys(worldId).map((key) => storage.values.get(key) ?? null);
}

function sameWorldForTest(left: LocalWorldRecord, right: LocalWorldRecord): boolean {
  return canonicalSinglePlayerJson(left) === canonicalSinglePlayerJson(right);
}

type BrowserEnumerationFault =
  | { kind: "key-duplicate" | "key-null" | "key-non-string" | "key-throw"
    | "length-drift" | "length-throw"; scan: number }
  | { kind: "key-getter-throw" | "key-missing" };

function faultingBrowserStorage(
  values: Map<string, string>,
  fault: BrowserEnumerationFault,
): Storage {
  let lengthReads = 0;
  const storage = {
    get length(): number {
      lengthReads += 1;
      const scan = Math.ceil(lengthReads / 2);
      if (fault.kind === "length-throw" && (fault.scan === 0 || fault.scan === scan)) {
        throw new Error("length getter failed");
      }
      return fault.kind === "length-drift"
        && (fault.scan === 0 || fault.scan === scan) && lengthReads % 2 === 0
        ? values.size + 1
        : values.size;
    },
    getItem(key: string): string | null {
      return values.get(key) ?? null;
    },
    key(index: number): string | null {
      const scan = Math.ceil(lengthReads / 2);
      if (fault.kind === "key-throw" && (fault.scan === 0 || fault.scan === scan)) {
        throw new Error("key failed");
      }
      if (index === 0 && fault.kind === "key-null"
        && (fault.scan === 0 || fault.scan === scan)) return null;
      if (index === 0 && fault.kind === "key-non-string"
        && (fault.scan === 0 || fault.scan === scan)) {
        return 42 as unknown as string;
      }
      if (index === 1 && fault.kind === "key-duplicate"
        && (fault.scan === 0 || fault.scan === scan)) {
        return [...values.keys()][0] ?? null;
      }
      return [...values.keys()][index] ?? null;
    },
    removeItem(key: string): void {
      values.delete(key);
    },
    setItem(key: string, value: string): void {
      values.set(key, value);
    },
  };
  if (fault.kind === "key-getter-throw") {
    Object.defineProperty(storage, "key", {
      configurable: true,
      get() {
        throw new Error("key getter failed");
      },
    });
  } else if (fault.kind === "key-missing") {
    Object.defineProperty(storage, "key", {
      configurable: true,
      value: undefined,
    });
  }
  return storage as unknown as Storage;
}

function withBrowserStorage<T>(storage: Storage, operation: () => T): T {
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: storage },
  });
  try {
    return operation();
  } finally {
    if (original) Object.defineProperty(globalThis, "window", original);
    else delete (globalThis as { window?: unknown }).window;
  }
}

function makePendingCreate(
  source: MemoryStorage,
  input: Parameters<typeof createLocalWorld>[1],
): MemoryStorage {
  const donor = cloneStorage(source);
  const pendingKey = nextRegistryWriteKey(donor);
  donor.afterWritesFor.set(pendingKey, () => {
    donor.afterWritesFor.set(nextRegistryWriteKey(donor), () => {
      donor.failWritesFor = nextRegistryWriteKey(donor);
    });
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
{
  const storage = new MemoryStorage();
  const first = createLocalWorld(storage, {
    name: "Random One", seedText: "", gameMode: "survival", now: 1_750_000_000_001, randomSeed: 123_456,
  });
  const second = createLocalWorld(storage, {
    name: "Random Two", seedText: "   ", gameMode: "survival", now: 1_750_000_000_002, randomSeed: -654_321,
  });
  assert.equal(first.ok && first.world.seed, 123_456, "blank world seeds use the generated signed 32-bit value");
  assert.equal(second.ok && second.world.seed, -654_321, "each blank world can receive an independent random seed");
  const explicit = createLocalWorld(storage, {
    name: "Chosen", seedText: "Fern Hollow", gameMode: "survival", now: 1_750_000_000_003, randomSeed: 99,
  });
  assert.equal(explicit.ok && explicit.world.seed, deterministicLocalWorldSeed("Fern Hollow"),
    "an explicit seed remains deterministic and ignores blank-seed randomness");
}
assert.equal(reconcileLocalWorldSelection("b", ["a", "b"]), "b");
assert.equal(reconcileLocalWorldSelection("b", ["a"]), null);
assert.equal(moveLocalWorldSelection(null, ["a", "b"], "ArrowDown"), "a");
assert.equal(moveLocalWorldSelection(null, ["a", "b"], "ArrowUp"), "b");
assert.equal(moveLocalWorldSelection("a", ["a", "b"], "ArrowUp"), "a");
assert.equal(moveLocalWorldSelection("a", ["a", "b"], "End"), "b");

// Healthy create/touch/delete uses only the crash-safe A/B registry and
// four world keys; pending is protected in both slots before namespace mutation.
{
  const storage = new MemoryStorage();
  const created = createLocalWorld(storage, {
    name: "Fern Hollow",
    seedText: "fern",
    gameMode: "survival",
    now: 100,
  });
  assert.ok(created.ok);
  assert.equal(loadLocalWorldRegistry(storage).sequence, 3);
  assert.equal(highestRegistry(storage)?.[1][5], null);
  assertNoExternalMarkers(storage);
  const touched = touchLocalWorld(storage, created.world.id, 200, created.world);
  assert.ok(touched.ok);
  assert.equal(touched.world.lastPlayedAt, 200);
  assert.ok(deleteLocalWorld(storage, created.world.id, 400).ok);
  assert.equal(loadLocalWorldRegistry(storage).registry?.worlds.length, 0);
  assert.deepEqual(namespaceValues(storage, created.world.id), [null, null, null]);
  assertNoExternalMarkers(storage);
}

// Immediate create enters without touching last-played metadata. The first
// verified in-world save finalizes it once, and exact retries are read-only.
{
  const storage = new MemoryStorage();
  const created = createLocalWorld(storage, {
    name: "First Session",
    seedText: "first-session",
    gameMode: "creative",
    now: 100,
  });
  assert.ok(created.ok);
  assert.equal(created.world.lastPlayedAt, 0);
  const before = loadLocalWorldRegistry(storage);
  assert.equal(before.sequence, 3);

  const loaded = loadSinglePlayerSave(storage, { worldId: created.world.id });
  assert.ok(loaded.snapshot);
  assert.ok(saveSinglePlayerSnapshot(storage, loaded.snapshot, 200, { worldId: created.world.id }).ok);
  const recorded = recordFirstLocalWorldPlay(storage, created.world, 200);
  assert.ok(recorded.ok);
  assert.equal(recorded.world.lastPlayedAt, 200);
  assert.equal(loadLocalWorldRegistry(storage).sequence, 4);

  const replay = recordFirstLocalWorldPlay(storage, created.world, 300);
  assert.ok(replay.ok);
  assert.equal(replay.world.lastPlayedAt, 200);
  assert.equal(loadLocalWorldRegistry(storage).sequence, 4);
}

// A definite registry failure after the snapshot commit keeps first-play
// pending. Retry commits it, while a lost acknowledgement reconciles as success.
{
  const storage = new MemoryStorage();
  const created = createLocalWorld(storage, {
    name: "First Session Retry",
    seedText: "first-session-retry",
    gameMode: "survival",
    now: 400,
  });
  assert.ok(created.ok);
  const snapshot = loadSinglePlayerSave(storage, { worldId: created.world.id }).snapshot;
  assert.ok(snapshot);
  snapshot.world.activePlayMs = 123;
  assert.ok(saveSinglePlayerSnapshot(storage, snapshot, 500, { worldId: created.world.id }).ok);
  storage.failWritesFor = nextRegistryWriteKey(storage);
  const failed = recordFirstLocalWorldPlay(storage, created.world, 500);
  assert.deepEqual(failed, {
    ok: false,
    reason: "registry_storage_write_failed",
    mutationStarted: true,
  });
  assert.equal(loadLocalWorldRegistry(storage).registry?.worlds[0]?.lastPlayedAt, 0);
  const durableSnapshot = loadSinglePlayerSave(storage, { worldId: created.world.id });
  assert.equal(durableSnapshot.savedAt, 500,
    "secondary metadata failure does not redefine the authoritative snapshot commit");
  assert.equal(durableSnapshot.snapshot?.world.activePlayMs, 123);

  const entryRepair = cloneStorage(storage);
  const entered = touchLocalWorld(entryRepair, created.world.id, 600, created.world);
  assert.ok(entered.ok, "the next ordinary entry repairs metadata left pending by Save and Quit");
  assert.equal(entered.world.lastPlayedAt, 600);

  storage.failWritesFor = null;
  assert.ok(recordFirstLocalWorldPlay(storage, created.world, 500).ok);
  assert.equal(loadLocalWorldRegistry(storage).registry?.worlds[0]?.lastPlayedAt, 500);

  const ambiguous = new MemoryStorage();
  const ambiguousWorld = createLocalWorld(ambiguous, {
    name: "First Session Lost Ack",
    seedText: "first-session-lost-ack",
    gameMode: "creative",
    now: 600,
  });
  assert.ok(ambiguousWorld.ok);
  ambiguous.throwAfterWritesFor = nextRegistryWriteKey(ambiguous);
  const reconciled = recordFirstLocalWorldPlay(ambiguous, ambiguousWorld.world, 700);
  assert.ok(reconciled.ok);
  assert.equal(reconciled.world.lastPlayedAt, 700);
  assert.equal(loadLocalWorldRegistry(ambiguous).sequence, 4);
}

// Same-world and unrelated concurrent writers cannot double-finalize or erase
// first-play metadata. The outer stale acknowledgement reconciles by identity.
{
  const same = new MemoryStorage();
  const created = createLocalWorld(same, {
    name: "Concurrent First Session",
    seedText: "concurrent-first-session",
    gameMode: "creative",
    now: 800,
  });
  assert.ok(created.ok);
  const nested: unknown[] = [];
  same.afterWritesFor.set(nextRegistryWriteKey(same), () => {
    nested.push(recordFirstLocalWorldPlay(same, created.world, 900));
  });
  assert.ok(recordFirstLocalWorldPlay(same, created.world, 900).ok);
  assert.equal((nested[0] as { ok: boolean }).ok, true);
  assert.equal(loadLocalWorldRegistry(same).sequence, 4);

  const unrelated = new MemoryStorage();
  const first = createLocalWorld(unrelated, {
    name: "Concurrent Target",
    seedText: "concurrent-target",
    gameMode: "creative",
    now: 1_000,
  });
  const sibling = createLocalWorld(unrelated, {
    name: "Concurrent Sibling",
    seedText: "concurrent-sibling",
    gameMode: "survival",
    now: 1_001,
  });
  assert.ok(first.ok && sibling.ok);
  unrelated.afterWritesFor.set(nextRegistryWriteKey(unrelated), () => {
    assert.ok(touchLocalWorld(unrelated, sibling.world.id, 1_100, sibling.world).ok);
  });
  const outer = recordFirstLocalWorldPlay(unrelated, first.world, 1_100);
  assert.ok(outer.ok);
  const final = loadLocalWorldRegistry(unrelated);
  assert.equal(final.registry?.worlds.find(({ id }) => id === first.world.id)?.lastPlayedAt, 1_100);
  assert.equal(final.registry?.worlds.find(({ id }) => id === sibling.world.id)?.lastPlayedAt, 1_100);
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

// Re-entrant writers at the second-slot mirror observe the exact pair and stay
// read-only; the outer owner remains the only namespace mutator.
{
  const createStorage = new MemoryStorage();
  const kept = createLocalWorld(createStorage, {
    name: "Mirror Nested Kept",
    seedText: "mirror-nested-kept",
    gameMode: "survival",
    now: 650,
  });
  assert.ok(kept.ok);
  const nestedCreate: unknown[] = [];
  createStorage.afterWritesFor.set(nextRegistryWriteKey(createStorage), () => {
    createStorage.afterWritesFor.set(nextRegistryWriteKey(createStorage), () => {
      nestedCreate.push(createLocalWorld(createStorage, {
        name: "Mirror Nested Loser",
        seedText: "mirror-nested-loser",
        gameMode: "creative",
        now: 651,
      }));
      nestedCreate.push(deleteLocalWorld(createStorage, kept.world.id, 651));
    });
  });
  assert.ok(createLocalWorld(createStorage, {
    name: "Mirror Nested Winner",
    seedText: "mirror-nested-winner",
    gameMode: "survival",
    now: 651,
  }).ok);
  assert.deepEqual(nestedCreate, [
    { ok: false, reason: "world_create_recovery_pending", mutationStarted: false },
    { ok: false, reason: "world_delete_recovery_pending", mutationStarted: false },
  ]);

  const deleteStorage = cloneStorage(createStorage);
  const keptBytes = namespaceValues(deleteStorage, kept.world.id);
  const nestedDelete: unknown[] = [];
  deleteStorage.afterWritesFor.set(nextRegistryWriteKey(deleteStorage), () => {
    deleteStorage.afterWritesFor.set(nextRegistryWriteKey(deleteStorage), () => {
      nestedDelete.push(createLocalWorld(deleteStorage, {
        name: "Delete Mirror Loser",
        seedText: "delete-mirror-loser",
        gameMode: "creative",
        now: 652,
      }));
    });
  });
  assert.ok(deleteLocalWorld(
    deleteStorage,
    kept.world.id,
    652,
  ).ok);
  assert.deepEqual(nestedDelete, [
    { ok: false, reason: "world_create_recovery_pending", mutationStarted: false },
  ]);
  assert.equal(keptBytes.some((value) => value !== null), true);
  assert.deepEqual(namespaceValues(deleteStorage, kept.world.id), [null, null, null]);
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
  const intended = pending[3] as LocalWorldRecord;
  assert.ok(namespaceValues(namespaceCrash, intended.id).some((value) => value !== null));
  assert.ok(loadLocalWorldRegistry(
    namespaceCrash,
    input.now + LOCAL_WORLD_TRANSACTION_LEASE_MS,
  ).issues.includes("create:cleanup_completed"));
  assert.deepEqual(namespaceValues(namespaceCrash, intended.id), [null, null, null]);

  const finalLost = new MemoryStorage();
  failFinalRegistryWrite(finalLost, "throw", 4);
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
  assert.deepEqual(namespaceValues(ambiguous, created.world.id), [null, null, null]);

  const cleanup = makePendingDelete(source, created.world.id, 803);
  cleanup.failDeletesFor = null;
  assert.ok(loadLocalWorldRegistry(cleanup, 803).issues.includes("transaction:active"));
  assert.ok(loadLocalWorldRegistry(
    cleanup,
    803 + LOCAL_WORLD_TRANSACTION_LEASE_MS,
  ).issues.includes("delete:cleanup_completed"));
  assert.deepEqual(namespaceValues(cleanup, created.world.id), [null, null, null]);

  const clear = cloneStorage(source);
  failFinalRegistryWrite(clear, "write");
  assert.deepEqual(deleteLocalWorld(clear, created.world.id, 804), {
    ok: false,
    reason: "world_delete_cleanup_pending",
    mutationStarted: true,
  });
  assert.deepEqual(namespaceValues(clear, created.world.id), [null, null, null]);
  clear.failWritesFor = null;
  assert.ok(loadLocalWorldRegistry(
    clear,
    804 + LOCAL_WORLD_TRANSACTION_LEASE_MS,
  ).issues.includes("delete:cleanup_completed"));

}

// A delete tombstone is the exact same compact raw in both registry slots
// before namespace removal. If the final clear fails, corrupting either copy
// still elects the other tombstone and can never revive an empty/default world.
{
  for (const shifted of [false, true]) {
    const source = new MemoryStorage();
    const created = createLocalWorld(source, {
      name: `Delete Tombstone ${shifted}`,
      seedText: `delete-tombstone-${shifted}`,
      gameMode: "survival",
      now: 820 + Number(shifted),
    });
    assert.ok(created.ok);
    if (shifted) assert.ok(touchLocalWorld(source, created.world.id, 830).ok);
    source.values.set(singlePlayerWorldStorageKeys(created.world.id)[1], "{");
    failFinalRegistryWrite(source, "write");
    assert.deepEqual(deleteLocalWorld(source, created.world.id, 840), {
      ok: false,
      reason: "world_delete_cleanup_pending",
      mutationStarted: true,
    });
    source.failWritesFor = null;
    assert.deepEqual(namespaceValues(source, created.world.id), [null, null, null]);
    const protectedSlots = registryKeys.map((key) => [key, parsedRegistry(source, key)] as const);
    assert.ok(protectedSlots.every(([, slot]) =>
      slot?.[5]?.[0] === 1 && slot[5].length === 5
      && !slot[4].some(({ id }) => id === created.world.id)));
    assert.equal(protectedSlots[0][1]?.[2], protectedSlots[1][1]?.[2]);
    assert.equal(source.values.get(registryKeys[0]), source.values.get(registryKeys[1]));

    for (const [corruptKey] of protectedSlots) {
      const corrupted = cloneStorage(source);
      corrupted.values.set(corruptKey, "{");
      const recovered = loadLocalWorldRegistry(
        corrupted,
        840 + LOCAL_WORLD_TRANSACTION_LEASE_MS,
      );
      assert.ok(recovered.issues.includes("delete:cleanup_completed"));
      assert.equal(recovered.registry?.worlds.some(({ id }) => id === created.world.id), false);
      assert.deepEqual(namespaceValues(corrupted, created.world.id), [null, null, null]);
      assert.equal(listLocalWorlds(corrupted).worlds.some(({ world }) =>
        world.id === created.world.id), false);
    }
  }
}

// Create has the inverse invariant. Both slots first encode abort, then after
// the verified namespace write both encode the exact post-create registry.
// A failed final clear or later corruption therefore commits, never deletes, a
// create that reached the post-state or returned success.
{
  for (const shifted of [false, true]) {
    const makeSource = () => {
      const storage = new MemoryStorage();
      if (shifted) assert.ok(saveLocalWorldRegistry(storage, { worlds: [] }, 850).ok);
      return storage;
    };
    const input = {
      name: `Create Mirror ${shifted}`,
      seedText: `create-mirror-${shifted}`,
      gameMode: "creative" as const,
      now: 851,
    };
    const failed = makeSource();
    failFinalRegistryWrite(failed, "write", 4);
    const result = createLocalWorld(failed, input);
    assert.equal(result.ok, false);
    failed.failWritesFor = null;
    const intended = pendingRegistry(failed)[1][5]![3] as LocalWorldRecord;
    const protectedSlots = registryKeys.map((key) => [key, parsedRegistry(failed, key)] as const);
    assert.ok(protectedSlots.every(([, slot]) =>
      slot?.[5]?.[0] === 0 && slot[4].some((world) => sameWorldForTest(world, intended))));
    assert.equal(failed.values.get(registryKeys[0]), failed.values.get(registryKeys[1]));
    assert.equal(
      loadSinglePlayerSave(failed, { worldId: intended.id }).snapshot?.world.gameMode,
      "creative",
    );
    for (const [corruptKey] of protectedSlots) {
      const corrupted = cloneStorage(failed);
      corrupted.values.set(corruptKey, "{");
      const recovered = loadLocalWorldRegistry(
        corrupted,
        input.now + LOCAL_WORLD_TRANSACTION_LEASE_MS,
      );
      assert.ok(recovered.issues.includes("create:commit_completed"));
      assert.ok(recovered.registry?.worlds.some((world) => sameWorldForTest(world, intended)));
      assert.equal(
        loadSinglePlayerSave(corrupted, { worldId: intended.id }).snapshot?.world.gameMode,
        "creative",
      );
    }

    const successful = makeSource();
    const created = createLocalWorld(successful, input);
    assert.ok(created.ok);
    for (const corruptKey of registryKeys) {
      const corrupted = cloneStorage(successful);
      corrupted.values.set(corruptKey, "{");
      const recovered = loadLocalWorldRegistry(
        corrupted,
        input.now + LOCAL_WORLD_TRANSACTION_LEASE_MS,
      );
      assert.ok(recovered.registry?.worlds.some((world) =>
        sameWorldForTest(world, created.world)));
      assert.equal(
        loadSinglePlayerSave(corrupted, { worldId: created.world.id }).snapshot?.world.gameMode,
        "creative",
      );
    }
  }
}

// Publication and recovery cannot cross the namespace boundary unless the
// second slot accepts the exact pending raw. Write denial, corrupt replacement,
// readback loss, and durable lost acknowledgement all leave create empty and
// delete byte-identical.
{
  const mirrorFaults = ["read", "replace", "throw", "write"] as const;
  const armMirrorFault = (storage: MemoryStorage, fault: typeof mirrorFaults[number]) => {
    storage.afterWritesFor.set(nextRegistryWriteKey(storage), () => {
      const target = nextRegistryWriteKey(storage);
      if (fault === "read") storage.failReadAfterWriteFor = target;
      else if (fault === "replace") storage.replaceWritesFor.set(target, () => "{");
      else if (fault === "throw") storage.throwAfterWritesFor = target;
      else storage.failWritesFor = target;
    });
  };
  for (const fault of mirrorFaults) {
    const create = new MemoryStorage();
    armMirrorFault(create, fault);
    const created = createLocalWorld(create, {
      name: `Create Mirror Fault ${fault}`,
      seedText: `create-mirror-fault-${fault}`,
      gameMode: "survival",
      now: 860,
    });
    assert.equal(created.ok, false);
    const createPending = pendingRegistry(create)[1][5]!;
    assert.deepEqual(
      namespaceValues(create, (createPending[3] as LocalWorldRecord).id),
      [null, null, null],
    );

    const deleteStorage = new MemoryStorage();
    const world = createLocalWorld(deleteStorage, {
      name: `Delete Mirror Fault ${fault}`,
      seedText: `delete-mirror-fault-${fault}`,
      gameMode: "survival",
      now: 861,
    });
    assert.ok(world.ok);
    const before = namespaceValues(deleteStorage, world.world.id);
    armMirrorFault(deleteStorage, fault);
    assert.equal(deleteLocalWorld(deleteStorage, world.world.id, 862).ok, false);
    assert.deepEqual(namespaceValues(deleteStorage, world.world.id), before);
  }

  const base = new MemoryStorage();
  const world = createLocalWorld(base, {
    name: "Recovery Mirror Fault",
    seedText: "recovery-mirror-fault",
    gameMode: "survival",
    now: 863,
  });
  assert.ok(world.ok);
  const before = namespaceValues(base, world.world.id);
  armMirrorFault(base, "write");
  assert.equal(deleteLocalWorld(base, world.world.id, 864).ok, false);
  base.failWritesFor = null;
  for (const fault of mirrorFaults) {
    const recovery = cloneStorage(base);
    const target = nextRegistryWriteKey(recovery);
    if (fault === "read") recovery.failReadAfterWriteFor = target;
    else if (fault === "replace") recovery.replaceWritesFor.set(target, () => "{");
    else if (fault === "throw") recovery.throwAfterWritesFor = target;
    else recovery.failWritesFor = target;
    const blocked = loadLocalWorldRegistry(
      recovery,
      864 + LOCAL_WORLD_TRANSACTION_LEASE_MS,
    );
    assert.ok(blocked.issues.includes("transaction:recovery_pending"));
    assert.deepEqual(namespaceValues(recovery, world.world.id), before);
    recovery.failWritesFor = null;
    recovery.failReadsFor = null;
    recovery.replaceWritesFor.clear();
    recovery.throwAfterWritesFor = null;
    const recovered = loadLocalWorldRegistry(
      recovery,
      864 + LOCAL_WORLD_TRANSACTION_LEASE_MS,
    );
    assert.ok(recovered.issues.includes("delete:cleanup_completed"));
    assert.deepEqual(namespaceValues(recovery, world.world.id), [null, null, null]);
  }
}

// Once both slots carry the semantic result, every ambiguous final-clear mode
// remains recoverable. A corrupt replacement uses the pending sibling; lost
// readback and lost acknowledgement use the durable clear.
{
  for (const fault of ["read", "replace", "throw"] as const) {
    const create = new MemoryStorage();
    failFinalRegistryWrite(create, fault, 4);
    const input = {
      name: `Create Final ${fault}`,
      seedText: `create-final-${fault}`,
      gameMode: "creative" as const,
      now: 870,
    };
    assert.equal(createLocalWorld(create, input).ok, false);
    create.failReadsFor = null;
    const createWorld = registryKeys.flatMap((key) => {
      const slot = parsedRegistry(create, key);
      return slot?.[4] ?? [];
    })[0] ?? (pendingRegistry(create)[1][5]![3] as LocalWorldRecord);
    const recoveredCreate = loadLocalWorldRegistry(
      create,
      input.now + LOCAL_WORLD_TRANSACTION_LEASE_MS,
    );
    assert.ok(recoveredCreate.registry?.worlds.some(({ id }) => id === createWorld.id));
    assert.equal(
      loadSinglePlayerSave(create, { worldId: createWorld.id }).snapshot?.world.gameMode,
      "creative",
    );

    const deletion = new MemoryStorage();
    const deleted = createLocalWorld(deletion, {
      name: `Delete Final ${fault}`,
      seedText: `delete-final-${fault}`,
      gameMode: "survival",
      now: 871,
    });
    assert.ok(deleted.ok);
    failFinalRegistryWrite(deletion, fault);
    assert.equal(deleteLocalWorld(deletion, deleted.world.id, 872).ok, false);
    deletion.failReadsFor = null;
    const recoveredDelete = loadLocalWorldRegistry(
      deletion,
      872 + LOCAL_WORLD_TRANSACTION_LEASE_MS,
    );
    assert.equal(recoveredDelete.registry?.worlds.some(({ id }) =>
      id === deleted.world.id), false);
    assert.deepEqual(namespaceValues(deletion, deleted.world.id), [null, null, null]);
  }
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

// Reusing a deterministic ID overwrites both old delete witnesses before the
// new namespace is written. Corrupting either slot can only expose the new
// creative incarnation (or its post-create pending state), never the deleted
// survival record or a fresh/default save.
{
  const storage = new MemoryStorage();
  const old = createLocalWorld(storage, {
    name: "Reuse Old",
    seedText: "reuse-same-id",
    gameMode: "survival",
    now: 930,
  });
  assert.ok(old.ok);
  assert.ok(deleteLocalWorld(storage, old.world.id, 931).ok);
  const replacement = createLocalWorld(storage, {
    name: "Reuse Replacement",
    seedText: "reuse-same-id",
    gameMode: "creative",
    now: 930,
  });
  assert.ok(replacement.ok);
  assert.equal(replacement.world.id, old.world.id);
  for (const key of registryKeys) {
    const slot = parsedRegistry(storage, key);
    assert.ok(slot?.[4].some((world) => sameWorldForTest(world, replacement.world)));
    assert.notEqual(slot?.[5]?.[0], 1);
  }
  for (const corruptKey of registryKeys) {
    const corrupted = cloneStorage(storage);
    corrupted.values.set(corruptKey, "{");
    const recovered = loadLocalWorldRegistry(
      corrupted,
      930 + LOCAL_WORLD_TRANSACTION_LEASE_MS,
    );
    assert.ok(recovered.registry?.worlds.some((world) =>
      sameWorldForTest(world, replacement.world)));
    assert.equal(
      loadSinglePlayerSave(corrupted, { worldId: replacement.world.id }).snapshot?.world.gameMode,
      "creative",
    );
  }
}

// If ownership changes during a key removal, post-call revalidation stops the
// stale transaction. A same-ID replacement installed by the interleaving
// writer keeps every one of its exact namespace bytes.
{
  const oldStorage = new MemoryStorage();
  const old = createLocalWorld(oldStorage, {
    name: "Removal Old",
    seedText: "removal-replacement",
    gameMode: "survival",
    now: 940,
  });
  const replacementStorage = new MemoryStorage();
  const replacement = createLocalWorld(replacementStorage, {
    name: "Removal Replacement",
    seedText: "removal-replacement",
    gameMode: "creative",
    now: 940,
  });
  assert.ok(old.ok && replacement.ok);
  assert.equal(old.world.id, replacement.world.id);
  const replacementBytes = namespaceValues(replacementStorage, replacement.world.id);
  oldStorage.afterDeletesFor.set(singlePlayerWorldStorageKeys(old.world.id)[0], () => {
    singlePlayerWorldStorageKeys(old.world.id).forEach((key, index) => {
      const value = replacementBytes[index];
      if (value === null) oldStorage.values.delete(key);
      else oldStorage.values.set(key, value);
    });
    const sequence = pendingRegistry(oldStorage)[1][2] + 1;
    const raw = encodeRegistry(sequence, 941, [replacement.world], null);
    for (const key of registryKeys) oldStorage.values.set(key, raw);
  });
  assert.deepEqual(deleteLocalWorld(oldStorage, old.world.id, 941), {
    ok: false,
    reason: "world_delete_cleanup_pending",
    mutationStarted: true,
  });
  assert.deepEqual(namespaceValues(oldStorage, old.world.id), replacementBytes);
  assert.ok(loadLocalWorldRegistry(oldStorage).registry?.worlds.some((world) =>
    sameWorldForTest(world, replacement.world)));

  const staleCreate = makePendingCreate(new MemoryStorage(), {
    name: "Removal Pending",
    seedText: "removal-pending",
    gameMode: "survival",
    now: 942,
  });
  const staleWorld = pendingRegistry(staleCreate)[1][5]![3] as LocalWorldRecord;
  const createReplacementStorage = new MemoryStorage();
  const createReplacement = createLocalWorld(createReplacementStorage, {
    name: "Removal Create Replacement",
    seedText: "removal-pending",
    gameMode: "creative",
    now: 942,
  });
  assert.ok(createReplacement.ok);
  assert.equal(createReplacement.world.id, staleWorld.id);
  const createReplacementBytes = namespaceValues(
    createReplacementStorage,
    createReplacement.world.id,
  );
  staleCreate.afterDeletesFor.set(singlePlayerWorldStorageKeys(staleWorld.id)[0], () => {
    singlePlayerWorldStorageKeys(staleWorld.id).forEach((key, index) => {
      const value = createReplacementBytes[index];
      if (value === null) staleCreate.values.delete(key);
      else staleCreate.values.set(key, value);
    });
    const sequence = pendingRegistry(staleCreate)[1][2] + 1;
    const raw = encodeRegistry(sequence, 943, [createReplacement.world], null);
    for (const key of registryKeys) staleCreate.values.set(key, raw);
  });
  const blocked = loadLocalWorldRegistry(
    staleCreate,
    942 + LOCAL_WORLD_TRANSACTION_LEASE_MS,
  );
  assert.ok(blocked.issues.includes("create:recovery_pending"));
  assert.deepEqual(namespaceValues(staleCreate, staleWorld.id), createReplacementBytes);
  assert.ok(loadLocalWorldRegistry(staleCreate).registry?.worlds.some((world) =>
    sameWorldForTest(world, createReplacement.world)));
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
    y: 2,
    z: index,
    block: BLOCK.STONE,
  }));
  assert.equal(saveSinglePlayerSnapshot(quota, snapshot, 1_211, { worldId: world.world.id }).ok, false);
  assert.deepEqual(quota.values, before);

  const compact = new MemoryStorage();
  const compactWorld = createLocalWorld(compact, {
    name: "Compact Tombstone",
    seedText: "compact-tombstone",
    gameMode: "survival",
    now: 1_220,
  });
  assert.ok(compactWorld.ok);
  const large = createDefaultSinglePlayerSnapshot(
    compactWorld.world.seed,
    1_220,
    compactWorld.world.id,
  );
  large.world.edits = Array.from({ length: 2_000 }, (_, index) => ({
    x: index,
    y: 2,
    z: index,
    block: BLOCK.STONE,
  }));
  assert.ok(saveSinglePlayerSnapshot(compact, large, 1_221, {
    worldId: compactWorld.world.id,
  }).ok);
  assert.ok(Math.max(...singlePlayerWorldStorageKeys(compactWorld.world.id).map((key) =>
    compact.values.get(key)?.length ?? 0)) > LOCAL_WORLD_REGISTRY_MAX_CHARS);
  let sawCompactPair = false;
  compact.replaceDeletesFor.set(singlePlayerWorldStorageKeys(compactWorld.world.id)[0], () => {
    const slots = registryKeys.map((key) => parsedRegistry(compact, key));
    sawCompactPair = slots.every((slot, index) =>
      slot?.[5]?.[0] === 1 && slot[5].length === 5
      && (compact.values.get(registryKeys[index])?.length ?? Infinity)
        <= LOCAL_WORLD_REGISTRY_MAX_CHARS);
    return "blocked";
  });
  assert.deepEqual(deleteLocalWorld(compact, compactWorld.world.id, 1_222), {
    ok: false,
    reason: "world_delete_cleanup_pending",
    mutationStarted: true,
  });
  assert.equal(sawCompactPair, true, JSON.stringify(
    registryKeys.map((key) => parsedRegistry(compact, key)),
  ));
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

// Standalone journal bytes remain inert, and browser getter failures are reported without writes.
{
  const storage = new MemoryStorage();
  const standalone = createDefaultSinglePlayerSnapshot(55, 1_600);
  assert.ok(saveSinglePlayerSnapshot(storage, standalone, 1_600).ok);
  assert.equal(loadLocalWorldRegistry(storage).registry?.worlds.length, 0);
  assert.equal(loadSinglePlayerSave(storage).snapshot?.world.seed, 55);

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
    const expectedIds = current.registry.worlds.map(({ id }) => id);
    for (const corruptKey of registryKeys) {
      const corrupted = cloneStorage(storage);
      corrupted.values.set(corruptKey, "{");
      const recovered = loadLocalWorldRegistry(
        corrupted,
        20_000 + index + LOCAL_WORLD_TRANSACTION_LEASE_MS,
      );
      assert.deepEqual(recovered.registry?.worlds.map(({ id }) => id), expectedIds);
      for (const world of recovered.registry?.worlds ?? []) {
        assert.equal(
          loadSinglePlayerSave(corrupted, { worldId: world.id }).snapshot?.world.worldId,
          world.id,
        );
      }
    }
  }
}

assert.equal(isLocalWorldRegistryTransactionReadOnly({
  status: "recovered",
  registry: { worlds: [] },
  sequence: 1,
  issues: ["transaction:active"],
}), true);
assert.equal(listLocalWorlds(new MemoryStorage()).worlds.length, 0);

console.log("local world registry integrated pending, recovery, isolation, and capacity tests passed");
