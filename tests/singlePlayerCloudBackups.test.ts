import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createDefaultSinglePlayerSnapshot,
  loadSinglePlayerSave,
  parseSinglePlayerSaveEnvelope,
  SINGLEPLAYER_SAVE_SLOT_A_KEY,
  serializeSinglePlayerSave,
  singlePlayerWorldStorageKey,
  type SinglePlayerStorageAdapter,
} from "../client/singleplayer/localSave.ts";
import {
  LOCAL_WORLD_REGISTRY_MAX_WORLDS,
  createLocalWorld,
  listLocalWorlds,
  restoreMissingLocalWorld,
} from "../client/singleplayer/localWorldRegistry.ts";
import {
  SINGLE_PLAYER_CLOUD_BACKUP_CHUNK_BYTES,
  SINGLE_PLAYER_CLOUD_BACKUP_GLOBAL_DAILY_WRITES,
  SINGLE_PLAYER_CLOUD_BACKUP_BUDGET_STATE_BYTES,
  SINGLE_PLAYER_CLOUD_BACKUP_MANIFEST_STATE_BYTES,
  SINGLE_PLAYER_CLOUD_BACKUP_MAX_GLOBAL_STATE_BYTES,
  SINGLE_PLAYER_CLOUD_BACKUP_MAX_USER_STATE_BYTES,
  SINGLE_PLAYER_CLOUD_BACKUP_MAX_WORLDS,
  SINGLE_PLAYER_CLOUD_BACKUP_MIN_USER_UPLOAD_MS,
  SINGLE_PLAYER_CLOUD_BACKUP_QUOTA_STATE_BYTES,
  SINGLE_PLAYER_CLOUD_BACKUP_USER_DAILY_WRITES,
  candidateMatchesManifest,
  canonicalCloudBackupJson,
  cloudBackupHash,
  cloudBackupStoredChunkBytes,
  cloudBackupUtf8Bytes,
  decideSinglePlayerCloudBackupCommit,
  parseSinglePlayerCloudBackupCommitRequest,
  parseSinglePlayerCloudBackupDeleteRequest,
  splitSinglePlayerCloudBackupSnapshot,
  singlePlayerCloudBudgetCleanupAfter,
  utcCloudBackupDay,
  validUtcCloudBackupDay,
  validStoredSinglePlayerCloudBackupManifest,
  validSinglePlayerCloudQuotaState,
  type SinglePlayerCloudBackupCandidate,
  type StoredSinglePlayerCloudBackupManifest,
} from "../shared/singlePlayerCloudBackups.ts";
import { isRestorableSinglePlayerSnapshot } from "../shared/singlePlayerSnapshotGate.ts";
import { validateSinglePlayerSnapshot } from "../client/singleplayer/localSave.ts";
import { createEmptyFurnace } from "../shared/furnaces.ts";
import { compareSinglePlayerCanonicalText } from "../shared/singlePlayerCanonicalOrder.ts";

class MemoryStorage implements SinglePlayerStorageAdapter {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  listKeys(): string[] {
    return [...this.values.keys()];
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

const createdAt = 1_000;
const savedAt = 2_000;
const worldId = "cloud-world-alpha";
const snapshot = createDefaultSinglePlayerSnapshot(42, createdAt, worldId);
const serialized = serializeSinglePlayerSave(snapshot, 7, savedAt);
assert.equal(serialized.ok, true);
if (!serialized.ok) throw new Error("fixture failed to serialize");

const parsed = parseSinglePlayerCloudBackupCommitRequest(JSON.stringify([
  1, worldId, "Cloud World", 42, "survival", createdAt, "0", serialized.raw,
]));
assert.equal(parsed.ok, true);
if (!parsed.ok) throw new Error("fixture failed cloud validation");
const candidate = parsed.candidate;
assert.equal(isRestorableSinglePlayerSnapshot(snapshot), true, "the server portable gate accepts the canonical local fixture");

const withDrops = structuredClone(snapshot);
withDrops.drops = [{ dropId: "drop_A.1:test", item: { itemId: "dirt", count: 1 }, x: 0, y: 1, z: 2,
  droppedAt: 1, velocityY: -24, settled: false }];
assert.equal(isRestorableSinglePlayerSnapshot(withDrops), true, "entity IDs and the terminal-velocity boundary match local saves");
assert.equal(validateSinglePlayerSnapshot(withDrops).ok, true);
withDrops.drops[0].velocityY = -24.000_001;
assert.equal(isRestorableSinglePlayerSnapshot(withDrops), false);
assert.equal(validateSinglePlayerSnapshot(withDrops).ok, false);

const ordered = structuredClone(snapshot);
ordered.progression.recipes = ["A.recipe", "a:recipe"].sort(compareSinglePlayerCanonicalText);
ordered.world.edits = [{ x: -2, y: 0, z: 0, block: 1 }, { x: -1, y: 0, z: 0, block: 1 }];
assert.equal(isRestorableSinglePlayerSnapshot(ordered), true, "shared deterministic progression and numeric edit ordering match local normalization");
assert.equal(validateSinglePlayerSnapshot(ordered).ok, true);
ordered.progression.recipes.reverse();
assert.equal(isRestorableSinglePlayerSnapshot(ordered), false);
ordered.progression.recipes.reverse();
ordered.world.edits.reverse();
assert.equal(isRestorableSinglePlayerSnapshot(ordered), false);

const invalidNested = structuredClone(snapshot);
invalidNested.player.inventory[0] = { itemId: "dirt", count: 65 };
assert.equal(isRestorableSinglePlayerSnapshot(invalidNested), false);
assert.equal(validateSinglePlayerSnapshot(invalidNested).ok, false);
const invalidBody = { format: "lakecraft.singleplayer", payload: invalidNested, savedAt, sequence: 7, version: 1 };
const invalidRaw = canonicalCloudBackupJson({ checksum: cloudBackupHash(invalidBody), ...invalidBody });
assert.deepEqual(parseSinglePlayerCloudBackupCommitRequest(JSON.stringify([
  1, worldId, "Cloud World", 42, "survival", createdAt, "0", invalidRaw,
])), { ok: false, reason: "invalid_snapshot" }, "caller-recomputed checksums cannot bypass the complete portable schema gate");

const punctuationSnapshot = structuredClone(snapshot);
punctuationSnapshot.progression.recipes = ["A.recipe", "a.recipe", "_recipe", ":recipe"];
punctuationSnapshot.progression.advancements = ["Z:done", "z:done", ".done", "_done"];
const punctuationSave = serializeSinglePlayerSave(punctuationSnapshot, 8, savedAt + 1);
assert.equal(punctuationSave.ok, true);
if (!punctuationSave.ok) throw new Error("punctuation fixture failed local serialization");
assert.equal(parseSinglePlayerCloudBackupCommitRequest(JSON.stringify([
  1, worldId, "Cloud World", 42, "survival", createdAt, "0", punctuationSave.raw,
])).ok, true, "every locale-sorted punctuation/case fixture emitted locally passes cloud admission");

const crossLocaleSnapshot = structuredClone(snapshot);
crossLocaleSnapshot.drops = ["i", "I"].map((dropId, index) => ({ dropId, item: { itemId: "dirt" as const, count: 1 },
  x: index, y: 1, z: 0, droppedAt: index + 1, velocityY: 0, settled: true }));
crossLocaleSnapshot.chests = ["2:0:0", "1:0:0"].map((coordKey) => ({ coordKey, inventory: Array(27).fill(null) }));
crossLocaleSnapshot.furnaces = ["2:0:0", "1:0:0"].map((coordKey) => {
  const furnace = createEmptyFurnace(coordKey, 1);
  if (!furnace.ok) throw new Error("furnace locale fixture failed");
  return furnace.state;
});
crossLocaleSnapshot.primedTnt = ["i", "I"].map((eventId, index) => ({ eventId, x: index, y: 1, z: 0,
  ignitedAt: index + 1, dueAt: index + 2 }));
crossLocaleSnapshot.progression.recipes = ["i", "I"];
crossLocaleSnapshot.progression.advancements = ["i", "I"];
const originalLocaleCompare = String.prototype.localeCompare;
let crossLocaleSave: ReturnType<typeof serializeSinglePlayerSave>;
try {
  const turkish = new Intl.Collator("tr");
  String.prototype.localeCompare = function (other: string) { return turkish.compare(String(this), other); };
  crossLocaleSave = serializeSinglePlayerSave(crossLocaleSnapshot, 9, savedAt + 2);
  assert.equal(crossLocaleSave.ok, true);
  if (!crossLocaleSave.ok) throw new Error("cross-locale fixture failed local serialization");
  const english = new Intl.Collator("en");
  String.prototype.localeCompare = function (other: string) { return english.compare(String(this), other); };
  assert.equal(parseSinglePlayerCloudBackupCommitRequest(JSON.stringify([
    1, worldId, "Cloud World", 42, "survival", createdAt, "0", crossLocaleSave.raw,
  ])).ok, true, "Turkish-client serialization is admitted under an English server locale");
} finally {
  String.prototype.localeCompare = originalLocaleCompare;
}

const ascii = "a".repeat(150_000);
const asciiChunks = splitSinglePlayerCloudBackupSnapshot(ascii);
assert.deepEqual(asciiChunks?.map((chunk) => chunk.length), [48_000, 48_000, 48_000, 6_000]);
assert.equal(asciiChunks?.join(""), ascii);
assert.ok(asciiChunks?.every((chunk) => cloudBackupUtf8Bytes(chunk) <= SINGLE_PLAYER_CLOUD_BACKUP_CHUNK_BYTES));
assert.equal(
  asciiChunks!.reduce((sum, chunk) => sum + cloudBackupStoredChunkBytes(chunk), SINGLE_PLAYER_CLOUD_BACKUP_MANIFEST_STATE_BYTES),
  161_352,
  "the charged maximum ASCII payload must remain below the explicit per-user state cap",
);

const maximumUserId = `google:usr_${"a".repeat(509)}`;
assert.equal(maximumUserId.length, 520);
const actualChunkRow = JSON.stringify({ userId: maximumUserId, worldId: "w".repeat(64), uploadId: "f".repeat(64),
  chunkIndex: "3", chunkData: candidate.chunks[0], chunkBytes: "48000", chunkStateBytes: "999999", protocolVersion: "1" });
assert.ok(cloudBackupStoredChunkBytes(candidate.chunks[0]) >= cloudBackupUtf8Bytes(actualChunkRow) + 1_024,
  "the provider-prefixed maximum auth subject and complete chunk row stay conservatively charged");
assert.ok(SINGLE_PLAYER_CLOUD_BACKUP_MANIFEST_STATE_BYTES >= cloudBackupUtf8Bytes(JSON.stringify({
  userId: maximumUserId, worldId, name: "x".repeat(48), seed: "-2147483648", gameMode: "survival",
  worldCreatedAt: "8640000000000000", snapshotHash: "ffffffff", snapshotChars: "150000",
  snapshotUtf8Bytes: "192000", stateBytes: "192000", chunkCount: "4",
  uploadId: "ffffffff-ffffffff-zzzzzz", revision: "9007199254740991",
  uploadedAt: "8640000000000000", protocolVersion: "1",
})) + 1_024, "manifest charge covers the maximum auth subject, fields, and container/index margin");

const unicode = `${"😀".repeat(12_000)}x${"😀".repeat(12_000)}`;
const unicodeChunks = splitSinglePlayerCloudBackupSnapshot(unicode);
assert.ok(unicodeChunks && unicodeChunks.length === 3);
assert.equal(unicodeChunks.join(""), unicode);
assert.ok(unicodeChunks.every((chunk) => cloudBackupUtf8Bytes(chunk) <= SINGLE_PLAYER_CLOUD_BACKUP_CHUNK_BYTES));
assert.equal(splitSinglePlayerCloudBackupSnapshot("😀".repeat(48_001)), null,
  "a character-valid but byte-oversized payload must fail the four-chunk bound");

assert.equal(parseSinglePlayerSaveEnvelope(serialized.raw, worldId).ok, true);
assert.equal(parseSinglePlayerSaveEnvelope(serialized.raw, "different-world").ok, false);
const corruptEnvelope = JSON.parse(serialized.raw);
corruptEnvelope.checksum = "00000000";
assert.equal(parseSinglePlayerSaveEnvelope(JSON.stringify(corruptEnvelope), worldId).ok, false);
const futureEnvelope = JSON.parse(serialized.raw);
futureEnvelope.version = 2;
assert.deepEqual(parseSinglePlayerSaveEnvelope(JSON.stringify(futureEnvelope), worldId), {
  ok: false,
  reason: "unsupported",
});

const invalidWorldRequest = JSON.stringify([
  1, "different-world", "Cloud World", 42, "survival", createdAt, "0", serialized.raw,
]);
assert.deepEqual(parseSinglePlayerCloudBackupCommitRequest(invalidWorldRequest), {
  ok: false,
  reason: "invalid_snapshot",
});
assert.deepEqual(parseSinglePlayerCloudBackupDeleteRequest('[1,"cloud-world-alpha","3"]'), [1, worldId, "3"]);
assert.equal(parseSinglePlayerCloudBackupDeleteRequest('[1,"Cloud World","3"]'), null);

function decide(
  current: StoredSinglePlayerCloudBackupManifest | null,
  next: SinglePlayerCloudBackupCandidate,
  overrides: Partial<{
    currentSnapshotJson: string | null;
    userWorldCount: number;
    userStateBytes: number;
    globalStateBytes: number;
    userLastAcceptedAt: number;
    userAcceptedToday: number;
    globalAcceptedToday: number;
    now: number;
  }> = {},
) {
  return decideSinglePlayerCloudBackupCommit(
    current,
    overrides.currentSnapshotJson ?? null,
    next,
    overrides.userWorldCount ?? 0,
    overrides.userStateBytes ?? 0,
    overrides.globalStateBytes ?? 0,
    overrides.userLastAcceptedAt ?? 0,
    overrides.userAcceptedToday ?? 0,
    overrides.globalAcceptedToday ?? 0,
    overrides.now ?? SINGLE_PLAYER_CLOUD_BACKUP_MIN_USER_UPLOAD_MS,
  );
}

const first = decide(null, candidate);
assert.equal(first.ok, true);
assert.equal(first.ok && first.kind, "write");
if (!first.ok) throw new Error("fixture failed initial decision");
const manifest = first.manifest;
assert.equal(manifest.revision, "1");
assert.equal(validStoredSinglePlayerCloudBackupManifest(manifest), true);
assert.equal(validStoredSinglePlayerCloudBackupManifest({ ...manifest, stateBytes: "NaN" }), false);
assert.equal(validStoredSinglePlayerCloudBackupManifest({ ...manifest, revision: "0" }), false);
assert.equal(candidateMatchesManifest(candidate, manifest), true);

const staleExact = { ...candidate, expectedRevision: "0" };
const deduped = decide(manifest, staleExact, {
  currentSnapshotJson: candidate.snapshotJson,
  userWorldCount: 1,
  userStateBytes: candidate.stateBytes,
  globalStateBytes: candidate.stateBytes,
});
assert.equal(deduped.ok && deduped.kind, "deduped",
  "byte-identical retries dedupe before compare-and-swap conflict handling");

const sameHashDifferentBytes = { ...candidate, snapshotJson: `${candidate.snapshotJson} ` };
assert.deepEqual(decide(manifest, sameHashDifferentBytes, {
  currentSnapshotJson: candidate.snapshotJson,
  userWorldCount: 1,
  userStateBytes: candidate.stateBytes,
  globalStateBytes: candidate.stateBytes,
}), { ok: false, reason: "conflict" });

assert.deepEqual(decide(null, candidate, { userWorldCount: SINGLE_PLAYER_CLOUD_BACKUP_MAX_WORLDS }), {
  ok: false,
  reason: "world_limit",
});
assert.deepEqual(decide(null, candidate, { userStateBytes: SINGLE_PLAYER_CLOUD_BACKUP_MAX_USER_STATE_BYTES }), {
  ok: false,
  reason: "cloud_capacity",
});
assert.deepEqual(decide(null, candidate, { globalStateBytes: SINGLE_PLAYER_CLOUD_BACKUP_MAX_GLOBAL_STATE_BYTES }), {
  ok: false,
  reason: "cloud_capacity",
});
assert.deepEqual(decide(null, candidate, {
  userLastAcceptedAt: 1_000,
  now: 1_001,
}), {
  ok: false,
  reason: "cadence",
  retryAfterMs: SINGLE_PLAYER_CLOUD_BACKUP_MIN_USER_UPLOAD_MS - 1,
});
assert.deepEqual(decide(null, candidate, {
  userAcceptedToday: SINGLE_PLAYER_CLOUD_BACKUP_USER_DAILY_WRITES,
}), { ok: false, reason: "cloud_capacity" });
assert.deepEqual(decide(null, candidate, {
  globalAcceptedToday: SINGLE_PLAYER_CLOUD_BACKUP_GLOBAL_DAILY_WRITES,
}), { ok: false, reason: "cloud_capacity" });
assert.equal(utcCloudBackupDay(Date.UTC(2026, 6, 31, 23, 59)), "2026-07-31");
for (const value of ["2026-02-29", "2026-13-01", "2026-00-10", "2026-04-31", "2026-1-01", "not-a-day"]) {
  assert.equal(validUtcCloudBackupDay(value), false, `${value} is not a canonical real UTC day`);
}
assert.equal(validUtcCloudBackupDay("2024-02-29"), true);
const acceptedAt = Date.UTC(2026, 6, 31, 23, 59);
const cleanupAfter = singlePlayerCloudBudgetCleanupAfter("2026-07-31", acceptedAt);
assert.equal(cleanupAfter, acceptedAt + SINGLE_PLAYER_CLOUD_BACKUP_MIN_USER_UPLOAD_MS,
  "cleanup waits for both cadence and the matching UTC day to end");
assert.equal(singlePlayerCloudBudgetCleanupAfter("2026-07-30", acceptedAt), null,
  "a real but mismatched budget day fails closed");
assert.equal(singlePlayerCloudBudgetCleanupAfter("2026-02-29", acceptedAt), null);
const minimumQuota = SINGLE_PLAYER_CLOUD_BACKUP_QUOTA_STATE_BYTES
  + SINGLE_PLAYER_CLOUD_BACKUP_BUDGET_STATE_BYTES + candidate.stateBytes;
assert.equal(validSinglePlayerCloudQuotaState(minimumQuota - 1, minimumQuota, 1), false,
  "quota undercount cannot cover the caller manifest plus charged budget");
assert.equal(validSinglePlayerCloudQuotaState(minimumQuota, minimumQuota, Number.MAX_SAFE_INTEGER), false,
  "an exhausted quota revision fails on every mutation path");
assert.equal(validSinglePlayerCloudQuotaState(minimumQuota, minimumQuota, 1), true);
assert.deepEqual(decide({ ...manifest, revision: String(Number.MAX_SAFE_INTEGER) }, {
  ...candidate, expectedRevision: String(Number.MAX_SAFE_INTEGER),
}, { currentSnapshotJson: candidate.snapshotJson, userWorldCount: 1,
  userStateBytes: candidate.stateBytes, globalStateBytes: candidate.stateBytes }),
{ ok: false, reason: "server_state" }, "an exhausted stored revision is corrupt server state, not user capacity");

const storage = new MemoryStorage();
const restored = restoreMissingLocalWorld(storage, {
  worldId,
  name: "Cloud World",
  seed: 42,
  gameMode: "survival",
  createdAt,
  snapshot,
  snapshotSavedAt: savedAt,
});
assert.equal(restored.ok, true);
assert.equal(restored.ok && restored.world.id, worldId,
  "restore preserves an arbitrary valid cloud world id instead of regenerating one from the local registry");
const loaded = loadSinglePlayerSave(storage, { migrateLegacy: false, worldId });
assert.equal(loaded.status, "loaded");
assert.deepEqual(loaded.snapshot, snapshot);
assert.deepEqual(restoreMissingLocalWorld(storage, {
  worldId,
  name: "Cloud World",
  seed: 42,
  gameMode: "survival",
  createdAt,
  snapshot,
  snapshotSavedAt: savedAt,
}), { ok: false, reason: "world_exists", mutationStarted: false });

const full = new MemoryStorage();
for (let index = 0; index < LOCAL_WORLD_REGISTRY_MAX_WORLDS; index += 1) {
  assert.equal(createLocalWorld(full, {
    name: `Local ${index}`,
    seedText: String(index),
    gameMode: "survival",
    now: 10_000 + index,
  }).ok, true);
}
const beforeFullRestore = new Map(full.values);
assert.deepEqual(restoreMissingLocalWorld(full, {
  worldId: "cloud-world-overflow",
  name: "Overflow",
  seed: 99,
  gameMode: "survival",
  createdAt: 9_000,
  snapshot: createDefaultSinglePlayerSnapshot(99, 9_000, "cloud-world-overflow"),
  snapshotSavedAt: 9_100,
}), { ok: false, reason: "world_limit_reached", mutationStarted: false });
assert.deepEqual(full.values, beforeFullRestore, "capacity rejection must not mutate browser storage");
assert.equal(listLocalWorlds(full).worlds.length, LOCAL_WORLD_REGISTRY_MAX_WORLDS);

for (const kind of ["valid", "corrupt", "unsupported"] as const) {
  const orphanStorage = new MemoryStorage();
  const orphanId = `orphan-${kind}`;
  const orphanSnapshot = createDefaultSinglePlayerSnapshot(77, 7_700, orphanId);
  const orphanSave = serializeSinglePlayerSave(orphanSnapshot, 1, 7_701);
  assert.equal(orphanSave.ok, true);
  if (!orphanSave.ok) throw new Error("orphan fixture failed serialization");
  let raw = orphanSave.raw;
  if (kind === "corrupt") raw = "{corrupt";
  if (kind === "unsupported") {
    const future = JSON.parse(raw);
    future.version = 2;
    raw = JSON.stringify(future);
  }
  orphanStorage.setItem(singlePlayerWorldStorageKey(orphanId, SINGLEPLAYER_SAVE_SLOT_A_KEY), raw);
  const before = new Map(orphanStorage.values);
  assert.deepEqual(restoreMissingLocalWorld(orphanStorage, {
    worldId: orphanId, name: "Orphan", seed: 77, gameMode: "survival", createdAt: 7_700,
    snapshot: orphanSnapshot, snapshotSavedAt: 7_702,
  }), { ok: false, reason: "world_namespace_occupied", mutationStarted: false });
  assert.deepEqual(orphanStorage.values, before, `${kind} orphan namespace rejection mutates nothing`);
}

const serverSource = readFileSync(new URL("../server/index.ts", import.meta.url), "utf8");
assert.match(serverSource, /\.index\("by_cleanup", \["activeBackup", "cleanupAfter"\]\)/,
  "dormant budgets use an explicit eligibility index instead of a starvation-prone creation prefix");
assert.match(serverSource, /q\.eq\("activeBackup", "0"\)[\s\S]*?\.lt\("cleanupAfter"/,
  "cleanup selects only eligible dormant rows");
assert.match(serverSource, /userChunks\.length !== userManifests\.reduce/,
  "all per-user chunks must map one-for-one to active manifest chunk counts, rejecting orphans");
assert.match(serverSource, /row\.chunkStateBytes !== String\(cloudBackupStoredChunkBytes\(row\.chunkData\)\)/,
  "mutations re-derive conservative persisted-row charges before quota arithmetic");
assert.match(serverSource, /activeBackup: "0", cleanupAfter:/,
  "last-world permanent deletion retains cadence state only until its indexed cleanup deadline");
assert.match(serverSource, /userId\.length > 520/,
  "the server accepts the exact provider-prefixed maximum identity but rejects unbounded auth state");
assert.match(serverSource, /row\.userId === userId && \(!deleting \|\| current\)/,
  "an eligible dormant caller budget is reclaimed by its own repeated permanent-delete traffic");
assert.match(serverSource, /singlePlayerCloudBudgetCleanupAfter\(row\.dayKey, Number\(row\.lastAcceptedAt\)\)[\s\S]*?validUtcCloudBackupDay\(quota\.dayKey\)/,
  "budget day/timestamp pairs and quota day keys require canonical real UTC dates before mutation");
const cloudMutation = serverSource.slice(serverSource.indexOf("mutateSinglePlayerCloudBackup"), serverSource.indexOf("growOakTree"));
const undercountGuard = cloudMutation.indexOf("quota && !validSinglePlayerCloudQuotaState(globalStateBytes");
const destructiveDelete = cloudMutation.indexOf("for (const row of currentChunks) await ctx.db.singlePlayerCloudBackupChunks.delete");
assert.ok(undercountGuard >= 0 && undercountGuard < cloudMutation.indexOf("if (deleting)") && undercountGuard < destructiveDelete,
  "quota undercount and exhausted revision reject before delete, dedupe cleanup, or write mutation");
assert.match(cloudMutation, /const nextQuota = nextQuotaValue[\s\S]*?if \(!nextQuota\) return \{ ok: false, reason: BS\.invalidServerState, serverNow \};[\s\S]*?await applyCleanup\(\)/,
  "deduped cleanup validates its complete next quota before deleting a budget");
assert.match(cloudMutation, /const nextQuota = nextQuotaValue\(nextActiveStateBytes,[\s\S]*?if \(!nextQuota\) return \{ ok: false, reason: BS\.invalidServerState, serverNow \};[\s\S]*?for \(const row of currentChunks\)/,
  "write replacement validates next quota bytes/revision before replacing chunks");

console.log("single-player cloud backup protocol and explicit restore foundation tests passed");
