export const SINGLE_PLAYER_CLOUD_BACKUP_VERSION = 1 as const;
export const SINGLE_PLAYER_CLOUD_BACKUP_MAX_WORLDS = 6;
export const SINGLE_PLAYER_CLOUD_BACKUP_MAX_SNAPSHOT_CHARS = 150_000;
export const SINGLE_PLAYER_CLOUD_BACKUP_CHUNK_BYTES = 48_000;
export const SINGLE_PLAYER_CLOUD_BACKUP_MAX_CHUNKS = 4;
export const SINGLE_PLAYER_CLOUD_BACKUP_MAX_USER_STATE_BYTES = 192_000;
export const SINGLE_PLAYER_CLOUD_BACKUP_MAX_GLOBAL_STATE_BYTES = 384_000;
export const SINGLE_PLAYER_CLOUD_BACKUP_MIN_USER_UPLOAD_MS = 30 * 60_000;
export const SINGLE_PLAYER_CLOUD_BACKUP_USER_DAILY_WRITES = 12;
export const SINGLE_PLAYER_CLOUD_BACKUP_GLOBAL_DAILY_WRITES = 120;

const MAX_TIMESTAMP = 8_640_000_000_000_000;
const WORLD_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const HASH = /^[0-9a-f]{8}$/;
const REVISION = /^(?:0|[1-9][0-9]{0,15})$/;

export type SinglePlayerCloudBackupCommitRequest = readonly [
  version: typeof SINGLE_PLAYER_CLOUD_BACKUP_VERSION,
  worldId: string,
  name: string,
  seed: number,
  gameMode: "survival" | "creative",
  worldCreatedAt: number,
  expectedRevision: string,
  snapshotJson: string,
];

export type SinglePlayerCloudBackupDeleteRequest = readonly [
  version: typeof SINGLE_PLAYER_CLOUD_BACKUP_VERSION,
  worldId: string,
  expectedRevision: string,
];

export type SinglePlayerCloudBackupWire = readonly [
  version: typeof SINGLE_PLAYER_CLOUD_BACKUP_VERSION,
  worldId: string,
  name: string,
  seed: string,
  gameMode: "survival" | "creative",
  worldCreatedAt: string,
  snapshotHash: string,
  snapshotJson: string,
  revision: string,
  uploadedAt: string,
];

export interface SinglePlayerCloudBackupCandidate {
  worldId: string;
  name: string;
  seed: number;
  gameMode: "survival" | "creative";
  worldCreatedAt: number;
  expectedRevision: string;
  snapshotHash: string;
  snapshotJson: string;
  snapshotChars: number;
  snapshotUtf8Bytes: number;
  stateBytes: number;
  uploadId: string;
  chunks: string[];
}

export interface StoredSinglePlayerCloudBackupManifest {
  worldId: string;
  name: string;
  seed: string;
  gameMode: string;
  worldCreatedAt: string;
  snapshotHash: string;
  snapshotChars: string;
  snapshotUtf8Bytes: string;
  stateBytes: string;
  chunkCount: string;
  uploadId: string;
  revision: string;
  uploadedAt: string;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function integer(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function validName(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 48
    && value === value.trim().replace(/\s+/g, " ") && !/[\u0000-\u001f\u007f]/.test(value);
}

export function cloudBackupUtf8Bytes(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length
      && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
  }
  return bytes;
}

export function cloudBackupStoredChunkBytes(value: string): number {
  return cloudBackupUtf8Bytes(JSON.stringify(value)) + 768;
}

export function splitSinglePlayerCloudBackupSnapshot(value: string): string[] | null {
  if (value.length < 1 || value.length > SINGLE_PLAYER_CLOUD_BACKUP_MAX_SNAPSHOT_CHARS) return null;
  const chunks: string[] = [];
  let start = 0;
  let bytes = 0;
  for (let index = 0; index < value.length;) {
    const code = value.charCodeAt(index);
    const width = code < 0x80 ? 1 : code < 0x800 ? 2
      : code >= 0xd800 && code <= 0xdbff && index + 1 < value.length
        && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff ? 4 : 3;
    const chars = width === 4 ? 2 : 1;
    if (bytes + width > SINGLE_PLAYER_CLOUD_BACKUP_CHUNK_BYTES) {
      chunks.push(value.slice(start, index));
      start = index;
      bytes = 0;
    }
    bytes += width;
    index += chars;
  }
  chunks.push(value.slice(start));
  return chunks.length <= SINGLE_PLAYER_CLOUD_BACKUP_MAX_CHUNKS ? chunks : null;
}

export function canonicalCloudBackupJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalCloudBackupJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalCloudBackupJson(object[key])}`).join(",")}}`;
}

export function cloudBackupHash(value: unknown): string {
  const text = typeof value === "string" ? value : canonicalCloudBackupJson(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function parseEnvelope(
  worldId: string,
  seed: number,
  gameMode: "survival" | "creative",
  worldCreatedAt: number,
  snapshotJson: string,
): { hash: string; checksum: string } | null {
  let envelope: unknown;
  try { envelope = JSON.parse(snapshotJson); } catch { return null; }
  if (!record(envelope) || !exact(envelope, ["checksum", "format", "payload", "savedAt", "sequence", "version"])
    || envelope.format !== "lakecraft.singleplayer" || envelope.version !== 1
    || typeof envelope.checksum !== "string" || !HASH.test(envelope.checksum)
    || !integer(envelope.savedAt, 0, MAX_TIMESTAMP) || !integer(envelope.sequence, 1, Number.MAX_SAFE_INTEGER)
    || !record(envelope.payload) || !record(envelope.payload.world)
    || envelope.payload.world.worldId !== worldId || envelope.payload.world.seed !== seed
    || envelope.payload.world.createdAt !== worldCreatedAt
    || (envelope.payload.world.gameMode !== undefined && envelope.payload.world.gameMode !== gameMode)) return null;
  const body = { format: envelope.format, payload: envelope.payload, savedAt: envelope.savedAt,
    sequence: envelope.sequence, version: envelope.version };
  return canonicalCloudBackupJson(envelope) === snapshotJson && cloudBackupHash(body) === envelope.checksum
    ? { hash: cloudBackupHash(envelope.payload), checksum: envelope.checksum } : null;
}

export function parseSinglePlayerCloudBackupCommitRequest(raw: string):
  | { ok: true; candidate: SinglePlayerCloudBackupCandidate }
  | { ok: false; reason: "cloud_capacity" | "invalid_request" | "invalid_snapshot" } {
  if (typeof raw !== "string" || raw.length < 2 || raw.length > SINGLE_PLAYER_CLOUD_BACKUP_MAX_SNAPSHOT_CHARS * 2 + 1_024) {
    return { ok: false, reason: "invalid_request" };
  }
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return { ok: false, reason: "invalid_request" }; }
  if (!Array.isArray(value) || value.length !== 8 || value[0] !== 1
    || typeof value[1] !== "string" || !WORLD_ID.test(value[1]) || !validName(value[2])
    || !integer(value[3], -2_147_483_648, 2_147_483_647)
    || (value[4] !== "survival" && value[4] !== "creative") || !integer(value[5], 0, MAX_TIMESTAMP)
    || typeof value[6] !== "string" || !REVISION.test(value[6]) || Number(value[6]) > Number.MAX_SAFE_INTEGER
    || typeof value[7] !== "string") return { ok: false, reason: "invalid_request" };
  const chunks = splitSinglePlayerCloudBackupSnapshot(value[7]);
  if (!chunks) return { ok: false, reason: "cloud_capacity" };
  const snapshotUtf8Bytes = cloudBackupUtf8Bytes(value[7]);
  const stateBytes = chunks.reduce((sum, chunk) => sum + cloudBackupStoredChunkBytes(chunk), 1_024);
  if (stateBytes > SINGLE_PLAYER_CLOUD_BACKUP_MAX_USER_STATE_BYTES) return { ok: false, reason: "cloud_capacity" };
  const parsed = parseEnvelope(value[1], value[3], value[4], value[5], value[7]);
  if (!parsed) return { ok: false, reason: "invalid_snapshot" };
  return { ok: true, candidate: {
    worldId: value[1], name: value[2], seed: value[3], gameMode: value[4], worldCreatedAt: value[5],
    expectedRevision: value[6], snapshotHash: parsed.hash, snapshotJson: value[7],
    snapshotChars: value[7].length, snapshotUtf8Bytes, stateBytes,
    uploadId: `${parsed.hash}-${parsed.checksum}-${snapshotUtf8Bytes.toString(36)}`, chunks,
  } };
}

export function parseSinglePlayerCloudBackupDeleteRequest(raw: string): SinglePlayerCloudBackupDeleteRequest | null {
  if (typeof raw !== "string" || raw.length > 192) return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  return Array.isArray(value) && value.length === 3 && value[0] === 1
    && typeof value[1] === "string" && WORLD_ID.test(value[1])
    && typeof value[2] === "string" && REVISION.test(value[2]) && Number(value[2]) <= Number.MAX_SAFE_INTEGER
    ? value as unknown as SinglePlayerCloudBackupDeleteRequest : null;
}

export function candidateMatchesManifest(candidate: SinglePlayerCloudBackupCandidate, manifest: StoredSinglePlayerCloudBackupManifest): boolean {
  return candidate.worldId === manifest.worldId && candidate.name === manifest.name && String(candidate.seed) === manifest.seed
    && candidate.gameMode === manifest.gameMode && String(candidate.worldCreatedAt) === manifest.worldCreatedAt
    && candidate.snapshotHash === manifest.snapshotHash && String(candidate.snapshotChars) === manifest.snapshotChars
    && String(candidate.snapshotUtf8Bytes) === manifest.snapshotUtf8Bytes && String(candidate.stateBytes) === manifest.stateBytes
    && String(candidate.chunks.length) === manifest.chunkCount && candidate.uploadId === manifest.uploadId;
}

export function decideSinglePlayerCloudBackupCommit(
  current: StoredSinglePlayerCloudBackupManifest | null,
  currentSnapshotJson: string | null,
  candidate: SinglePlayerCloudBackupCandidate,
  userWorldCount: number,
  userStateBytes: number,
  globalStateBytes: number,
  userLastAcceptedAt: number,
  userAcceptedToday: number,
  globalAcceptedToday: number,
  now: number,
): { ok: true; kind: "deduped" | "write"; manifest: StoredSinglePlayerCloudBackupManifest }
  | { ok: false; reason: "cadence" | "cloud_capacity" | "conflict" | "server_state" | "world_limit"; retryAfterMs?: number } {
  if (!integer(userWorldCount, 0, SINGLE_PLAYER_CLOUD_BACKUP_MAX_WORLDS + 1)
    || !integer(userStateBytes, 0, SINGLE_PLAYER_CLOUD_BACKUP_MAX_GLOBAL_STATE_BYTES)
    || !integer(globalStateBytes, 0, SINGLE_PLAYER_CLOUD_BACKUP_MAX_GLOBAL_STATE_BYTES)
    || !integer(userLastAcceptedAt, 0, MAX_TIMESTAMP) || !integer(userAcceptedToday, 0, SINGLE_PLAYER_CLOUD_BACKUP_USER_DAILY_WRITES)
    || !integer(globalAcceptedToday, 0, SINGLE_PLAYER_CLOUD_BACKUP_GLOBAL_DAILY_WRITES)
    || !integer(now, 0, MAX_TIMESTAMP)) return { ok: false, reason: "server_state" };
  if (current && currentSnapshotJson === candidate.snapshotJson && candidateMatchesManifest(candidate, current)) {
    return { ok: true, kind: "deduped", manifest: current };
  }
  if ((!current && candidate.expectedRevision !== "0") || (current && candidate.expectedRevision !== current.revision)) {
    return { ok: false, reason: "conflict" };
  }
  if (!current && userWorldCount >= SINGLE_PLAYER_CLOUD_BACKUP_MAX_WORLDS) return { ok: false, reason: "world_limit" };
  const currentRevision = current && REVISION.test(current.revision) ? Number(current.revision) : 0;
  const currentBytes = current && /^\d{1,6}$/.test(current.stateBytes) ? Number(current.stateBytes) : 0;
  if ((current && (currentRevision < 1 || currentRevision >= Number.MAX_SAFE_INTEGER))
    || userStateBytes - currentBytes + candidate.stateBytes > SINGLE_PLAYER_CLOUD_BACKUP_MAX_USER_STATE_BYTES
    || globalStateBytes - currentBytes + candidate.stateBytes > SINGLE_PLAYER_CLOUD_BACKUP_MAX_GLOBAL_STATE_BYTES) {
    return { ok: false, reason: current && currentRevision < 1 ? "server_state" : "cloud_capacity" };
  }
  const retryAfterMs = userLastAcceptedAt + SINGLE_PLAYER_CLOUD_BACKUP_MIN_USER_UPLOAD_MS - now;
  if (retryAfterMs > 0) return { ok: false, reason: "cadence", retryAfterMs };
  if (userAcceptedToday >= SINGLE_PLAYER_CLOUD_BACKUP_USER_DAILY_WRITES
    || globalAcceptedToday >= SINGLE_PLAYER_CLOUD_BACKUP_GLOBAL_DAILY_WRITES) return { ok: false, reason: "cloud_capacity" };
  return { ok: true, kind: "write", manifest: {
    worldId: candidate.worldId, name: candidate.name, seed: String(candidate.seed), gameMode: candidate.gameMode,
    worldCreatedAt: String(candidate.worldCreatedAt), snapshotHash: candidate.snapshotHash,
    snapshotChars: String(candidate.snapshotChars), snapshotUtf8Bytes: String(candidate.snapshotUtf8Bytes),
    stateBytes: String(candidate.stateBytes), chunkCount: String(candidate.chunks.length), uploadId: candidate.uploadId,
    revision: String(currentRevision + 1), uploadedAt: String(now),
  } };
}

export function utcCloudBackupDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function singlePlayerCloudBackupWire(
  manifest: StoredSinglePlayerCloudBackupManifest,
  snapshotJson: string,
): SinglePlayerCloudBackupWire {
  return [1, manifest.worldId, manifest.name, manifest.seed, manifest.gameMode as "survival" | "creative",
    manifest.worldCreatedAt, manifest.snapshotHash, snapshotJson, manifest.revision, manifest.uploadedAt];
}
