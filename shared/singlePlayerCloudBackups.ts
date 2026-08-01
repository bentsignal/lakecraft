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
export const SINGLE_PLAYER_CLOUD_BACKUP_MAX_TOMBSTONES = 6;
export const SINGLE_PLAYER_CLOUD_ACCOUNT_FENCE_WORLD = "~";
export const SINGLE_PLAYER_CLOUD_BACKUP_MAX_OWNER_ROWS = SINGLE_PLAYER_CLOUD_BACKUP_MAX_WORLDS
  * (SINGLE_PLAYER_CLOUD_BACKUP_MAX_CHUNKS + 2) + 1;

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
  operationId: string,
];

export type SinglePlayerCloudDispositionRequest = readonly [2 | 3, expectedRevision: string];
export type SinglePlayerCloudTombstone = readonly [
  worldId: string, revision: string, deletedRevision: string, deletedAt: string, operationId: string,
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

export type SinglePlayerCloudBackupCandidate = readonly [
  worldId: string, name: string, seed: number, gameMode: "survival" | "creative", worldCreatedAt: number,
  expectedRevision: string, snapshotHash: string, snapshotJson: string, snapshotUtf8Bytes: number,
  stateBytes: number, chunks: string[],
];
export type StoredSinglePlayerCloudBackupManifest = readonly [
  string, string, string, string, string, string, string, string, string, string, string,
];

export interface StoredSinglePlayerCloudBackupPart {
  userId: string;
  worldId: string;
  part: string;
  data: string;
}

export type LoadedSinglePlayerCloudBackup<TPart extends StoredSinglePlayerCloudBackupPart> = readonly [
  manifest: StoredSinglePlayerCloudBackupManifest, snapshotJson: string, parts: TPart[],
];
export type InventoriedSinglePlayerCloudBackup<TPart extends StoredSinglePlayerCloudBackupPart> = readonly [
  worldId: string, parts: TPart[], stateBytes: number,
];
const SERVER_STATE = [0, "server_state"] as const;
const INVALID_REQUEST = [0, "invalid_request"] as const;
const CLOUD_CAPACITY = [0, "cloud_capacity"] as const;
const INVALID_BACKUP = [0, "invalid_backup"] as const;

/** Bounds every persisted string before any header parse, payload join, or integrity reconstruction. */
export function inventorySinglePlayerCloudBackupParts<TPart extends StoredSinglePlayerCloudBackupPart>(
  userId: string,
  rows: readonly TPart[],
): readonly [1, InventoriedSinglePlayerCloudBackup<TPart>[], number] | typeof SERVER_STATE {
  if (typeof userId !== "string" || userId.length < 1 || userId.length > 520
    || rows.length > SINGLE_PLAYER_CLOUD_BACKUP_MAX_OWNER_ROWS
    || rows.some((row) => !row || typeof row !== "object" || row.userId !== userId
      || typeof row.worldId !== "string" || row.worldId !== SINGLE_PLAYER_CLOUD_ACCOUNT_FENCE_WORLD && !WORLD_ID.test(row.worldId)
      || typeof row.part !== "string" || row.part.length < 1 || row.part.length > 8
      || typeof row.data !== "string"
      || (row.part === "0" ? row.data.length > SINGLE_PLAYER_CLOUD_BACKUP_HEADER_MAX_CHARS
        || cloudBackupUtf8Bytes(row.data) > SINGLE_PLAYER_CLOUD_BACKUP_HEADER_MAX_UTF8_BYTES
        : row.data.length < 1 || row.data.length > SINGLE_PLAYER_CLOUD_BACKUP_CHUNK_BYTES
          || cloudBackupUtf8Bytes(row.data) > SINGLE_PLAYER_CLOUD_BACKUP_CHUNK_BYTES))) {
    return SERVER_STATE;
  }
  const worldIds = [...new Set(rows.map((row) => row.worldId))].sort();
  if (worldIds.filter((id) => id !== SINGLE_PLAYER_CLOUD_ACCOUNT_FENCE_WORLD).length
    > SINGLE_PLAYER_CLOUD_BACKUP_MAX_WORLDS * 2) return SERVER_STATE;
  const worlds: InventoriedSinglePlayerCloudBackup<TPart>[] = [];
  let stateBytes = 0;
  for (const worldId of worldIds) {
    const parts = rows.filter((row) => row.worldId === worldId);
    const payload = parts.filter((part) => part.part !== "0");
    if (payload.reduce((sum, part) => sum + part.data.length, 0) > SINGLE_PLAYER_CLOUD_BACKUP_MAX_SNAPSHOT_CHARS
      || payload.reduce((sum, part) => sum + cloudBackupUtf8Bytes(part.data), 0)
        > SINGLE_PLAYER_CLOUD_BACKUP_CHUNK_BYTES * SINGLE_PLAYER_CLOUD_BACKUP_MAX_CHUNKS) {
      return SERVER_STATE;
    }
    const worldStateBytes = parts.reduce((sum, part) => sum
      + cloudBackupStoredPartBytes(userId, worldId, part.part, part.data), 0);
    stateBytes += worldStateBytes;
    if (!Number.isSafeInteger(stateBytes) || stateBytes > SINGLE_PLAYER_CLOUD_BACKUP_MAX_GLOBAL_STATE_BYTES) {
      return SERVER_STATE;
    }
    worlds.push([worldId, parts, worldStateBytes]);
  }
  return [1, worlds, stateBytes];
}

export function validStoredSinglePlayerCloudBackupManifest(value: unknown): value is StoredSinglePlayerCloudBackupManifest {
  return Array.isArray(value) && value.length === 11 && typeof value[0] === "string" && WORLD_ID.test(value[0]) && validName(value[1])
    && typeof value[2] === "string" && /^-?\d{1,10}$/.test(value[2]) && integer(Number(value[2]), -2_147_483_648, 2_147_483_647)
    && (value[3] === "survival" || value[3] === "creative")
    && typeof value[4] === "string" && /^\d{1,16}$/.test(value[4]) && integer(Number(value[4]), 0, MAX_TIMESTAMP)
    && typeof value[5] === "string" && HASH.test(value[5])
    && typeof value[6] === "string" && /^\d{1,6}$/.test(value[6]) && integer(Number(value[6]), 1, SINGLE_PLAYER_CLOUD_BACKUP_CHUNK_BYTES * SINGLE_PLAYER_CLOUD_BACKUP_MAX_CHUNKS)
    && typeof value[7] === "string" && /^\d{1,6}$/.test(value[7]) && integer(Number(value[7]), 1, SINGLE_PLAYER_CLOUD_BACKUP_MAX_USER_STATE_BYTES)
    && typeof value[8] === "string" && /^[1-4]$/.test(value[8])
    && typeof value[9] === "string" && REVISION.test(value[9]) && integer(Number(value[9]), 1, Number.MAX_SAFE_INTEGER)
    && typeof value[10] === "string" && /^\d{1,16}$/.test(value[10]) && integer(Number(value[10]), 0, MAX_TIMESTAMP);
}

export function singlePlayerCloudBackupHeader(manifest: StoredSinglePlayerCloudBackupManifest): string {
  return JSON.stringify([1, manifest[1], manifest[2], manifest[3], manifest[4], manifest[5], manifest[9], manifest[10]]);
}

export function loadSinglePlayerCloudBackupParts<TPart extends StoredSinglePlayerCloudBackupPart>(
  userId: string,
  rows: readonly TPart[],
): readonly [1, LoadedSinglePlayerCloudBackup<TPart>[], SinglePlayerCloudTombstone[],
    SinglePlayerCloudTombstone | null, number] | typeof SERVER_STATE {
  const inventory = inventorySinglePlayerCloudBackupParts(userId, rows);
  if (!inventory[0]) return inventory;
  const backups: LoadedSinglePlayerCloudBackup<TPart>[] = [];
  const tombstones: SinglePlayerCloudTombstone[] = [];
  let accountFence: SinglePlayerCloudTombstone | null = null;
  let stateBytes = 0;
  for (const world of inventory[1]) {
    const worldId = world[0];
    const parts = [...world[1]]
      .sort((left, right) => Number(left.part) - Number(right.part));
    if (parts.length === 1 && parts[0].part === "0") {
      const tombstone = parseSinglePlayerCloudTombstone(worldId, parts[0].data);
      if (!tombstone || worldId === SINGLE_PLAYER_CLOUD_ACCOUNT_FENCE_WORLD && accountFence
        || worldId !== SINGLE_PLAYER_CLOUD_ACCOUNT_FENCE_WORLD
          && tombstones.length >= SINGLE_PLAYER_CLOUD_BACKUP_MAX_TOMBSTONES) {
        return SERVER_STATE;
      }
      if (worldId === SINGLE_PLAYER_CLOUD_ACCOUNT_FENCE_WORLD) accountFence = tombstone;
      else tombstones.push(tombstone);
      stateBytes += world[2];
      continue;
    }
    if (parts.length < 2 || parts.length > SINGLE_PLAYER_CLOUD_BACKUP_MAX_CHUNKS + 1
      || parts.some((part, index) => part.part !== String(index))) return SERVER_STATE;
    let header: unknown;
    try { header = JSON.parse(parts[0].data); } catch { return SERVER_STATE; }
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
      || parts[0].data !== JSON.stringify(header)) return SERVER_STATE;
    const snapshotJson = parts.slice(1).map((part) => part.data).join("");
    const candidate = parseSinglePlayerCloudBackupCommitRequest(JSON.stringify([1, worldId, header[1],
      Number(header[2]), header[3], Number(header[4]), String(Number(header[6]) - 1), snapshotJson]));
    if (!candidate[0] || candidate[1][6] !== header[5]
      || candidate[1][10].length !== parts.length - 1
      || candidate[1][10].some((chunk, index) => chunk !== parts[index + 1].data)) {
      return SERVER_STATE;
    }
    const manifest: StoredSinglePlayerCloudBackupManifest = [worldId, header[1], header[2], header[3], header[4], header[5],
      String(candidate[1][8]), String(world[2]), String(candidate[1][10].length), header[6], header[7]];
    stateBytes += world[2];
    if (stateBytes > SINGLE_PLAYER_CLOUD_BACKUP_MAX_USER_STATE_BYTES) return SERVER_STATE;
    backups.push([manifest, snapshotJson, parts]);
  }
  return [1, backups, tombstones, accountFence, stateBytes];
}

const OPERATION_ID = /^[A-Za-z0-9_-]{8,80}$/;
export function singlePlayerCloudTombstoneHeader(value: SinglePlayerCloudTombstone): string {
  return JSON.stringify([0, ...value.slice(1)]);
}

export function parseSinglePlayerCloudTombstone(worldId: string, raw: string): SinglePlayerCloudTombstone | null {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!Array.isArray(value) || value.length !== 5 || value[0] !== 0
    || typeof value[1] !== "string" || !REVISION.test(value[1]) || Number(value[1]) > Number.MAX_SAFE_INTEGER
    || typeof value[2] !== "string" || !REVISION.test(value[2]) || Number(value[2]) > Number.MAX_SAFE_INTEGER
    || typeof value[3] !== "string" || !/^\d{1,16}$/.test(value[3]) || !integer(Number(value[3]), 0, MAX_TIMESTAMP)
    || typeof value[4] !== "string" || !OPERATION_ID.test(value[4])
    || raw !== JSON.stringify(value)) return null;
  return [worldId, value[1], value[2], value[3], value[4]];
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
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function parseSinglePlayerCloudBackupWire(value: unknown):
  | readonly [1, SinglePlayerCloudBackupWire, SinglePlayerCloudBackupCandidate]
  | typeof INVALID_BACKUP {
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
    return INVALID_BACKUP;
  }
  const parsed = parseSinglePlayerCloudBackupCommitRequest(JSON.stringify([1, value[1], value[2], Number(value[3]),
    value[4], Number(value[5]), String(Number(value[8]) - 1), value[7]]));
  if (!parsed[0] || parsed[1][6] !== value[6]) return INVALID_BACKUP;
  return [1, value as unknown as SinglePlayerCloudBackupWire, parsed[1]];
}

export function parseSinglePlayerCloudBackupCommitRequest(raw: string):
  | readonly [1, SinglePlayerCloudBackupCandidate]
  | readonly [0, "cloud_capacity" | "invalid_request" | "invalid_snapshot"] {
  if (typeof raw !== "string" || raw.length < 2 || raw.length > SINGLE_PLAYER_CLOUD_BACKUP_MAX_SNAPSHOT_CHARS * 2 + 1_024) {
    return INVALID_REQUEST;
  }
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return INVALID_REQUEST; }
  if (!Array.isArray(value) || value.length !== 8 || value[0] !== 1
    || typeof value[1] !== "string" || !WORLD_ID.test(value[1]) || !validName(value[2])
    || !integer(value[3], -2_147_483_648, 2_147_483_647)
    || (value[4] !== "survival" && value[4] !== "creative") || !integer(value[5], 0, MAX_TIMESTAMP)
    || typeof value[6] !== "string" || !REVISION.test(value[6]) || Number(value[6]) > Number.MAX_SAFE_INTEGER
    || typeof value[7] !== "string") return INVALID_REQUEST;
  const chunks = splitSinglePlayerCloudBackupSnapshot(value[7]);
  if (!chunks) return CLOUD_CAPACITY;
  const snapshotUtf8Bytes = cloudBackupUtf8Bytes(value[7]);
  const stateBytes = chunks.reduce((sum, chunk) => sum + cloudBackupStoredChunkBytes(chunk), SINGLE_PLAYER_CLOUD_BACKUP_MANIFEST_STATE_BYTES);
  if (stateBytes > SINGLE_PLAYER_CLOUD_BACKUP_MAX_USER_STATE_BYTES) return CLOUD_CAPACITY;
  return [1, [value[1], value[2], value[3], value[4], value[5], value[6], cloudBackupHash(value[7]),
    value[7], snapshotUtf8Bytes, stateBytes, chunks]];
}

export function parseSinglePlayerCloudBackupDeleteRequest(raw: string): SinglePlayerCloudBackupDeleteRequest | null {
  if (typeof raw !== "string" || raw.length > 192) return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  return Array.isArray(value) && value.length === 4 && value[0] === 1
    && typeof value[1] === "string" && WORLD_ID.test(value[1])
    && typeof value[2] === "string" && REVISION.test(value[2]) && Number(value[2]) <= Number.MAX_SAFE_INTEGER
    && typeof value[3] === "string" && OPERATION_ID.test(value[3])
    ? value as unknown as SinglePlayerCloudBackupDeleteRequest : null;
}

export function parseSinglePlayerCloudDispositionRequest(raw: string): SinglePlayerCloudDispositionRequest | null {
  if (typeof raw !== "string" || raw.length > 64) return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  return Array.isArray(value) && value.length === 2 && (value[0] === 2 || value[0] === 3)
    && typeof value[1] === "string" && REVISION.test(value[1]) && Number(value[1]) <= Number.MAX_SAFE_INTEGER
    ? value as SinglePlayerCloudDispositionRequest : null;
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
  return candidate[0] === manifest[0] && candidate[1] === manifest[1] && String(candidate[2]) === manifest[2]
    && candidate[3] === manifest[3] && String(candidate[4]) === manifest[4] && candidate[6] === manifest[5]
    && String(candidate[8]) === manifest[6] && String(candidate[10].length) === manifest[8];
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
  generation: string,
  now: number,
): readonly [1, "deduped" | "write", StoredSinglePlayerCloudBackupManifest]
  | readonly [0, "cadence" | "cloud_capacity" | "conflict" | "server_state" | "world_limit", number?] {
  if (!integer(userWorldCount, 0, SINGLE_PLAYER_CLOUD_BACKUP_MAX_WORLDS + 1)
    || !integer(userStateBytes, 0, SINGLE_PLAYER_CLOUD_BACKUP_MAX_GLOBAL_STATE_BYTES)
    || !integer(globalStateBytes, 0, SINGLE_PLAYER_CLOUD_BACKUP_MAX_GLOBAL_STATE_BYTES)
    || !integer(userLastAcceptedAt, 0, MAX_TIMESTAMP) || !integer(userAcceptedToday, 0, SINGLE_PLAYER_CLOUD_BACKUP_USER_DAILY_WRITES)
    || !integer(globalAcceptedToday, 0, SINGLE_PLAYER_CLOUD_BACKUP_GLOBAL_DAILY_WRITES)
    || !REVISION.test(generation) || !integer(Number(generation), 1, Number.MAX_SAFE_INTEGER - 1)
    || !integer(now, 0, MAX_TIMESTAMP)) return SERVER_STATE;
  const currentRevision = current && REVISION.test(current[9]) ? Number(current[9]) : 0;
  const currentBytes = current && /^\d{1,6}$/.test(current[7]) ? Number(current[7]) : 0;
  if (current && (currentRevision < 1 || currentRevision >= Number(generation))) {
    return SERVER_STATE;
  }
  if (current && currentSnapshotJson === candidate[7] && candidateMatchesManifest(candidate, current)) {
    return [1, "deduped", current];
  }
  if ((!current && candidate[5] !== "0") || (current && candidate[5] !== current[9])) {
    return [0, "conflict"];
  }
  if (!current && userWorldCount >= SINGLE_PLAYER_CLOUD_BACKUP_MAX_WORLDS) return [0, "world_limit"];
  if (userStateBytes - currentBytes + candidate[9] > SINGLE_PLAYER_CLOUD_BACKUP_MAX_USER_STATE_BYTES
    || globalStateBytes - currentBytes + candidate[9] > SINGLE_PLAYER_CLOUD_BACKUP_MAX_GLOBAL_STATE_BYTES) {
    return CLOUD_CAPACITY;
  }
  const retryAfterMs = userLastAcceptedAt + SINGLE_PLAYER_CLOUD_BACKUP_MIN_USER_UPLOAD_MS - now;
  if (retryAfterMs > 0) return [0, "cadence", retryAfterMs];
  if (userAcceptedToday >= SINGLE_PLAYER_CLOUD_BACKUP_USER_DAILY_WRITES
    || globalAcceptedToday >= SINGLE_PLAYER_CLOUD_BACKUP_GLOBAL_DAILY_WRITES) return CLOUD_CAPACITY;
  return [1, "write", [candidate[0], candidate[1], String(candidate[2]), candidate[3], String(candidate[4]),
    candidate[6], String(candidate[8]), String(candidate[9]), String(candidate[10].length), generation, String(now)]];
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

export function nextSinglePlayerCloudGeneration(revision: number): string | null {
  return integer(revision, 0, Number.MAX_SAFE_INTEGER - 2) ? String(revision + 1) : null;
}

export function singlePlayerCloudBackupWire(
  manifest: StoredSinglePlayerCloudBackupManifest,
  snapshotJson: string,
): SinglePlayerCloudBackupWire {
  return [1, manifest[0], manifest[1], manifest[2], manifest[3] as "survival" | "creative",
    manifest[4], manifest[5], snapshotJson, manifest[9], manifest[10]];
}
