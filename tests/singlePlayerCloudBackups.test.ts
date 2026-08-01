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
  SINGLE_PLAYER_CLOUD_BACKUP_QUOTA_STATE_BYTES,
  SINGLE_PLAYER_CLOUD_BACKUP_USER_DAILY_WRITES,
  candidateMatchesManifest,
  cloudBackupHash,
  cloudBackupStoredChunkBytes,
  cloudBackupStoredPartBytes,
  cloudBackupUtf8Bytes,
  decideSinglePlayerCloudBackupCommit,
  decideSinglePlayerCloudBackupDeleteRevision,
  inventorySinglePlayerCloudBackupParts,
  loadSinglePlayerCloudBackupParts,
  nextSinglePlayerCloudGeneration,
  parseSinglePlayerCloudBackupCommitRequest,
  parseSinglePlayerCloudBackupDeleteRequest,
  parseSinglePlayerCloudBackupWire,
  splitSinglePlayerCloudBackupSnapshot,
  singlePlayerCloudBackupHeader,
  singlePlayerCloudBackupDeleteActiveState,
  singlePlayerCloudBackupWire,
  singlePlayerCloudBudgetCleanupAfter,
  utcCloudBackupDay,
  validUtcCloudBackupDay,
  validStoredSinglePlayerCloudBackupManifest,
  validSinglePlayerCloudQuotaState,
  type SinglePlayerCloudBackupCandidate,
  type StoredSinglePlayerCloudBackupPart,
  type StoredSinglePlayerCloudBackupManifest,
} from "../shared/singlePlayerCloudBackups.ts";
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
}
assert.notEqual(cloudBackupHash("😀"), oldUtf8Hash("😀"), "the former UTF-8-byte hash is not accepted as the new integrity hash");
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
assert.equal(parseSinglePlayerCloudBackupCommitRequest(invalidWorldRequest).ok, true,
  "server admission deliberately does not classify opaque local-world semantics");
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
assert.equal(parseSinglePlayerSaveEnvelope(prepared.backup[1], worldId).ok, true);
assert.equal(prepared.backup[2], loaded.sequence);

const validWire = singlePlayerCloudBackupWire(manifest, candidate.snapshotJson);
assert.equal(parseSinglePlayerCloudBackupWire(validWire).ok, true);
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
assert.match(serverSource, /\.index\("by_cleanup", \["activeBackup", "cleanupAfter"\]\)/,
  "dormant budgets use an explicit eligibility index instead of a starvation-prone creation prefix");
assert.match(serverSource, /q\.eq\("activeBackup", "0"\)[\s\S]*?\.lt\("cleanupAfter"/,
  "cleanup selects only eligible dormant rows");
assert.match(serverSource, /singlePlayerCloudBackupParts: table\(\{[\s\S]*?part: string\(\),[\s\S]*?data: string\(\),[\s\S]*?\.index\(BS\.byUser, \["userId"\]\)/,
  "one owner-indexed parts table is the complete cloud backup storage surface");
assert.doesNotMatch(serverSource, /ctx\.db\.singlePlayerCloudBackup(?:Chunks|s)\b/,
  "legacy split manifest/chunk tables have no remaining runtime path");
assert.match(cloudSource, /parts\.some\(\(part, index\) => part\.part !== String\(index\)\)/,
  "the shared loader rejects missing, duplicate, or orphan part topology");
assert.match(cloudSource, /candidate\.candidate\.chunks\.some\(\(chunk, index\) => chunk !== parts\[index \+ 1\]\.data\)/,
  "the shared loader recomputes exact chunk boundaries and contents before quota arithmetic");
assert.match(serverSource, /activeBackup: "0", cleanupAfter:/,
  "last-world permanent deletion retains cadence state only until its indexed cleanup deadline");
assert.match(serverSource, /userId\.length > 520/,
  "the server accepts the exact provider-prefixed maximum identity but rejects unbounded auth state");
assert.match(serverSource, /row\.userId === userId && \(!deleting \|\| current\)/,
  "an eligible dormant caller budget is reclaimed by its own repeated permanent-delete traffic");
assert.match(serverSource, /singlePlayerCloudBudgetCleanupAfter\(row\.dayKey, Number\(row\.lastAcceptedAt\)\)[\s\S]*?validUtcCloudBackupDay\(quota\.dayKey\)/,
  "budget day/timestamp pairs and quota day keys require canonical real UTC dates before mutation");
const cloudMutation = serverSource.slice(serverSource.indexOf("mutateSinglePlayerCloudBackup"), serverSource.indexOf("growOakTree"));
const undercountGuard = cloudMutation.indexOf("!recoveringDelete && quota");
const destructiveDelete = cloudMutation.indexOf("for (const row of currentParts) await ctx.db.singlePlayerCloudBackupParts.delete");
assert.ok(undercountGuard >= 0 && undercountGuard < cloudMutation.indexOf("if (deleting)") && undercountGuard < destructiveDelete,
  "strict full-current quota validation remains before commit and dedupe paths");
assert.match(cloudMutation, /const remainingMinimum = [\s\S]*?singlePlayerCloudBackupDeleteActiveState\(globalStateBytes,[\s\S]*?if \(nextActiveStateBytes === null\)[\s\S]*?if \(!nextQuota\)[\s\S]*?for \(const row of currentParts\)/,
  "corrupt delete validates the post-delete remainder and releases only quota-covered target bytes before mutation");
assert.match(cloudMutation, /if \(!deleting && \(!allHealthy/,
  "commits refuse any bounded-unhealthy current owner state while deletes classify one target independently");
assert.match(serverSource, /quarantined\.push\(\[world\.worldId, "0"\]\)/,
  "query surfaces bounded unreconstructable worlds with the explicit permanent-delete sentinel");
assert.match(serverSource, /Number\(manifest\.uploadedAt\) > serverNow[\s\S]*?quarantined\.push\(\[world\.worldId, manifest\.revision\]\)/,
  "future upload metadata is quarantined with its healthy transport revision instead of presented as valid");
assert.match(serverSource, /inventory\.stateBytes > SINGLE_PLAYER_CLOUD_BACKUP_MAX_USER_STATE_BYTES/,
  "query rejects a multi-world aggregate that exceeds the owner storage cap");
assert.match(cloudMutation, /const nextQuota = nextQuotaValue[\s\S]*?if \(!nextQuota\) return \[5, BS\.invalidServerState, serverNow\][\s\S]*?await applyCleanup\(\)/,
  "deduped cleanup validates its complete next quota before deleting a budget");
assert.match(cloudMutation, /const nextQuota = nextQuotaValue\(nextActiveStateBytes,[\s\S]*?if \(!nextQuota\) return \[5, BS\.invalidServerState, serverNow\][\s\S]*?for \(const row of currentParts\)/,
  "write replacement validates next quota bytes/revision before replacing parts");
assert.match(cloudMutation, /const proposedRevision = nextSinglePlayerCloudGeneration\(quotaRevision\)[\s\S]*?const proposedHeader = singlePlayerCloudBackupHeader/,
  "the global successor is validated before header byte accounting");
assert.match(cloudMutation, /revision: proposedRevision[\s\S]*?decideSinglePlayerCloudBackupCommit\([\s\S]*?proposedRevision, serverNow\)/,
  "one canonical global generation flows through quota, header, decision, persistence, wire, and response");
assert.match(cloudMutation, /healthyBackups\.some\(\(\{ manifest \}\) => Number\(manifest\.revision\) > quotaRevision\)/,
  "a healthy manifest ahead of the permanent global quota generation fails closed");
assert.doesNotMatch(cloudMutation, /String\(Number\(current\?\.revision \?\? "0"\) \+ 1\)/,
  "server manifests never mint a reusable per-world successor");
assert.doesNotMatch(cloudMutation, /singlePlayerCloudBackupQuota\.delete/,
  "the global generation row is permanent after creation");
assert.match(cloudMutation, /if \(decision\.kind === "deduped"\) \{[\s\S]*?if \(cleanupRows\.length && quota\)[\s\S]*?update\(quota\.id, nextQuota\)[\s\S]*?return \[1, decision\.manifest\.revision, serverNow\]/,
  "plain dedupe retains the quota generation while cleanup dedupe advances it exactly once");
assert.doesNotMatch(cloudSource, /revision: String\(currentRevision \+ 1\)/,
  "shared admission consumes an explicit opaque generation instead of deriving a per-world revision");

console.log("single-player cloud backup protocol and explicit restore foundation tests passed");
