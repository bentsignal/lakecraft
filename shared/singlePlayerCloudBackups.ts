export const SINGLE_PLAYER_CLOUD_BACKUP_VERSION = 1 as const;
export const SINGLE_PLAYER_CLOUD_BACKUP_MAX_WORLDS = 6;
export const SINGLE_PLAYER_CLOUD_BACKUP_MAX_SNAPSHOT_CHARS = 150_000;
export const SINGLE_PLAYER_CLOUD_BACKUP_CHUNK_BYTES = 48_000;
export const SINGLE_PLAYER_CLOUD_BACKUP_MAX_CHUNKS = 4;
export const SINGLE_PLAYER_CLOUD_BACKUP_MAX_USER_STATE_BYTES = 192_000;
export const SINGLE_PLAYER_CLOUD_BACKUP_MAX_GLOBAL_STATE_BYTES = 384_000;
export const SINGLE_PLAYER_CLOUD_BACKUP_MANIFEST_STATE_BYTES = 4_096;
export const SINGLE_PLAYER_CLOUD_BACKUP_BUDGET_STATE_BYTES = 2_048;
export const SINGLE_PLAYER_CLOUD_BACKUP_QUOTA_STATE_BYTES = 2_048;
export const SINGLE_PLAYER_CLOUD_BACKUP_MIN_USER_UPLOAD_MS = 30 * 60_000;
export const SINGLE_PLAYER_CLOUD_BACKUP_USER_DAILY_WRITES = 12;
export const SINGLE_PLAYER_CLOUD_BACKUP_GLOBAL_DAILY_WRITES = 120;
export const SINGLE_PLAYER_CLOUD_BACKUP_HEADER_MAX_CHARS = 512;
export const SINGLE_PLAYER_CLOUD_BACKUP_HEADER_MAX_UTF8_BYTES = 1_024;

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
  snapshotUtf8Bytes: number;
  stateBytes: number;
  chunks: string[];
}

export interface StoredSinglePlayerCloudBackupManifest {
  worldId: string;
  name: string;
  seed: string;
  gameMode: string;
  worldCreatedAt: string;
  snapshotHash: string;
  snapshotUtf8Bytes: string;
  stateBytes: string;
  chunkCount: string;
  revision: string;
  uploadedAt: string;
}

export interface StoredSinglePlayerCloudBackupPart {
  userId: string;
  worldId: string;
  part: string;
  data: string;
}

export interface LoadedSinglePlayerCloudBackup<TPart extends StoredSinglePlayerCloudBackupPart> {
  manifest: StoredSinglePlayerCloudBackupManifest;
  snapshotJson: string;
  parts: TPart[];
}

export interface InventoriedSinglePlayerCloudBackup<TPart extends StoredSinglePlayerCloudBackupPart> {
  worldId: string;
  parts: TPart[];
  stateBytes: number;
}

/** Bounds every persisted string before any header parse, payload join, or integrity reconstruction. */
export function inventorySinglePlayerCloudBackupParts<TPart extends StoredSinglePlayerCloudBackupPart>(
  userId: string,
  rows: readonly TPart[],
): { ok: true; worlds: InventoriedSinglePlayerCloudBackup<TPart>[]; stateBytes: number }
  | { ok: false; reason: "server_state" } {
  if (typeof userId !== "string" || userId.length < 1 || userId.length > 520
    || rows.length > SINGLE_PLAYER_CLOUD_BACKUP_MAX_WORLDS * (SINGLE_PLAYER_CLOUD_BACKUP_MAX_CHUNKS + 1)
    || rows.some((row) => !row || typeof row !== "object" || row.userId !== userId
      || typeof row.worldId !== "string" || !WORLD_ID.test(row.worldId)
      || typeof row.part !== "string" || row.part.length < 1 || row.part.length > 8
      || typeof row.data !== "string"
      || (row.part === "0" ? row.data.length > SINGLE_PLAYER_CLOUD_BACKUP_HEADER_MAX_CHARS
        || cloudBackupUtf8Bytes(row.data) > SINGLE_PLAYER_CLOUD_BACKUP_HEADER_MAX_UTF8_BYTES
        : row.data.length < 1 || row.data.length > SINGLE_PLAYER_CLOUD_BACKUP_CHUNK_BYTES
          || cloudBackupUtf8Bytes(row.data) > SINGLE_PLAYER_CLOUD_BACKUP_CHUNK_BYTES))) {
    return { ok: false, reason: "server_state" };
  }
  const worldIds = [...new Set(rows.map((row) => row.worldId))].sort();
  if (worldIds.length > SINGLE_PLAYER_CLOUD_BACKUP_MAX_WORLDS) return { ok: false, reason: "server_state" };
  const worlds: InventoriedSinglePlayerCloudBackup<TPart>[] = [];
  let stateBytes = 0;
  for (const worldId of worldIds) {
    const parts = rows.filter((row) => row.worldId === worldId);
    const payload = parts.filter((part) => part.part !== "0");
    if (payload.reduce((sum, part) => sum + part.data.length, 0) > SINGLE_PLAYER_CLOUD_BACKUP_MAX_SNAPSHOT_CHARS
      || payload.reduce((sum, part) => sum + cloudBackupUtf8Bytes(part.data), 0)
        > SINGLE_PLAYER_CLOUD_BACKUP_CHUNK_BYTES * SINGLE_PLAYER_CLOUD_BACKUP_MAX_CHUNKS) {
      return { ok: false, reason: "server_state" };
    }
    const worldStateBytes = parts.reduce((sum, part) => sum
      + cloudBackupStoredPartBytes(userId, worldId, part.part, part.data), 0);
    stateBytes += worldStateBytes;
    if (!Number.isSafeInteger(stateBytes) || stateBytes > SINGLE_PLAYER_CLOUD_BACKUP_MAX_GLOBAL_STATE_BYTES) {
      return { ok: false, reason: "server_state" };
    }
    worlds.push({ worldId, parts, stateBytes: worldStateBytes });
  }
  return { ok: true, worlds, stateBytes };
}

export function validStoredSinglePlayerCloudBackupManifest(value: unknown): value is StoredSinglePlayerCloudBackupManifest {
  if (!record(value)) return false;
  return typeof value.worldId === "string" && WORLD_ID.test(value.worldId) && validName(value.name)
    && typeof value.seed === "string" && /^-?\d{1,10}$/.test(value.seed) && integer(Number(value.seed), -2_147_483_648, 2_147_483_647)
    && (value.gameMode === "survival" || value.gameMode === "creative")
    && typeof value.worldCreatedAt === "string" && /^\d{1,16}$/.test(value.worldCreatedAt) && integer(Number(value.worldCreatedAt), 0, MAX_TIMESTAMP)
    && typeof value.snapshotHash === "string" && HASH.test(value.snapshotHash)
    && typeof value.snapshotUtf8Bytes === "string" && /^\d{1,6}$/.test(value.snapshotUtf8Bytes) && integer(Number(value.snapshotUtf8Bytes), 1, SINGLE_PLAYER_CLOUD_BACKUP_CHUNK_BYTES * SINGLE_PLAYER_CLOUD_BACKUP_MAX_CHUNKS)
    && typeof value.stateBytes === "string" && /^\d{1,6}$/.test(value.stateBytes) && integer(Number(value.stateBytes), 1, SINGLE_PLAYER_CLOUD_BACKUP_MAX_USER_STATE_BYTES)
    && typeof value.chunkCount === "string" && /^[1-4]$/.test(value.chunkCount)
    && typeof value.revision === "string" && REVISION.test(value.revision) && integer(Number(value.revision), 1, Number.MAX_SAFE_INTEGER)
    && typeof value.uploadedAt === "string" && /^\d{1,16}$/.test(value.uploadedAt) && integer(Number(value.uploadedAt), 0, MAX_TIMESTAMP);
}

export function singlePlayerCloudBackupHeader(manifest: StoredSinglePlayerCloudBackupManifest): string {
  return JSON.stringify([1, manifest.name, manifest.seed, manifest.gameMode, manifest.worldCreatedAt,
    manifest.snapshotHash, manifest.revision, manifest.uploadedAt]);
}

export function loadSinglePlayerCloudBackupParts<TPart extends StoredSinglePlayerCloudBackupPart>(
  userId: string,
  rows: readonly TPart[],
): { ok: true; backups: LoadedSinglePlayerCloudBackup<TPart>[]; stateBytes: number }
  | { ok: false; reason: "server_state" } {
  const inventory = inventorySinglePlayerCloudBackupParts(userId, rows);
  if (!inventory.ok) return inventory;
  const backups: LoadedSinglePlayerCloudBackup<TPart>[] = [];
  let stateBytes = 0;
  for (const world of inventory.worlds) {
    const { worldId } = world;
    const parts = [...world.parts]
      .sort((left, right) => Number(left.part) - Number(right.part));
    if (parts.length < 2 || parts.length > SINGLE_PLAYER_CLOUD_BACKUP_MAX_CHUNKS + 1
      || parts.some((part, index) => part.part !== String(index))) return { ok: false, reason: "server_state" };
    let header: unknown;
    try { header = JSON.parse(parts[0].data); } catch { return { ok: false, reason: "server_state" }; }
    if (!Array.isArray(header) || header.length !== 8 || header[0] !== 1 || !validName(header[1])
      || typeof header[2] !== "string" || !/^-?\d{1,10}$/.test(header[2]) || String(Number(header[2])) !== header[2]
      || !integer(Number(header[2]), -2_147_483_648, 2_147_483_647)
      || (header[3] !== "survival" && header[3] !== "creative")
      || typeof header[4] !== "string" || !/^\d{1,16}$/.test(header[4]) || String(Number(header[4])) !== header[4]
      || !integer(Number(header[4]), 0, MAX_TIMESTAMP)
      || typeof header[5] !== "string" || !HASH.test(header[5])
      || typeof header[6] !== "string" || !REVISION.test(header[6]) || !integer(Number(header[6]), 1, Number.MAX_SAFE_INTEGER)
      || typeof header[7] !== "string" || !/^\d{1,16}$/.test(header[7]) || String(Number(header[7])) !== header[7]
      || !integer(Number(header[7]), 0, MAX_TIMESTAMP)
      || parts[0].data !== JSON.stringify(header)) return { ok: false, reason: "server_state" };
    const snapshotJson = parts.slice(1).map((part) => part.data).join("");
    const candidate = parseSinglePlayerCloudBackupCommitRequest(JSON.stringify([1, worldId, header[1],
      Number(header[2]), header[3], Number(header[4]), String(Number(header[6]) - 1), snapshotJson]));
    if (!candidate.ok || candidate.candidate.snapshotHash !== header[5]
      || candidate.candidate.chunks.length !== parts.length - 1
      || candidate.candidate.chunks.some((chunk, index) => chunk !== parts[index + 1].data)) {
      return { ok: false, reason: "server_state" };
    }
    const manifest: StoredSinglePlayerCloudBackupManifest = {
      worldId, name: header[1], seed: header[2], gameMode: header[3], worldCreatedAt: header[4], snapshotHash: header[5],
      snapshotUtf8Bytes: String(candidate.candidate.snapshotUtf8Bytes), stateBytes: String(world.stateBytes),
      chunkCount: String(candidate.candidate.chunks.length), revision: header[6], uploadedAt: header[7],
    };
    stateBytes += world.stateBytes;
    if (stateBytes > SINGLE_PLAYER_CLOUD_BACKUP_MAX_USER_STATE_BYTES) return { ok: false, reason: "server_state" };
    backups.push({ manifest, snapshotJson, parts });
  }
  return { ok: true, backups, stateBytes };
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

export function cloudBackupStoredPartBytes(userId: string, worldId: string, part: string, data: string): number {
  return cloudBackupUtf8Bytes(JSON.stringify({ userId, worldId, part, data })) + 1_024;
}

/** Worst-case admission estimate; authenticated server accounting always uses the exact row values. */
export function cloudBackupStoredChunkBytes(value: string): number {
  return cloudBackupStoredPartBytes("\u0000".repeat(520), "w".repeat(64), "4", value);
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

export function cloudBackupHash(text: string): string {
  let hash = 0x811c9dc5;
  const add = (byte: number) => { hash = Math.imul(hash ^ byte, 0x01000193); };
  for (let index = 0; index < text.length; index += 1) {
    let code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
      const low = text.charCodeAt(index + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + low - 0xdc00;
        index += 1;
      } else code = 0xfffd;
    } else if (code >= 0xd800 && code <= 0xdfff) code = 0xfffd;
    if (code < 0x80) add(code);
    else if (code < 0x800) { add(0xc0 | code >> 6); add(0x80 | code & 63); }
    else if (code < 0x10000) { add(0xe0 | code >> 12); add(0x80 | code >> 6 & 63); add(0x80 | code & 63); }
    else { add(0xf0 | code >> 18); add(0x80 | code >> 12 & 63); add(0x80 | code >> 6 & 63); add(0x80 | code & 63); }
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function parseSinglePlayerCloudBackupWire(value: unknown):
  | { ok: true; wire: SinglePlayerCloudBackupWire; candidate: SinglePlayerCloudBackupCandidate }
  | { ok: false; reason: "invalid_backup" } {
  if (!Array.isArray(value) || value.length !== 10 || value[0] !== 1
    || typeof value[1] !== "string" || !WORLD_ID.test(value[1]) || !validName(value[2])
    || typeof value[3] !== "string" || !/^-?\d{1,10}$/.test(value[3])
    || String(Number(value[3])) !== value[3] || !integer(Number(value[3]), -2_147_483_648, 2_147_483_647)
    || (value[4] !== "survival" && value[4] !== "creative")
    || typeof value[5] !== "string" || !/^\d{1,16}$/.test(value[5])
    || String(Number(value[5])) !== value[5] || !integer(Number(value[5]), 0, MAX_TIMESTAMP)
    || typeof value[6] !== "string" || !HASH.test(value[6]) || typeof value[7] !== "string"
    || typeof value[8] !== "string" || !REVISION.test(value[8]) || !integer(Number(value[8]), 1, Number.MAX_SAFE_INTEGER)
    || typeof value[9] !== "string" || !/^\d{1,16}$/.test(value[9])
    || String(Number(value[9])) !== value[9] || !integer(Number(value[9]), 0, MAX_TIMESTAMP)) {
    return { ok: false, reason: "invalid_backup" };
  }
  const parsed = parseSinglePlayerCloudBackupCommitRequest(JSON.stringify([1, value[1], value[2], Number(value[3]),
    value[4], Number(value[5]), String(Number(value[8]) - 1), value[7]]));
  if (!parsed.ok || parsed.candidate.snapshotHash !== value[6]) return { ok: false, reason: "invalid_backup" };
  return { ok: true, wire: value as unknown as SinglePlayerCloudBackupWire, candidate: parsed.candidate };
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
  const stateBytes = chunks.reduce((sum, chunk) => sum + cloudBackupStoredChunkBytes(chunk), SINGLE_PLAYER_CLOUD_BACKUP_MANIFEST_STATE_BYTES);
  if (stateBytes > SINGLE_PLAYER_CLOUD_BACKUP_MAX_USER_STATE_BYTES) return { ok: false, reason: "cloud_capacity" };
  return { ok: true, candidate: {
    worldId: value[1], name: value[2], seed: value[3], gameMode: value[4], worldCreatedAt: value[5],
    expectedRevision: value[6], snapshotHash: cloudBackupHash(value[7]), snapshotJson: value[7],
    snapshotUtf8Bytes, stateBytes, chunks,
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

export function decideSinglePlayerCloudBackupDeleteRevision(
  targetExists: boolean,
  healthyRevision: string | null,
  expectedRevision: string,
): "delete" | "deduped" | "conflict" {
  if (!targetExists) return expectedRevision === "0" ? "deduped" : "conflict";
  const requiredRevision = healthyRevision ?? "0";
  return expectedRevision === requiredRevision ? "delete" : "conflict";
}

export function singlePlayerCloudBackupDeleteActiveState(
  globalStateBytes: number,
  remainingMinimum: number,
  targetRawCharge: number,
  removableBudgetCharge: number,
): number | null {
  if (!integer(globalStateBytes, 0, SINGLE_PLAYER_CLOUD_BACKUP_MAX_GLOBAL_STATE_BYTES)
    || !integer(remainingMinimum, SINGLE_PLAYER_CLOUD_BACKUP_QUOTA_STATE_BYTES, globalStateBytes)
    || !integer(targetRawCharge, 1, SINGLE_PLAYER_CLOUD_BACKUP_MAX_GLOBAL_STATE_BYTES)
    || !integer(removableBudgetCharge, 0, SINGLE_PLAYER_CLOUD_BACKUP_BUDGET_STATE_BYTES)) return null;
  let releaseSlack = globalStateBytes - remainingMinimum;
  const targetRelease = Math.min(targetRawCharge, releaseSlack);
  releaseSlack -= targetRelease;
  const budgetRelease = Math.min(removableBudgetCharge, releaseSlack);
  return globalStateBytes - targetRelease - budgetRelease;
}

export function candidateMatchesManifest(candidate: SinglePlayerCloudBackupCandidate, manifest: StoredSinglePlayerCloudBackupManifest): boolean {
  return candidate.worldId === manifest.worldId && candidate.name === manifest.name && String(candidate.seed) === manifest.seed
    && candidate.gameMode === manifest.gameMode && String(candidate.worldCreatedAt) === manifest.worldCreatedAt
    && candidate.snapshotHash === manifest.snapshotHash && String(candidate.snapshotUtf8Bytes) === manifest.snapshotUtf8Bytes
    && String(candidate.chunks.length) === manifest.chunkCount;
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
  const currentRevision = current && REVISION.test(current.revision) ? Number(current.revision) : 0;
  const currentBytes = current && /^\d{1,6}$/.test(current.stateBytes) ? Number(current.stateBytes) : 0;
  if (current && (currentRevision < 1 || currentRevision >= Number.MAX_SAFE_INTEGER)) {
    return { ok: false, reason: "server_state" };
  }
  if (current && currentSnapshotJson === candidate.snapshotJson && candidateMatchesManifest(candidate, current)) {
    return { ok: true, kind: "deduped", manifest: current };
  }
  if ((!current && candidate.expectedRevision !== "0") || (current && candidate.expectedRevision !== current.revision)) {
    return { ok: false, reason: "conflict" };
  }
  if (!current && userWorldCount >= SINGLE_PLAYER_CLOUD_BACKUP_MAX_WORLDS) return { ok: false, reason: "world_limit" };
  if (userStateBytes - currentBytes + candidate.stateBytes > SINGLE_PLAYER_CLOUD_BACKUP_MAX_USER_STATE_BYTES
    || globalStateBytes - currentBytes + candidate.stateBytes > SINGLE_PLAYER_CLOUD_BACKUP_MAX_GLOBAL_STATE_BYTES) {
    return { ok: false, reason: "cloud_capacity" };
  }
  const retryAfterMs = userLastAcceptedAt + SINGLE_PLAYER_CLOUD_BACKUP_MIN_USER_UPLOAD_MS - now;
  if (retryAfterMs > 0) return { ok: false, reason: "cadence", retryAfterMs };
  if (userAcceptedToday >= SINGLE_PLAYER_CLOUD_BACKUP_USER_DAILY_WRITES
    || globalAcceptedToday >= SINGLE_PLAYER_CLOUD_BACKUP_GLOBAL_DAILY_WRITES) return { ok: false, reason: "cloud_capacity" };
  return { ok: true, kind: "write", manifest: {
    worldId: candidate.worldId, name: candidate.name, seed: String(candidate.seed), gameMode: candidate.gameMode,
    worldCreatedAt: String(candidate.worldCreatedAt), snapshotHash: candidate.snapshotHash,
    snapshotUtf8Bytes: String(candidate.snapshotUtf8Bytes), stateBytes: String(candidate.stateBytes),
    chunkCount: String(candidate.chunks.length),
    revision: String(currentRevision + 1), uploadedAt: String(now),
  } };
}

export function utcCloudBackupDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function validUtcCloudBackupDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) && utcCloudBackupDay(timestamp) === value;
}

export function singlePlayerCloudBudgetCleanupAfter(dayKey: unknown, lastAcceptedAt: unknown): number | null {
  if (!validUtcCloudBackupDay(dayKey) || !integer(lastAcceptedAt, 0, MAX_TIMESTAMP)
    || utcCloudBackupDay(lastAcceptedAt) !== dayKey) return null;
  const dayEnd = Date.parse(`${dayKey}T00:00:00Z`) + 86_400_000;
  const cadenceEnd = lastAcceptedAt + SINGLE_PLAYER_CLOUD_BACKUP_MIN_USER_UPLOAD_MS;
  const cleanupAfter = Math.max(dayEnd, cadenceEnd);
  return integer(cleanupAfter, 0, MAX_TIMESTAMP) ? cleanupAfter : null;
}

export function validSinglePlayerCloudQuotaState(activeStateBytes: unknown, minimumStateBytes: number, revision: unknown): boolean {
  return integer(minimumStateBytes, SINGLE_PLAYER_CLOUD_BACKUP_QUOTA_STATE_BYTES, SINGLE_PLAYER_CLOUD_BACKUP_MAX_GLOBAL_STATE_BYTES)
    && integer(activeStateBytes, minimumStateBytes, SINGLE_PLAYER_CLOUD_BACKUP_MAX_GLOBAL_STATE_BYTES)
    && integer(revision, 1, Number.MAX_SAFE_INTEGER - 1);
}

export function singlePlayerCloudBackupWire(
  manifest: StoredSinglePlayerCloudBackupManifest,
  snapshotJson: string,
): SinglePlayerCloudBackupWire {
  return [1, manifest.worldId, manifest.name, manifest.seed, manifest.gameMode as "survival" | "creative",
    manifest.worldCreatedAt, manifest.snapshotHash, snapshotJson, manifest.revision, manifest.uploadedAt];
}
