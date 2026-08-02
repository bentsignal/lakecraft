import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createDefaultSinglePlayerSnapshot,
  loadSinglePlayerSave,
  parseSinglePlayerSaveEnvelope,
  SINGLEPLAYER_SAVE_HEAD_KEY,
  SINGLEPLAYER_SAVE_SLOT_A_KEY,
  SINGLEPLAYER_SAVE_SLOT_B_KEY,
  serializeSinglePlayerSave,
  singlePlayerSaveChecksum,
  singlePlayerWorldStorageKey,
  type SinglePlayerStorageAdapter,
} from "../client/singleplayer/localSave.ts";
import {
  parseRestorableSinglePlayerCloudBackup,
  parseSinglePlayerCloudBackupWire as parseClientSinglePlayerCloudBackupWire,
  parseServerQuarantinedSinglePlayerCloudBackup,
  prepareSinglePlayerCloudBackup,
  restoreSinglePlayerCloudBackup,
} from "../client/singleplayer/cloudBackupClient.ts";
import {
  LOCAL_WORLD_REGISTRY_MAX_WORLDS,
  createLocalWorld,
  listLocalWorlds,
  restoreMissingLocalWorld,
} from "../client/singleplayer/localWorldRegistry.ts";
import {
  SINGLE_PLAYER_CLOUD_BACKUP_CHUNK_BYTES,
  SINGLE_PLAYER_CLOUD_BACKUP_GLOBAL_DAILY_WRITES,
  SINGLE_PLAYER_CLOUD_BACKUP_HEADER_MAX_CHARS,
  SINGLE_PLAYER_CLOUD_BACKUP_BUDGET_STATE_BYTES,
  SINGLE_PLAYER_CLOUD_BACKUP_MANIFEST_STATE_BYTES,
  SINGLE_PLAYER_CLOUD_BACKUP_MAX_GLOBAL_STATE_BYTES,
  SINGLE_PLAYER_CLOUD_BACKUP_MAX_USER_STATE_BYTES,
  SINGLE_PLAYER_CLOUD_BACKUP_MAX_WORLDS,
  SINGLE_PLAYER_CLOUD_BACKUP_MIN_USER_UPLOAD_MS,
  SINGLE_PLAYER_CLOUD_BACKUP_MAX_OWNER_ROWS,
  SINGLE_PLAYER_CLOUD_BACKUP_MAX_TOMBSTONES,
  SINGLE_PLAYER_CLOUD_ACCOUNT_FENCE_WORLD,
  SINGLE_PLAYER_CLOUD_BACKUP_QUOTA_STATE_BYTES,
  SINGLE_PLAYER_CLOUD_BACKUP_USER_DAILY_WRITES,
  candidateMatchesManifest as tupleCandidateMatchesManifest,
  cloudBackupHash,
  cloudBackupStoredChunkBytes,
  cloudBackupStoredPartBytes,
  cloudBackupUtf8Bytes,
  decideSinglePlayerCloudBackupCommit as tupleDecideSinglePlayerCloudBackupCommit,
  decideSinglePlayerCloudBackupDeleteRevision,
  inventorySinglePlayerCloudBackupParts as tupleInventorySinglePlayerCloudBackupParts,
  loadSinglePlayerCloudBackupParts as tupleLoadSinglePlayerCloudBackupParts,
  loadSinglePlayerCloudBackupWorld as tupleLoadSinglePlayerCloudBackupWorld,
  nextSinglePlayerCloudGeneration,
  parseSinglePlayerCloudBackupCommitRequest as tupleParseSinglePlayerCloudBackupCommitRequest,
  parseSinglePlayerCloudBackupDeleteRequest,
  parseSinglePlayerCloudDispositionRequest,
  parseSinglePlayerCloudTombstone as tupleParseSinglePlayerCloudTombstone,
  parseSinglePlayerCloudBackupWire as tupleParseSinglePlayerCloudBackupWire,
  splitSinglePlayerCloudBackupSnapshot,
  singlePlayerCloudBackupHeader as tupleSinglePlayerCloudBackupHeader,
  singlePlayerCloudTombstoneHeader as tupleSinglePlayerCloudTombstoneHeader,
  singlePlayerCloudBackupDeleteActiveState,
  singlePlayerCloudBackupWire as tupleSinglePlayerCloudBackupWire,
  singlePlayerCloudBudgetCleanupAfter,
  singlePlayerCloudUnsigned,
  utcCloudBackupDay,
  validUtcCloudBackupDay,
  validStoredSinglePlayerCloudBackupManifest as tupleValidStoredSinglePlayerCloudBackupManifest,
  validSinglePlayerCloudQuotaState,
  type SinglePlayerCloudBackupCandidate as TupleCandidate,
  type StoredSinglePlayerCloudBackupPart,
  type StoredSinglePlayerCloudBackupManifest as TupleManifest,
} from "../shared/singlePlayerCloudBackups.ts";
import { validateSinglePlayerSnapshot } from "../client/singleplayer/localSave.ts";
import { createEmptyFurnace } from "../shared/furnaces.ts";
import { compareSinglePlayerCanonicalText } from "../shared/singlePlayerCanonicalOrder.ts";

type SinglePlayerCloudBackupCandidate = {
  worldId: string; name: string; seed: number; gameMode: "survival" | "creative"; worldCreatedAt: number;
  expectedRevision: string; snapshotHash: string; snapshotJson: string; snapshotUtf8Bytes: number;
  stateBytes: number; chunks: string[];
};
type StoredSinglePlayerCloudBackupManifest = {
  worldId: string; name: string; seed: string; gameMode: string; worldCreatedAt: string; snapshotHash: string;
  snapshotUtf8Bytes: string; stateBytes: string; count: string; revision: string; uploadedAt: string;
};
type SinglePlayerCloudTombstone = {
  worldId: string; revision: string; deletedRevision: string; deletedAt: string; operationId: string;
};
const candidateFromTuple = (value: TupleCandidate): SinglePlayerCloudBackupCandidate => ({
  worldId: value[0], name: value[1], seed: value[2], gameMode: value[3], worldCreatedAt: value[4],
  expectedRevision: value[5], snapshotHash: value[6], snapshotJson: value[7], snapshotUtf8Bytes: value[8],
  stateBytes: value[9], chunks: value[10],
});
const candidateToTuple = (value: SinglePlayerCloudBackupCandidate): TupleCandidate => [value.worldId, value.name,
  value.seed, value.gameMode, value.worldCreatedAt, value.expectedRevision, value.snapshotHash, value.snapshotJson,
  value.snapshotUtf8Bytes, value.stateBytes, value.chunks];
const manifestFromTuple = (value: TupleManifest): StoredSinglePlayerCloudBackupManifest => ({
  worldId: value[0], name: value[1], seed: value[2], gameMode: value[3], worldCreatedAt: value[4],
  snapshotHash: value[5], snapshotUtf8Bytes: value[6], stateBytes: value[7], count: value[8],
  revision: value[9], uploadedAt: value[10],
});
const manifestToTuple = (value: StoredSinglePlayerCloudBackupManifest): TupleManifest => [value.worldId, value.name,
  value.seed, value.gameMode, value.worldCreatedAt, value.snapshotHash, value.snapshotUtf8Bytes, value.stateBytes,
  value.count, value.revision, value.uploadedAt];
const parseSinglePlayerCloudBackupCommitRequest = (raw: string) => {
  const value = tupleParseSinglePlayerCloudBackupCommitRequest(raw);
  return value[0] ? { ok: true as const, candidate: candidateFromTuple(value[1]) }
    : { ok: false as const, reason: value[1] };
};
const parseSinglePlayerCloudBackupWire = (raw: unknown) => {
  const value = tupleParseSinglePlayerCloudBackupWire(raw);
  return value[0] ? { ok: true as const, wire: value[1], candidate: candidateFromTuple(value[2]) }
    : { ok: false as const, reason: value[1] };
};
const decideSinglePlayerCloudBackupCommit = (current: StoredSinglePlayerCloudBackupManifest | null,
  raw: string | null, candidate: SinglePlayerCloudBackupCandidate, ...rest: Parameters<typeof tupleDecideSinglePlayerCloudBackupCommit> extends
    readonly [unknown, unknown, unknown, ...infer Tail] ? Tail : never) => {
  const value = tupleDecideSinglePlayerCloudBackupCommit(current ? manifestToTuple(current) : null, raw,
    candidateToTuple(candidate), ...rest);
  return value[0] ? { ok: true as const, kind: value[1], manifest: manifestFromTuple(value[2]) }
    : { ok: false as const, reason: value[1], ...(value[2] === undefined ? {} : { retryAfterMs: value[2] }) };
};
const inventorySinglePlayerCloudBackupParts = (userId: string, rows: readonly StoredSinglePlayerCloudBackupPart[]) => {
  const value = tupleInventorySinglePlayerCloudBackupParts(userId, rows);
  return value[0] ? { ok: true as const,
    worlds: value[1].map((world) => ({ worldId: world[0], parts: world[1], stateBytes: world[2] })), stateBytes: value[2] }
    : { ok: false as const, reason: value[1] };
};
const loadSinglePlayerCloudBackupParts = (userId: string, rows: readonly StoredSinglePlayerCloudBackupPart[]) => {
  const value = tupleLoadSinglePlayerCloudBackupParts(userId, rows);
  return value[0] ? { ok: true as const,
    backups: value[1].map((backup) => ({ manifest: manifestFromTuple(backup[0]), snapshotJson: backup[1], parts: backup[2] })),
    tombstones: value[2].map((row) => ({ worldId: row[0], revision: row[1], deletedRevision: row[2],
      deletedAt: row[3], operationId: row[4] })),
    accountFence: value[3] ? { worldId: value[3][0], revision: value[3][1], deletedRevision: value[3][2],
      deletedAt: value[3][3], operationId: value[3][4] } : null, stateBytes: value[4] }
    : { ok: false as const, reason: value[1] };
};
const candidateMatchesManifest = (candidate: SinglePlayerCloudBackupCandidate, manifest: StoredSinglePlayerCloudBackupManifest) =>
  tupleCandidateMatchesManifest(candidateToTuple(candidate), manifestToTuple(manifest));
const singlePlayerCloudBackupHeader = (manifest: StoredSinglePlayerCloudBackupManifest) =>
  tupleSinglePlayerCloudBackupHeader(manifestToTuple(manifest));
const singlePlayerCloudBackupWire = (manifest: StoredSinglePlayerCloudBackupManifest, snapshotJson: string) =>
  tupleSinglePlayerCloudBackupWire(manifestToTuple(manifest), snapshotJson);
const tombstoneToTuple = (value: SinglePlayerCloudTombstone) => [value.worldId, value.revision, value.deletedRevision,
  value.deletedAt, value.operationId] as const;
const singlePlayerCloudTombstoneHeader = (value: SinglePlayerCloudTombstone) =>
  tupleSinglePlayerCloudTombstoneHeader(tombstoneToTuple(value));
const parseSinglePlayerCloudTombstone = (worldId: string, raw: string): SinglePlayerCloudTombstone | null => {
  const value = tupleParseSinglePlayerCloudTombstone(worldId, raw);
  return value ? { worldId: value[0], revision: value[1], deletedRevision: value[2], deletedAt: value[3],
    operationId: value[4] } : null;
};
const validStoredSinglePlayerCloudBackupManifest = (value: unknown) => Boolean(value && typeof value === "object"
  && !Array.isArray(value) && tupleValidStoredSinglePlayerCloudBackupManifest(manifestToTuple(value as StoredSinglePlayerCloudBackupManifest)));

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

const withDrops = structuredClone(snapshot);
withDrops.drops = [{ dropId: "drop_A.1:test", item: { itemId: "dirt", count: 1 }, x: 0, y: 1, z: 2,
  droppedAt: 1, velocityY: -24, settled: false }];
assert.equal(validateSinglePlayerSnapshot(withDrops).ok, true);
withDrops.drops[0].velocityY = -24.000_001;
assert.equal(validateSinglePlayerSnapshot(withDrops).ok, false);

const ordered = structuredClone(snapshot);
ordered.progression.recipes = ["A.recipe", "a:recipe"].sort(compareSinglePlayerCanonicalText);
ordered.world.edits = [{ x: -2, y: 0, z: 0, block: 1 }, { x: -1, y: 0, z: 0, block: 1 }];
assert.equal(validateSinglePlayerSnapshot(ordered).ok, true);

const invalidNested = structuredClone(snapshot);
invalidNested.player.inventory[0] = { itemId: "dirt", count: 65 };
assert.equal(validateSinglePlayerSnapshot(invalidNested).ok, false);
const invalidRaw = JSON.stringify({ checksum: "00000000", format: "lakecraft.singleplayer",
  payload: invalidNested, savedAt, sequence: 7, version: 1 });
assert.equal(parseSinglePlayerCloudBackupCommitRequest(JSON.stringify([
  1, worldId, "Cloud World", 42, "survival", createdAt, "0", invalidRaw,
] )).ok, true, "the server admits bounded opaque bytes without duplicating the client schema");
assert.equal(parseSinglePlayerCloudBackupCommitRequest(JSON.stringify([
  1, worldId, "Cloud World", 42, "survival", createdAt, "0", "{garbage",
])).ok, true, "arbitrary bounded payload bytes remain transportable for quarantine and deletion");
let deeplyNested = "0";
for (let depth = 0; depth < 2_000; depth += 1) deeplyNested = `[${deeplyNested}]`;
assert.equal(parseSinglePlayerCloudBackupCommitRequest(JSON.stringify([
  1, worldId, "Cloud World", 42, "survival", createdAt, "0", deeplyNested,
])).ok, true, "deep JSON is never recursively interpreted by server admission");

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
  171_116,
  "the charged maximum ASCII payload must remain below the explicit per-user state cap",
);

const maximumUserId = `google:usr_${"a".repeat(509)}`;
assert.equal(maximumUserId.length, 520);
const actualChunkRow = JSON.stringify({ userId: maximumUserId, worldId: "w".repeat(64),
  part: "4", data: candidate.chunks[0] });
assert.ok(cloudBackupStoredChunkBytes(candidate.chunks[0]) >= cloudBackupUtf8Bytes(actualChunkRow) + 1_024,
  "the provider-prefixed maximum auth subject and complete chunk row stay conservatively charged");
for (const adversarialUserId of ['"'.repeat(520), "\u0000".repeat(520), "😀".repeat(260)]) {
  const exact = cloudBackupStoredPartBytes(adversarialUserId, worldId, "1", candidate.chunks[0]);
  assert.equal(exact, cloudBackupUtf8Bytes(JSON.stringify({
    userId: adversarialUserId, worldId, part: "1", data: candidate.chunks[0],
  })) + 1_024, "server charge is derived from the exact persisted row and escaped identity bytes");
  assert.ok(cloudBackupStoredChunkBytes(candidate.chunks[0]) >= exact,
    "pre-auth admission remains conservative for quote, NUL, and multibyte maximum-length identities");
}
const maximumHeader = JSON.stringify([1, "x".repeat(48), "-2147483648", "survival", "8640000000000000",
  "ffffffff", "9007199254740991", "8640000000000000"]);
assert.equal(cloudBackupStoredPartBytes(maximumUserId, "w".repeat(64), "0", maximumHeader),
  cloudBackupUtf8Bytes(JSON.stringify({ userId: maximumUserId, worldId: "w".repeat(64), part: "0", data: maximumHeader })) + 1_024,
  "header accounting uses the exact persisted owner, metadata bytes, and row margin");

const unicode = `${"😀".repeat(12_000)}x${"😀".repeat(12_000)}`;
const unicodeChunks = splitSinglePlayerCloudBackupSnapshot(unicode);
assert.ok(unicodeChunks && unicodeChunks.length === 3);
assert.equal(unicodeChunks.join(""), unicode);
assert.ok(unicodeChunks.every((chunk) => cloudBackupUtf8Bytes(chunk) <= SINGLE_PLAYER_CLOUD_BACKUP_CHUNK_BYTES));
assert.equal(cloudBackupHash(serialized.raw), candidate.snapshotHash,
  "the stored transport hash is always recomputed from the exact raw snapshot bytes");
const oldUtf8Hash = (text: string) => {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(text)) hash = Math.imul(hash ^ byte, 0x01000193);
  return (hash >>> 0).toString(16).padStart(8, "0");
};
for (const text of ["ascii", "é", "😀", "\ud800", "\udc00", "a😀é\ud800z"]) {
  assert.equal(cloudBackupHash(text), singlePlayerSaveChecksum(text), "client/server code-unit FNV stays exact");
  assert.equal(cloudBackupUtf8Bytes(text), new TextEncoder().encode(text).length,
    "compact UTF-8 accounting preserves replacement-byte behavior for lone surrogates");
}
assert.notEqual(cloudBackupHash("😀"), oldUtf8Hash("😀"), "the former UTF-8-byte hash is not accepted as the new integrity hash");
assert.equal(splitSinglePlayerCloudBackupSnapshot("😀".repeat(48_001)), null,
  "a character-valid but byte-oversized payload must fail the four-chunk bound");

assert.ok(parseSinglePlayerSaveEnvelope(serialized.raw, worldId)[0]);
assert.equal(parseSinglePlayerSaveEnvelope(serialized.raw, "different-world")[0], null);
const corruptEnvelope = JSON.parse(serialized.raw);
corruptEnvelope.checksum = "00000000";
assert.deepEqual(parseSinglePlayerSaveEnvelope(JSON.stringify(corruptEnvelope), worldId), [null, "invalid"]);
const futureEnvelope = JSON.parse(serialized.raw);
futureEnvelope.version = 2;
assert.deepEqual(parseSinglePlayerSaveEnvelope(JSON.stringify(futureEnvelope), worldId), [null, "unsupported"]);

const invalidWorldRequest = JSON.stringify([
  1, "different-world", "Cloud World", 42, "survival", createdAt, "0", serialized.raw,
]);
assert.equal(parseSinglePlayerCloudBackupCommitRequest(invalidWorldRequest).ok, true,
  "server admission deliberately does not classify opaque local-world semantics");
assert.deepEqual(parseSinglePlayerCloudBackupDeleteRequest('[1,"cloud-world-alpha","3","delete_123"]'),
  [1, worldId, "3", "delete_123"]);
assert.equal(parseSinglePlayerCloudBackupDeleteRequest('[1,"cloud-world-alpha","3"]'), null,
  "delete retries require their stable operation id");
assert.equal(parseSinglePlayerCloudBackupDeleteRequest('[1,"Cloud World","3","delete_123"]'), null);
assert.deepEqual(parseSinglePlayerCloudDispositionRequest('[2,"3"]'), [2, "3"]);
assert.deepEqual(parseSinglePlayerCloudDispositionRequest('[3,"4"]'), [3, "4"]);
assert.equal(parseSinglePlayerCloudDispositionRequest('[2,"3","extra"]'), null);

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
    generation: string;
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
    overrides.generation ?? String(Number(current?.revision ?? "0") + 1),
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
assert.equal(validStoredSinglePlayerCloudBackupManifest({ ...manifest, seed: "00" }), true,
  "stored manifests retain parent acceptance of bounded noncanonical seed strings");
assert.equal(validStoredSinglePlayerCloudBackupManifest({ ...manifest, stateBytes: "NaN" }), false);
assert.equal(validStoredSinglePlayerCloudBackupManifest({ ...manifest, revision: "0" }), false);
assert.equal(candidateMatchesManifest(candidate, manifest), true);
const otherUserGeneration = decide(null, { ...candidate, worldId: "other-user-world" }, { generation: "2" });
assert.equal(otherUserGeneration.ok && otherUserGeneration.manifest.revision, "2",
  "global generations advance across owners instead of restarting per world");
const noncontiguousReplacement = decide(manifest, { ...candidate, snapshotJson: `${candidate.snapshotJson}x`,
  expectedRevision: manifest.revision }, { currentSnapshotJson: candidate.snapshotJson, userWorldCount: 1,
  userStateBytes: candidate.stateBytes, globalStateBytes: candidate.stateBytes, generation: "3" });
assert.equal(noncontiguousReplacement.ok && noncontiguousReplacement.manifest.revision, "3",
  "a later replacement receives the next global generation even when its world skips a token");
const recreatedGeneration = decide(null, candidate, { generation: "4" });
assert.equal(recreatedGeneration.ok && recreatedGeneration.manifest.revision, "4",
  "delete and recreate cannot reuse the deleted world's generation");
assert.deepEqual(decide({ ...manifest, revision: "5" }, { ...candidate, expectedRevision: "5" }, {
  currentSnapshotJson: `${candidate.snapshotJson}x`, userWorldCount: 1, userStateBytes: candidate.stateBytes,
  globalStateBytes: candidate.stateBytes, generation: "5",
}), { ok: false, reason: "server_state" }, "a manifest generation cannot exceed or equal the proposed global successor");
assert.deepEqual(decide(null, candidate, { generation: String(Number.MAX_SAFE_INTEGER) }),
  { ok: false, reason: "server_state" }, "global generation exhaustion fails closed");
assert.equal(nextSinglePlayerCloudGeneration(Number.MAX_SAFE_INTEGER - 2), String(Number.MAX_SAFE_INTEGER - 1),
  "the last non-exhausted quota generation is accepted and emitted exactly");
assert.equal(nextSinglePlayerCloudGeneration(Number.MAX_SAFE_INTEGER - 1), null);
const finalGeneration = decide(null, candidate, { generation: String(Number.MAX_SAFE_INTEGER - 1) });
assert.equal(finalGeneration.ok && finalGeneration.manifest.revision, String(Number.MAX_SAFE_INTEGER - 1));

let harnessQuotaRevision = 0;
const harnessCommit = (current: StoredSinglePlayerCloudBackupManifest | null,
  next: SinglePlayerCloudBackupCandidate, currentRaw: string | null, cleanup = false) => {
  const generation = nextSinglePlayerCloudGeneration(harnessQuotaRevision);
  if (!generation) return { ok: false as const, reason: "server_state" as const };
  const decision = decide(current, next, { currentSnapshotJson: currentRaw, userWorldCount: current ? 1 : 0,
    userStateBytes: current ? Number(current.stateBytes) : 0, globalStateBytes: current ? Number(current.stateBytes) : 0,
    generation });
  if (decision.ok && (decision.kind === "write" || cleanup)) harnessQuotaRevision = Number(generation);
  return decision;
};
const harnessA = harnessCommit(null, candidate, null);
assert.equal(harnessA.ok && harnessA.manifest.revision, "1");
const harnessB = harnessCommit(null, { ...candidate, worldId: "world-b" }, null);
assert.equal(harnessB.ok && harnessB.manifest.revision, "2", "a second owner receives the next serialized token");
if (!harnessA.ok) throw new Error("generation harness A failed");
const harnessReplacement = harnessCommit(harnessA.manifest,
  { ...candidate, expectedRevision: "1", snapshotJson: `${candidate.snapshotJson}x` }, candidate.snapshotJson);
assert.equal(harnessReplacement.ok && harnessReplacement.manifest.revision, "3");
const beforeDedupe = harnessQuotaRevision;
assert.equal(harnessCommit(harnessA.manifest, candidate, candidate.snapshotJson).ok, true);
assert.equal(harnessQuotaRevision, beforeDedupe, "dedupe without cleanup does not spend a generation");
const cleanupDedupe = harnessCommit(harnessA.manifest, candidate, candidate.snapshotJson, true);
assert.equal(cleanupDedupe.ok && cleanupDedupe.manifest.revision, harnessA.manifest.revision);
assert.equal(harnessQuotaRevision, beforeDedupe + 1, "dedupe with cleanup advances quota once but keeps the manifest token");
const beforeFailure = harnessQuotaRevision;
assert.equal(harnessCommit(harnessA.manifest, { ...candidate, expectedRevision: "999",
  snapshotJson: `${candidate.snapshotJson}y` }, candidate.snapshotJson).ok, false);
assert.equal(harnessQuotaRevision, beforeFailure, "failed commit leaves global generation unchanged");
assert.equal(decideSinglePlayerCloudBackupDeleteRevision(false, null, "0"), "deduped");
assert.equal(harnessQuotaRevision, beforeFailure, "missing delete without cleanup is a true no-op");
const cleanupGeneration = nextSinglePlayerCloudGeneration(harnessQuotaRevision)!;
harnessQuotaRevision = Number(cleanupGeneration);
assert.equal(harnessQuotaRevision, beforeFailure + 1, "missing delete with cleanup advances exactly once");

const storedParts: StoredSinglePlayerCloudBackupPart[] = [
  { userId: "user-a", worldId, part: "0", data: singlePlayerCloudBackupHeader(manifest) },
  ...candidate.chunks.map((data, index) => ({ userId: "user-a", worldId, part: String(index + 1), data })),
];
const loadedParts = loadSinglePlayerCloudBackupParts("user-a", [...storedParts].reverse());
assert.equal(loadedParts.ok, true, "database row order is irrelevant after exact contiguous-part reconstruction");
assert.equal(loadedParts.ok && loadedParts.backups[0].snapshotJson, candidate.snapshotJson);
if (!loadedParts.ok) throw new Error("ordinary owner fixture failed exact reconstruction");
const ordinaryManifest = loadedParts.backups[0].manifest;
const unsafeRevisionHeader = singlePlayerCloudBackupHeader({ ...ordinaryManifest, revision: "9007199254740992" });
assert.deepEqual(loadSinglePlayerCloudBackupParts("user-a", [
  { userId: "user-a", worldId, part: "0", data: unsafeRevisionHeader },
  ...candidate.chunks.map((data, index) => ({ userId: "user-a", worldId, part: String(index + 1), data })),
]), { ok: false, reason: "server_state" },
"stored headers above Number.MAX_SAFE_INTEGER fail closed before predecessor arithmetic");
const tupleInventory = tupleInventorySinglePlayerCloudBackupParts("user-a", storedParts);
assert.equal(tupleInventory[0], 1);
if (!tupleInventory[0]) throw new Error("tuple owner fixture failed inventory");
const directWorld = tupleLoadSinglePlayerCloudBackupWorld(tupleInventory[1][0]);
assert.equal(directWorld[0], 1, "the compact server path reconstructs an already-inventoried world");
assert.equal(directWorld[0] && directWorld[1][0][1], candidate.snapshotJson);
const missingPartWorld = [tupleInventory[1][0][0],
  tupleInventory[1][0][1].filter((part) => part.part !== "1"), tupleInventory[1][0][2]] as const;
assert.deepEqual(tupleLoadSinglePlayerCloudBackupWorld(missingPartWorld), [0, "server_state"],
  "the compact server path still fails closed on adversarial non-contiguous topology");
const ordinaryStateBytes = inventorySinglePlayerCloudBackupParts("user-a", storedParts);
assert.equal(ordinaryStateBytes.ok, true);
if (!ordinaryStateBytes.ok) throw new Error("ordinary owner fixture failed inventory");
assert.equal(Number(ordinaryManifest.stateBytes), ordinaryStateBytes.stateBytes,
  "reconstructed manifest charge is the exact ordinary-owner row charge");
const ordinaryDedupe = decide(ordinaryManifest, { ...candidate, stateBytes: ordinaryStateBytes.stateBytes }, {
  currentSnapshotJson: candidate.snapshotJson, userWorldCount: 1,
  userStateBytes: ordinaryStateBytes.stateBytes, globalStateBytes: ordinaryStateBytes.stateBytes,
});
assert.equal(ordinaryDedupe.ok && ordinaryDedupe.kind, "deduped",
  "exact ordinary-owner retry remains eligible for byte dedupe");
const tombstone = { worldId, revision: "2", deletedRevision: ordinaryManifest.revision,
  deletedAt: "3000", operationId: "delete_retry_1" };
const tombstoneHeader = singlePlayerCloudTombstoneHeader(tombstone);
assert.deepEqual(parseSinglePlayerCloudTombstone(worldId, tombstoneHeader), tombstone,
  "a durable deletion fence round-trips its successor, predecessor, time, and stable operation id");
const loadedTombstone = loadSinglePlayerCloudBackupParts("user-a", [
  { userId: "user-a", worldId, part: "0", data: tombstoneHeader },
]);
assert.equal(loadedTombstone.ok, true);
assert.deepEqual(loadedTombstone.ok && loadedTombstone.tombstones, [tombstone]);
assert.equal(loadedTombstone.ok && loadedTombstone.backups.length, 0,
  "a tombstone can never be reconstructed as restorable payload");
assert.equal(tombstone.deletedRevision === ordinaryManifest.revision && tombstone.operationId === "delete_retry_1", true,
  "the identical lost-response delete can dedupe without treating the tombstone as a conflict");
assert.equal(tombstone.deletedRevision === "0", false,
  "a stale device cannot reinterpret a durable delete fence as an empty cloud slot");
assert.equal(parseSinglePlayerCloudTombstone(worldId,
  singlePlayerCloudTombstoneHeader({ ...tombstone, revision: "4", deletedRevision: tombstone.revision } ))?.revision, "4",
  "delete then explicit recreate then delete advances the global generation instead of reusing lineage");
const ownerRowOverflow = Array.from({ length: SINGLE_PLAYER_CLOUD_BACKUP_MAX_OWNER_ROWS + 1 }, (_, index) => ({
  userId: "user-a", worldId: `overflow-${index}`, part: "0", data: tombstoneHeader,
}));
assert.deepEqual(inventorySinglePlayerCloudBackupParts("user-a", ownerRowOverflow),
  { ok: false, reason: "server_state" }, "owner recovery stays bounded even for excess historical rows");
const tombstoneRows = Array.from({ length: SINGLE_PLAYER_CLOUD_BACKUP_MAX_TOMBSTONES + 1 }, (_, index) => {
  const id = `deleted-${index}`;
  return { userId: "user-a", worldId: id, part: "0", data: singlePlayerCloudTombstoneHeader({ ...tombstone,
    worldId: id, revision: String(index + 2), operationId: `delete_cap_${index}` }) };
});
assert.deepEqual(loadSinglePlayerCloudBackupParts("user-a", tombstoneRows),
  { ok: false, reason: "server_state" }, "durable tombstones have an explicit per-owner capacity");
const fence = { ...tombstone, worldId: SINGLE_PLAYER_CLOUD_ACCOUNT_FENCE_WORLD,
  revision: "20", operationId: "recover_20" };
const loadedFence = loadSinglePlayerCloudBackupParts("user-a", [{ userId: "user-a",
  worldId: SINGLE_PLAYER_CLOUD_ACCOUNT_FENCE_WORLD, part: "0", data: singlePlayerCloudTombstoneHeader(fence) }]);
assert.equal(loadedFence.ok && loadedFence.accountFence?.revision, "20",
  "owner recovery finishes behind a separate durable account fence");
const replacementParsed = parseSinglePlayerCloudBackupCommitRequest(JSON.stringify([
  1, worldId, "Cloud World", 42, "survival", createdAt, ordinaryManifest.revision, `${candidate.snapshotJson}x`,
]));
assert.equal(replacementParsed.ok, true);
if (!replacementParsed.ok) throw new Error("replacement fixture failed admission");
const replacementAt = Number(ordinaryManifest.uploadedAt) + SINGLE_PLAYER_CLOUD_BACKUP_MIN_USER_UPLOAD_MS;
const replacementHeader = singlePlayerCloudBackupHeader({ ...ordinaryManifest,
  snapshotHash: replacementParsed.candidate.snapshotHash, revision: "2", uploadedAt: String(replacementAt) });
const replacementStateBytes = replacementParsed.candidate.chunks.reduce((sum, data, index) => sum
  + cloudBackupStoredPartBytes("user-a", worldId, String(index + 1), data),
cloudBackupStoredPartBytes("user-a", worldId, "0", replacementHeader));
const replacement = decide(ordinaryManifest, { ...replacementParsed.candidate, stateBytes: replacementStateBytes }, {
  currentSnapshotJson: candidate.snapshotJson, userWorldCount: 1,
  userStateBytes: ordinaryStateBytes.stateBytes, globalStateBytes: ordinaryStateBytes.stateBytes,
  userLastAcceptedAt: Number(ordinaryManifest.uploadedAt), now: replacementAt,
});
assert.equal(replacement.ok && replacement.kind, "write",
  "replacement subtracts the exact current-owner charge and adds the exact next-owner charge without underflow");
for (const [before, after] of [["9", "10"], ["99", "100"]] as const) {
  assert.equal(singlePlayerCloudBackupHeader({ ...ordinaryManifest, revision: after }).length,
    singlePlayerCloudBackupHeader({ ...ordinaryManifest, revision: before }).length + 1,
    `${before}→${after} generation growth is included in exact header/state charging`);
}
assert.deepEqual(loadSinglePlayerCloudBackupParts("user-a", storedParts.slice(0, -1)), {
  ok: false, reason: "server_state",
}, "a truncated payload is corrupt server state");
assert.deepEqual(loadSinglePlayerCloudBackupParts("user-a", [
  storedParts[0], { ...storedParts[1], userId: "user-b" },
]), { ok: false, reason: "server_state" }, "cross-user parts can never enter another owner's backup set");
assert.equal(decideSinglePlayerCloudBackupDeleteRevision(true, "1", "0"), "conflict",
  "a healthy target always rejects the corrupt-target sentinel");
assert.equal(decideSinglePlayerCloudBackupDeleteRevision(true, null, "0"), "delete",
  "a bounded-unhealthy target accepts only the explicit corrupt-target sentinel");
assert.equal(decideSinglePlayerCloudBackupDeleteRevision(true, null, "1"), "conflict");
assert.equal(decideSinglePlayerCloudBackupDeleteRevision(false, null, "0"), "deduped",
  "a missing target treats sentinel delete as an idempotent retry");
assert.equal(decideSinglePlayerCloudBackupDeleteRevision(false, null, "1"), "conflict");
assert.equal(decideSinglePlayerCloudBackupDeleteRevision(true, "2", "0"), "conflict",
  "a concurrently repaired healthy target rejects a stale corrupt-target sentinel");
assert.equal(singlePlayerCloudBackupDeleteActiveState(12_000, 10_000, 8_000, 0), 10_000,
  "a corruption-expanded target releases only the 2,000 bytes actually covered by global accounting");
assert.equal(singlePlayerCloudBackupDeleteActiveState(9_999, 10_000, 8_000, 0), null,
  "delete never hides undercount in the state that remains after target removal");

const boundedUnhealthySibling: StoredSinglePlayerCloudBackupPart[] = [
  ...storedParts,
  { userId: "user-a", worldId: "broken-sibling", part: "0", data: "not-json" },
  { userId: "user-a", worldId: "broken-sibling", part: "1", data: "opaque" },
];
const siblingInventory = inventorySinglePlayerCloudBackupParts("user-a", boundedUnhealthySibling);
assert.equal(siblingInventory.ok, true);
if (!siblingInventory.ok) throw new Error("bounded sibling inventory failed");
assert.equal(loadSinglePlayerCloudBackupParts("user-a",
  siblingInventory.worlds.find(({ worldId: id }) => id === worldId)!.parts).ok, true,
"a bounded unhealthy sibling cannot block target-specific healthy reconstruction");
assert.deepEqual(loadSinglePlayerCloudBackupParts("user-a",
  siblingInventory.worlds.find(({ worldId: id }) => id === "broken-sibling")!.parts),
{ ok: false, reason: "server_state" });
assert.deepEqual(inventorySinglePlayerCloudBackupParts("user-a", [
  { userId: "user-a", worldId, part: "0", data: "x".repeat(SINGLE_PLAYER_CLOUD_BACKUP_HEADER_MAX_CHARS + 1) },
]), { ok: false, reason: "server_state" }, "oversized headers fail before JSON parsing");
assert.deepEqual(inventorySinglePlayerCloudBackupParts("user-a", [
  { userId: "user-a", worldId, part: "1", data: "x".repeat(SINGLE_PLAYER_CLOUD_BACKUP_CHUNK_BYTES + 1) },
]), { ok: false, reason: "server_state" }, "oversized payload parts fail before joining");
const aggregateRows: StoredSinglePlayerCloudBackupPart[] = ["aggregate-a", "aggregate-b"].flatMap((id) => [
  { userId: "user-a", worldId: id, part: "0", data: "[]" },
  { userId: "user-a", worldId: id, part: "1", data: "x".repeat(48_000) },
  { userId: "user-a", worldId: id, part: "2", data: "y".repeat(48_000) },
  { userId: "user-a", worldId: id, part: "3", data: "z".repeat(4_000) },
]);
const aggregateInventory = inventorySinglePlayerCloudBackupParts("user-a", aggregateRows);
assert.equal(aggregateInventory.ok, true);
assert.ok(aggregateInventory.ok && aggregateInventory.stateBytes > SINGLE_PLAYER_CLOUD_BACKUP_MAX_USER_STATE_BYTES,
  "bounded per-world parts can still exceed the aggregate owner cap and must be rejected by query/commit admission");

const largeOpaque = "a".repeat(48_000) + "b".repeat(48_000) + "c".repeat(48_000) + "d".repeat(6_000);
const largeParsed = parseSinglePlayerCloudBackupCommitRequest(JSON.stringify([
  1, "large-world", "Large", 1, "creative", 2, "0", largeOpaque,
]));
assert.equal(largeParsed.ok, true);
if (!largeParsed.ok) throw new Error("large opaque fixture failed admission");
const largeDecision = decide(null, largeParsed.candidate, { now: SINGLE_PLAYER_CLOUD_BACKUP_MIN_USER_UPLOAD_MS });
assert.equal(largeDecision.ok, true);
if (!largeDecision.ok) throw new Error("large opaque fixture failed decision");
const reorderedParts: StoredSinglePlayerCloudBackupPart[] = [
  { userId: "user-a", worldId: "large-world", part: "0", data: singlePlayerCloudBackupHeader(largeDecision.manifest) },
  ...largeParsed.candidate.chunks.map((data, index) => ({ userId: "user-a", worldId: "large-world", part: String(index + 1), data })),
];
[reorderedParts[1].data, reorderedParts[2].data] = [reorderedParts[2].data, reorderedParts[1].data];
assert.deepEqual(loadSinglePlayerCloudBackupParts("user-a", reorderedParts), {
  ok: false, reason: "server_state",
}, "payload chunks swapped under otherwise valid part numbers fail the recomputed hash/topology check");

const staleExact = { ...candidate, expectedRevision: "0" };
const deduped = decide(manifest, staleExact, {
  currentSnapshotJson: candidate.snapshotJson,
  userWorldCount: 1,
  userStateBytes: candidate.stateBytes,
  globalStateBytes: candidate.stateBytes,
});
assert.equal(deduped.ok && deduped.kind, "deduped",
  "byte-identical retries dedupe before compare-and-swap conflict handling");

const sameHashDifferentBytes = { ...candidate, snapshotJson: `${candidate.snapshotJson} `,
  snapshotHash: manifest.snapshotHash };
assert.deepEqual(decide(manifest, sameHashDifferentBytes, {
  currentSnapshotJson: candidate.snapshotJson,
  userWorldCount: 1,
  userStateBytes: candidate.stateBytes,
  globalStateBytes: candidate.stateBytes,
}), { ok: false, reason: "conflict" }, "an alleged hash collision with unequal bytes never exact-dedupes");

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
if (!restored.ok) throw new Error("restore fixture unexpectedly failed");
const prepared = prepareSinglePlayerCloudBackup(storage, restored.world, "0");
assert.equal(prepared.ok, true, "upload preparation rereads and validates the exact committed local journal bytes");
if (!prepared.ok) throw new Error("upload fixture unexpectedly failed");
assert.ok(parseSinglePlayerSaveEnvelope(prepared.backup[1], worldId)[0]);
assert.equal(prepared.backup[2], loaded.sequence);

const validWire = singlePlayerCloudBackupWire(manifest, candidate.snapshotJson);
assert.equal(parseSinglePlayerCloudBackupWire(validWire).ok, true);
const iteratorThrowingWire = new Proxy([...validWire], { get(target, property, receiver) {
  if (property === Symbol.iterator) throw new Error("untrusted iterator must not run");
  return Reflect.get(target, property, receiver);
} });
assert.equal(parseClientSinglePlayerCloudBackupWire(iteratorThrowingWire), iteratorThrowingWire,
  "a valid parent array is parsed only through direct indexed fields without invoking its iterator");
const iteratorSpoof = Array<unknown>(10).fill(Symbol("invalid-index"));
Object.defineProperty(iteratorSpoof, Symbol.iterator, { value: function* () { yield* validWire; } });
assert.equal(parseClientSinglePlayerCloudBackupWire(iteratorSpoof), null,
  "a custom iterator yielding valid fields cannot hide invalid Symbol-valued indexed fields");
assert.deepEqual(tupleParseSinglePlayerCloudBackupWire([...validWire.slice(0, 8), "9007199254740992", validWire[9]]),
  [0, "invalid_backup"], "wire revisions above Number.MAX_SAFE_INTEGER fail closed before predecessor arithmetic");
assert.equal(parseRestorableSinglePlayerCloudBackup(validWire).ok, true,
  "only a complete locally valid journal envelope leaves download quarantine");
const oldHashWire = [1, worldId, "Cloud World", "42", "survival", String(createdAt),
  oldUtf8Hash("😀"), "😀", "1", String(savedAt)];
assert.equal(parseClientSinglePlayerCloudBackupWire(oldHashWire), null,
  "a previously accepted UTF-8-byte hash is rejected after checksum unification");
const oldHashRequest = parseSinglePlayerCloudBackupCommitRequest(JSON.stringify([
  1, "unicode-opaque", "Unicode", 42, "survival", createdAt, "0", "😀",
]));
assert.equal(oldHashRequest.ok, true);
if (!oldHashRequest.ok) throw new Error("old hash server fixture failed");
const oldHashDecision = decide(null, oldHashRequest.candidate);
assert.equal(oldHashDecision.ok, true);
if (!oldHashDecision.ok) throw new Error("old hash decision fixture failed");
const oldHashManifest = { ...oldHashDecision.manifest, snapshotHash: oldUtf8Hash("😀") };
assert.deepEqual(loadSinglePlayerCloudBackupParts("user-a", [
  { userId: "user-a", worldId: "unicode-opaque", part: "0", data: singlePlayerCloudBackupHeader(oldHashManifest) },
  { userId: "user-a", worldId: "unicode-opaque", part: "1", data: "😀" },
]), { ok: false, reason: "server_state" }, "server reconstruction rejects a stored former UTF-8-byte hash");
const hashMismatchWire = [...validWire];
hashMismatchWire[6] = hashMismatchWire[6] === "00000000" ? "11111111" : "00000000";
assert.deepEqual(parseRestorableSinglePlayerCloudBackup(hashMismatchWire), { ok: false, reason: "backup_quarantined" },
  "a mismatched outer snapshot hash exposes no restore or delete metadata");
const outerMismatchWire = [...validWire];
outerMismatchWire[3] = "43";
assert.equal(parseSinglePlayerCloudBackupWire(outerMismatchWire).ok, true,
  "transport validation intentionally does not interpret world metadata inside opaque bytes");
const outerMismatch = parseRestorableSinglePlayerCloudBackup(outerMismatchWire);
assert.equal(outerMismatch.ok, false, "outer metadata disagreement remains quarantined on the client");
assert.deepEqual(!outerMismatch.ok && outerMismatch.quarantine, [worldId, "1"],
  "semantic quarantine preserves only the validated outer world id and exact revision");

const garbageParsed = parseSinglePlayerCloudBackupCommitRequest(JSON.stringify([
  1, "opaque-world", "Opaque", 7, "creative", 4_000, "0", "{garbage",
]));
assert.equal(garbageParsed.ok, true);
if (!garbageParsed.ok) throw new Error("garbage transport fixture failed admission");
const garbageDecision = decide(null, garbageParsed.candidate);
assert.equal(garbageDecision.ok, true);
if (!garbageDecision.ok) throw new Error("garbage transport fixture failed decision");
const garbageWire = singlePlayerCloudBackupWire(garbageDecision.manifest, garbageParsed.candidate.snapshotJson);
assert.equal(parseSinglePlayerCloudBackupWire(garbageWire).ok, true,
  "opaque garbage remains readable at the transport layer so it can be permanently deleted");
const garbageQuarantine = parseRestorableSinglePlayerCloudBackup(garbageWire);
assert.equal(garbageQuarantine.ok, false);
assert.equal(JSON.stringify([1, ...(!garbageQuarantine.ok && garbageQuarantine.quarantine || [])]),
  JSON.stringify([1, "opaque-world", garbageDecision.manifest.revision]));
assert.deepEqual(parseServerQuarantinedSinglePlayerCloudBackup(["broken-sibling", "0"]),
  ["broken-sibling", "0"], "client preserves the server's payload-free corrupt-target tuple");
assert.equal(parseServerQuarantinedSinglePlayerCloudBackup(["broken-sibling", "0", "extra"]), null,
  "server quarantine tuples reject extra fields");
const quarantineStorage = new MemoryStorage();
const beforeQuarantinedRestore = new Map(quarantineStorage.values);
assert.deepEqual(restoreSinglePlayerCloudBackup(quarantineStorage, garbageWire), {
  ok: false, reason: "backup_quarantined", mutationStarted: false,
});
assert.deepEqual(quarantineStorage.values, beforeQuarantinedRestore,
  "quarantined restore rejection mutates no registry or world namespace key");

class ReadbackDriftStorage extends MemoryStorage {
  private reads = 0;
  private readonly target: string;
  constructor(source: MemoryStorage, target: string) {
    super();
    this.target = target;
    for (const [key, value] of source.values) this.values.set(key, value);
  }
  override getItem(key: string): string | null {
    const value = super.getItem(key);
    if (key !== this.target || value === null) return value;
    this.reads += 1;
    return this.reads >= 2 ? `${value} ` : value;
  }
}
if (loaded.status !== "loaded" && loaded.status !== "recovered") throw new Error("loaded fixture lost its slot");
const driftKey = singlePlayerWorldStorageKey(worldId,
  loaded.slot === "a" ? SINGLEPLAYER_SAVE_SLOT_A_KEY : SINGLEPLAYER_SAVE_SLOT_B_KEY);
assert.deepEqual(prepareSinglePlayerCloudBackup(new ReadbackDriftStorage(storage, driftKey), restored.world, "0"), {
  ok: false, reason: "readback_drift",
}, "upload aborts when the selected journal slot changes between its exact rereads");

class AlternateSlotCommitStorage extends MemoryStorage {
  private reads = 0;
  constructor(source: MemoryStorage, privateTarget: string, privateAlternate: string,
    privateHead: string, privateRaw: string, privateSequence: number) {
    super();
    this.target = privateTarget;
    this.alternate = privateAlternate;
    this.head = privateHead;
    this.raw = privateRaw;
    this.sequence = privateSequence;
    for (const [key, value] of source.values) this.values.set(key, value);
  }
  private readonly target: string;
  private readonly alternate: string;
  private readonly head: string;
  private readonly raw: string;
  private readonly sequence: number;
  override getItem(key: string): string | null {
    const value = super.getItem(key);
    if (key === this.target && ++this.reads === 2) {
      this.values.set(this.alternate, this.raw);
      this.values.set(this.head, JSON.stringify({ sequence: this.sequence, slot: this.alternate.endsWith(".a") ? "a" : "b" }));
    }
    return value;
  }
}
const nextSave = serializeSinglePlayerSave(snapshot, loaded.sequence + 1, loaded.savedAt + 1);
assert.equal(nextSave.ok, true);
if (!nextSave.ok) throw new Error("alternate autosave fixture failed");
const alternateKey = singlePlayerWorldStorageKey(worldId,
  loaded.slot === "a" ? SINGLEPLAYER_SAVE_SLOT_B_KEY : SINGLEPLAYER_SAVE_SLOT_A_KEY);
const headKey = singlePlayerWorldStorageKey(worldId, SINGLEPLAYER_SAVE_HEAD_KEY);
assert.deepEqual(prepareSinglePlayerCloudBackup(new AlternateSlotCommitStorage(storage, driftKey, alternateKey,
  headKey, nextSave.raw, loaded.sequence + 1), restored.world, "0"), {
  ok: false, reason: "readback_drift",
}, "a newly committed higher-sequence alternate slot prevents stale cloud overwrite");
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
const cloudSource = readFileSync(new URL("../shared/singlePlayerCloudBackups.ts", import.meta.url), "utf8");
const cloudQuery = serverSource.slice(serverSource.indexOf("singlePlayerCloudBackups: query"),
  serverSource.indexOf("mutations:", serverSource.indexOf("singlePlayerCloudBackups: query")));
assert.match(serverSource, /\.index\("by_cleanup", \["activeBackup", "cleanupAfter"\]\)/,
  "dormant budgets use an explicit eligibility index instead of a starvation-prone creation prefix");
assert.match(serverSource, /q\.eq\(BS\.activeBackup, "0"\)[\s\S]*?\.lt\(BS\.cleanupAfter/,
  "cleanup selects only eligible dormant rows");
assert.match(serverSource, /singlePlayerCloudBackupParts: table\(\{[\s\S]*?part: string\(\),[\s\S]*?data: string\(\),[\s\S]*?\.index\(BS\.byUser, \["userId"\]\)/,
  "one owner-indexed parts table is the complete cloud backup storage surface");
assert.doesNotMatch(serverSource, /ctx\.db\.singlePlayerCloudBackup(?:Chunks|s)\b/,
  "legacy split manifest/chunk tables have no remaining runtime path");
assert.match(cloudSource, /parts\.some\(\(part, index\) => part\.part !== String\(index\)\)/,
  "the shared loader rejects missing, duplicate, or orphan part topology");
assert.match(cloudSource, /candidate\[1\]\[10\]\.some\(\(chunk, index\) => chunk !== parts\[index \+ 1\]\.data\)/,
  "the shared loader recomputes exact chunk boundaries and contents before quota arithmetic");
assert.match(serverSource, /singlePlayerCloudTombstoneHeader\(tombstone\)[\s\S]*?partValue\(worldId, "0", tombstoneHeader\)[\s\S]*?cloudQuota\.update/,
  "permanent deletion retains a durable cloud fence and its bounded owner accounting");
assert.match(serverSource, /userId\.length > 520/,
  "the server accepts the exact provider-prefixed maximum identity but rejects unbounded auth state");
assert.match(serverSource, /row\[BS\.userId\] === userId && \(!deleting \|\| current \|\| currentTombstone\)/,
  "cleanup cannot remove the caller budget while an active backup or tombstone owns it");
assert.match(serverSource, /validUtcCloudBackupDay\(row\[BS\.dayKey\]\)[\s\S]*?Date\.parse\(`\$\{row\[BS\.dayKey\]\}T00:00:00Z`\)[\s\S]*?validUtcCloudBackupDay\(quotaState!\[1\]\)/,
  "budget day/timestamp pairs and quota day keys require canonical real UTC dates before mutation");
const cloudMutation = serverSource.slice(serverSource.indexOf("mutateSinglePlayerCloudBackup"), serverSource.indexOf("growOakTree"));
assert.equal(singlePlayerCloudUnsigned("001", 0, 120, 3), true,
  "zero-padded persisted quota counters remain valid stored state");
assert.match(cloudMutation, /\[BS\.acceptedToday\]: exactAccounting \? quotaState!\[2\][\s\S]*?\[BS\.lastAcceptedAt\]: exactAccounting \? quotaState!\[3\]/,
  "exact recovery accounting preserves valid persisted quota strings byte-for-byte");
assert.match(cloudMutation, /singlePlayerCloudBackupParts: cloudParts,[\s\S]*?singlePlayerCloudBackupBudgets: cloudBudgets,[\s\S]*?singlePlayerCloudBackupQuota: cloudQuota \} = ctx\.db/,
  "compact table handles remain bound to the exact cloud tables");
const undercountGuard = cloudMutation.indexOf("!recoveringDelete && quota");
const destructiveDelete = cloudMutation.indexOf("await deleteParts(currentParts)");
assert.ok(undercountGuard >= 0 && undercountGuard < cloudMutation.indexOf("if (deleting)") && undercountGuard < destructiveDelete,
  "strict full-current quota validation remains before commit and dedupe paths");
assert.match(cloudMutation, /const nextQuota = nextQuotaValue\(nextActiveStateBytes,[\s\S]*?if \(!nextQuota\) return invalid\(\);[\s\S]*?deleteParts\(currentParts\)/,
  "delete and replacement validate quota state before destructive writes, including tombstone replacement accounting");
assert.match(cloudMutation, /accountFence \|\| accountFenceRows \|\| !deleting && \(!allHealthy/,
  "commits refuse any bounded-unhealthy current owner state while deletes classify one target independently");
assert.match(cloudMutation, /accountFenceRows = Boolean\(inventory\[0\][\s\S]*?inventory\[1\]\.some[\s\S]*?SINGLE_PLAYER_CLOUD_ACCOUNT_FENCE_WORLD/,
  "even a malformed account-fence row blocks target deletion until owner-scoped account repair");
assert.doesNotMatch(cloudMutation, /deleting && reconstructed\.some/,
  "one malformed sibling cannot block owner-scoped sequential deletion of another malformed target");
assert.match(serverSource, /descriptors\.push\(\[3, world\[0\], "0"\]\)/,
  "query surfaces bounded unreconstructable worlds without exposing payload bytes");
assert.match(cloudQuery, /q\.eq\(BS\.userId, ctx\.auth\.userId\)[\s\S]*?const repair = async[\s\S]*?quota\.length === 1[\s\S]*?if \(world\[0\] === SINGLE_PLAYER_CLOUD_ACCOUNT_FENCE_WORLD\) return repair\(\);[\s\S]*?descriptors\.push/,
  "an owner-scoped malformed fence returns account repair with the current exposed quota revision before any invalid descriptor");
assert.match(cloudQuery, /singlePlayerCloudUnsigned\(quota\[0\]\[BS\.revision\][\s\S]*?String\(Number\(quota\[0\]\[BS\.revision\]\)\)/,
  "account repair exposes a canonical revision even when valid legacy quota storage is zero-padded");
assert.match(serverSource, /Number\(manifest\[10\]\) > serverNow[\s\S]*?descriptors\.push\(\[3, world\[0\], manifest\?\.\[9\] \?\? "0"\]\)/,
  "future upload metadata is quarantined with its healthy transport revision instead of presented as valid");
assert.match(serverSource, /inventory\[2\] > SINGLE_PLAYER_CLOUD_BACKUP_MAX_USER_STATE_BYTES/,
  "query rejects a multi-world aggregate that exceeds the owner storage cap");
assert.match(cloudMutation, /const proposedRevision = nextSinglePlayerCloudGeneration\(quotaRevision\)[\s\S]*?const proposedHeader = singlePlayerCloudBackupHeader/,
  "the global successor is validated before header byte accounting");
assert.match(cloudMutation, /proposedRevision, string\(serverNow\)\]\);[\s\S]*?decideSinglePlayerCloudBackupCommit\([\s\S]*?proposedRevision, serverNow\)/,
  "one canonical global generation flows through quota, header, decision, persistence, wire, and response");
assert.match(cloudMutation, /healthyBackups\.some\(\(\[manifest\]\) => number\(manifest\[9\]\) > quotaRevision\)/,
  "a healthy manifest ahead of the permanent global quota generation fails closed");
assert.match(cloudMutation, /tombstones\.some\(\(tombstone\) => number\(tombstone\[1\]\) > quotaRevision\)/,
  "a durable tombstone ahead of the permanent global quota generation fails closed");
assert.match(cloudMutation, /currentTombstone\[2\] === expectedRevision[\s\S]*?currentTombstone\[4\] === deleting\[3\]/,
  "permanent delete retries require the exact predecessor and operation id");
assert.match(cloudMutation, /tombstones\.length >= SINGLE_PLAYER_CLOUD_BACKUP_MAX_WORLDS[\s\S]*?response\(3, "tombstone_capacity"\)/,
  "the bounded resurrection-fence policy has a distinct permanent capacity response");
assert.match(cloudMutation, /parseSinglePlayerCloudDispositionRequest[\s\S]*?SINGLE_PLAYER_CLOUD_ACCOUNT_FENCE_WORLD/,
  "malformed-owner recovery is fenced by an explicit account disposition generation");
assert.match(cloudMutation, /if \(!validBudget\(row\)[\s\S]*?continue;[\s\S]*?if \(ownerBackup\.length !== 0\) continue;/,
  "malformed or active cross-owner cleanup candidates are isolated instead of failing the caller");
assert.doesNotMatch(cloudMutation, /String\(Number\(current\?\.\[9\] \?\? "0"\) \+ 1\)/,
  "server manifests never mint a reusable per-world successor");
assert.equal((cloudMutation.match(/cloudQuota\.delete/g) ?? []).length, 1,
  "only bounded account disposition may merge duplicate global quota rows");
assert.match(cloudMutation, /if \(disposition\)[\s\S]*?for \(const row of quotaRows\) await cloudQuota\.delete/,
  "account disposition deterministically canonicalizes only the selected bounded quota rows");
assert.match(cloudMutation, /const cleanupCandidates =[\s\S]*?if \(userBudgetRows\.length > 1/,
  "ordinary mutations retain strict bookkeeping rejection after the recovery-only branch");
assert.match(cloudMutation, /const fenceRevision =[\s\S]*?disposition\[0\] === 3 \? disposition\[1\] !== fenceRevision[\s\S]*?Math\.max\(number\(disposition\[1\]\), \.\.\.quotaRows\.map/,
  "Resume CASes the exact owner fence while minting from the current global head");
const repairRevisionMatches = (expected: string, rows: string[]) => {
  const exposed = rows.length === 1 && singlePlayerCloudUnsigned(rows[0], 0, Number.MAX_SAFE_INTEGER)
    ? String(Number(rows[0])) : "0";
  return expected === exposed || rows.some((row) => singlePlayerCloudUnsigned(row, 0, Number.MAX_SAFE_INTEGER)
    && Number(row) === Number(expected));
};
assert.equal(repairRevisionMatches("1", ["0001"]), true,
  "canonical account repair accepts the numerically identical legacy quota revision");
assert.equal(repairRevisionMatches("2", ["0001"]), false,
  "canonical account repair still rejects a different quota generation");
assert.equal("1" === "0001", false,
  "Resume continues to require the exact canonical owner-fence revision");
assert.match(cloudMutation, /singlePlayerCloudUnsigned\(row\[BS\.revision\][\s\S]*?number\(row\[BS\.revision\]\) === number\(disposition\[1\]\)/,
  "account repair compares valid persisted quota revisions numerically after parsing the canonical request");
assert.match(cloudMutation, /quotaActive < SINGLE_PLAYER_CLOUD_BACKUP_MAX_GLOBAL_STATE_BYTES[\s\S]*?: SINGLE_PLAYER_CLOUD_BACKUP_MAX_GLOBAL_STATE_BYTES/,
  "uncertain recovery accounting saturates at the global cap instead of undercharging retained rows");
assert.match(cloudMutation, /if \(decision\[1\] === BS\.deduped\) \{[\s\S]*?applyCleanupQuota\(minimumStateBytes\)[\s\S]*?response\(1, decision\[2\]\[9\]\)/,
  "plain dedupe retains the quota generation while cleanup dedupe advances it exactly once");
assert.doesNotMatch(cloudSource, /String\(currentRevision \+ 1\)/,
  "shared admission consumes an explicit opaque generation instead of deriving a per-world revision");

console.log("single-player cloud backup protocol and explicit restore foundation tests passed");
