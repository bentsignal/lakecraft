import assert from "node:assert/strict";
import {
  createDefaultSinglePlayerSnapshot,
  loadSinglePlayerSave,
  parseSinglePlayerSaveEnvelope,
  serializeSinglePlayerSave,
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
  SINGLE_PLAYER_CLOUD_BACKUP_MAX_GLOBAL_STATE_BYTES,
  SINGLE_PLAYER_CLOUD_BACKUP_MAX_USER_STATE_BYTES,
  SINGLE_PLAYER_CLOUD_BACKUP_MAX_WORLDS,
  SINGLE_PLAYER_CLOUD_BACKUP_MIN_USER_UPLOAD_MS,
  SINGLE_PLAYER_CLOUD_BACKUP_USER_DAILY_WRITES,
  candidateMatchesManifest,
  cloudBackupStoredChunkBytes,
  cloudBackupUtf8Bytes,
  decideSinglePlayerCloudBackupCommit,
  parseSinglePlayerCloudBackupCommitRequest,
  parseSinglePlayerCloudBackupDeleteRequest,
  splitSinglePlayerCloudBackupSnapshot,
  utcCloudBackupDay,
  type SinglePlayerCloudBackupCandidate,
  type StoredSinglePlayerCloudBackupManifest,
} from "../shared/singlePlayerCloudBackups.ts";

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

const ascii = "a".repeat(150_000);
const asciiChunks = splitSinglePlayerCloudBackupSnapshot(ascii);
assert.deepEqual(asciiChunks?.map((chunk) => chunk.length), [48_000, 48_000, 48_000, 6_000]);
assert.equal(asciiChunks?.join(""), ascii);
assert.ok(asciiChunks?.every((chunk) => cloudBackupUtf8Bytes(chunk) <= SINGLE_PLAYER_CLOUD_BACKUP_CHUNK_BYTES));
assert.equal(
  asciiChunks!.reduce((sum, chunk) => sum + cloudBackupStoredChunkBytes(chunk), 1_024),
  154_104,
  "the charged maximum ASCII payload must remain below the explicit per-user state cap",
);

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

console.log("single-player cloud backup protocol and explicit restore foundation tests passed");
