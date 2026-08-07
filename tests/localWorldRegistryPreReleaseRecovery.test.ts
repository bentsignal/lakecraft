import assert from "node:assert/strict";
import {
  LOCAL_WORLD_REGISTRY_SLOT_A_KEY,
  LOCAL_WORLD_REGISTRY_SLOT_B_KEY,
  createLocalWorld,
  listLocalWorlds,
} from "../client/singleplayer/localWorldRegistry.ts";
import type { SinglePlayerStorageAdapter } from "../client/singleplayer/localSave.ts";

const registryKeys = [LOCAL_WORLD_REGISTRY_SLOT_A_KEY, LOCAL_WORLD_REGISTRY_SLOT_B_KEY] as const;
const unrelated = Object.freeze({
  "lakecraft.singleplayer.world.orphan.save.a": "orphan-world-save",
  "lakecraft.cloud.world-list": "cloud-state",
  "unrelated.preference": "keep-me",
});

class RecoveryStorage implements SinglePlayerStorageAdapter {
  readonly values = new Map<string, string>();
  readonly removed: string[] = [];
  failRead: string | null = null;
  failRemove: string | null = null;
  ignoreRemove = false;
  reads = 0;
  beforeRead: ((key: string, count: number) => void) | null = null;

  getItem(key: string): string | null {
    this.beforeRead?.(key, ++this.reads);
    if (key === this.failRead) throw new Error("read denied");
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    if (key === this.failRemove) throw new Error("delete denied");
    if (this.ignoreRemove) return;
    this.removed.push(key);
    this.values.delete(key);
  }
}

// A storage adapter that silently ignores removal cannot make corrupt data
// appear empty.
{
  const storage = new RecoveryStorage();
  for (const key of registryKeys) storage.values.set(key, "{");
  storage.ignoreRemove = true;
  assert.equal(listLocalWorlds(storage).registryLoad.registry, null);
  assert.deepEqual(storage.removed, []);
  for (const key of registryKeys) assert.equal(storage.values.get(key), "{");
}

// A valid current registry is returned untouched; sibling cleanup is not a
// prerequisite for using the verified world.
{
  const storage = new RecoveryStorage();
  const created = createLocalWorld(storage, {
    name: "Current With Corrupt Sibling",
    seedText: "current-corrupt",
    gameMode: "creative",
    now: 25_000,
  });
  assert.ok(created.ok);
  listLocalWorlds(storage);
  storage.removed.length = 0;
  const validKey = [...registryKeys].sort((left, right) =>
    JSON.parse(storage.values.get(right) ?? "null")[2]
      - JSON.parse(storage.values.get(left) ?? "null")[2])[0];
  assert.ok(validKey);
  const corruptKey = validKey === registryKeys[0] ? registryKeys[1] : registryKeys[0];
  storage.values.set(corruptKey, "{");
  const recovered = listLocalWorlds(storage);
  assert.equal(recovered.registryLoad.status, "recovered");
  assert.equal(recovered.worlds[0]?.world.id, created.world.id);
  assert.deepEqual(storage.removed, []);
  assert.equal(storage.values.get(corruptKey), "{");
}

function seedUnrelated(storage: RecoveryStorage): void {
  for (const [key, value] of Object.entries(unrelated)) storage.values.set(key, value);
}

function assertUnrelatedUntouched(storage: RecoveryStorage): void {
  for (const [key, value] of Object.entries(unrelated)) assert.equal(storage.values.get(key), value, key);
}

function assertEmptyRecovery(storage: RecoveryStorage): void {
  const first = listLocalWorlds(storage);
  assert.equal(first.registryLoad.status, "empty");
  assert.ok(first.registryLoad.registry);
  assert.deepEqual(first.registryLoad.issues, []);
  const second = listLocalWorlds(storage);
  assert.equal(second.registryLoad.status, "empty");
  assert.deepEqual(second.registryLoad.issues, []);
}

// Corrupt list data is cleared without enumerating or touching world/cloud data,
// and Create New World can commit immediately against the reinitialized list.
{
  const storage = new RecoveryStorage();
  seedUnrelated(storage);
  storage.values.set(LOCAL_WORLD_REGISTRY_SLOT_A_KEY, "{");
  storage.values.set(LOCAL_WORLD_REGISTRY_SLOT_B_KEY, "not-json");
  assertEmptyRecovery(storage);
  assert.deepEqual(storage.removed, registryKeys);
  assertUnrelatedUntouched(storage);
  const created = createLocalWorld(storage, {
    name: "Recovered World",
    seedText: "recovered",
    gameMode: "creative",
    now: 10_000,
  });
  assert.equal(created.ok, true, "world creation is available immediately after list recovery");
}

// Both older and newer unsupported pre-release list versions use the same
// intentionally destructive list-only recovery; no migration/import UI exists.
for (const version of [3, 5]) {
  const storage = new RecoveryStorage();
  seedUnrelated(storage);
  for (const key of registryKeys) storage.values.set(key, JSON.stringify([version]));
  assertEmptyRecovery(storage);
  assert.deepEqual(storage.removed, registryKeys, `unsupported v${version} clears only both registry slots`);
  assertUnrelatedUntouched(storage);
}

// Any valid current slot prevents destructive recovery, including when an
// unsupported sibling makes the production load fail closed.
{
  const storage = new RecoveryStorage();
  seedUnrelated(storage);
  const created = createLocalWorld(storage, {
    name: "Current World",
    seedText: "current",
    gameMode: "survival",
    now: 20_000,
  });
  assert.ok(created.ok);
  const clean = listLocalWorlds(storage);
  assert.equal(clean.worlds[0]?.world.id, created.world.id);
  assert.deepEqual(storage.removed, []);
  const parsed = registryKeys.map((key) => [key, JSON.parse(storage.values.get(key) ?? "null")] as const);
  const valid = parsed.filter((entry) => Array.isArray(entry[1]) && entry[1][0] === 4)
    .sort((left, right) => right[1][2] - left[1][2]);
  assert.ok(valid.length >= 1);
  const unsupportedKey = valid[0][0] === LOCAL_WORLD_REGISTRY_SLOT_A_KEY
    ? LOCAL_WORLD_REGISTRY_SLOT_B_KEY
    : LOCAL_WORLD_REGISTRY_SLOT_A_KEY;
  storage.values.set(unsupportedKey, JSON.stringify([5]));
  const blocked = listLocalWorlds(storage);
  assert.equal(blocked.registryLoad.status, "unsupported");
  assert.equal(blocked.registryLoad.registry, null);
  assert.deepEqual(blocked.worlds, []);
  assert.deepEqual(storage.removed, []);
  assert.equal(storage.values.get(unsupportedKey), JSON.stringify([5]));
  assertUnrelatedUntouched(storage);
}

// Read/delete uncertainty remains fail-closed. A second-slot delete failure
// may leave the first proven-invalid slot removed; cleanup retries safely.
{
  const unreadable = new RecoveryStorage();
  seedUnrelated(unreadable);
  for (const key of registryKeys) unreadable.values.set(key, "{");
  unreadable.failRead = LOCAL_WORLD_REGISTRY_SLOT_A_KEY;
  assert.equal(listLocalWorlds(unreadable).registryLoad.registry, null);
  assert.deepEqual(unreadable.removed, []);
  assertUnrelatedUntouched(unreadable);

  const undeletable = new RecoveryStorage();
  seedUnrelated(undeletable);
  for (const key of registryKeys) undeletable.values.set(key, "{");
  undeletable.failRemove = LOCAL_WORLD_REGISTRY_SLOT_B_KEY;
  assert.equal(listLocalWorlds(undeletable).registryLoad.registry, null);
  assert.equal(undeletable.values.has(LOCAL_WORLD_REGISTRY_SLOT_A_KEY), false);
  assert.equal(undeletable.values.get(LOCAL_WORLD_REGISTRY_SLOT_B_KEY), "{");
  assert.ok(undeletable.removed.every((key) => registryKeys.includes(key as typeof registryKeys[number])));
  assertUnrelatedUntouched(undeletable);
  undeletable.failRemove = null;
  assertEmptyRecovery(undeletable);
  assertUnrelatedUntouched(undeletable);
}

// A slot that changes between classification and deletion is never removed.
{
  const storage = new RecoveryStorage();
  for (const key of registryKeys) storage.values.set(key, "{");
  let replaced = false;
  storage.beforeRead = (key) => {
    if (!replaced && key === LOCAL_WORLD_REGISTRY_SLOT_B_KEY
      && !storage.values.has(LOCAL_WORLD_REGISTRY_SLOT_A_KEY)) {
      replaced = true;
      storage.values.set(key, "replacement");
    }
  };
  assert.equal(listLocalWorlds(storage).registryLoad.registry, null);
  assert.deepEqual(storage.removed, [LOCAL_WORLD_REGISTRY_SLOT_A_KEY]);
  assert.equal(storage.values.has(LOCAL_WORLD_REGISTRY_SLOT_A_KEY), false);
  assert.equal(storage.values.get(LOCAL_WORLD_REGISTRY_SLOT_B_KEY), "replacement");
}

console.log("pre-release local world registry recovery tests passed");
