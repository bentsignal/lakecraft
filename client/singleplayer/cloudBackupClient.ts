import {
  loadSinglePlayerSave,
  parseSinglePlayerSaveEnvelope,
  singlePlayerSaveChecksum,
  type SinglePlayerSaveEnvelope,
  type SinglePlayerStorageAdapter,
  type SinglePlayerSnapshot,
} from "./localSave.ts";
import {
  restoreMissingLocalWorld,
  type LocalWorldMutationResult,
  type LocalWorldRecord,
} from "./localWorldRegistry.ts";
export type SinglePlayerCloudBackupWire = readonly [1, string, string, string, "survival" | "creative",
  string, string, string, string, string];
export type SinglePlayerCloudQueryWire = readonly [] | readonly [1, number, unknown[], unknown[]]
  | readonly [2, number] | readonly [3, number, string];
export type SinglePlayerCloudMutationWire = readonly [1 | 2 | 8, string, number] | readonly [4, number]
  | readonly [3 | 5, string, number] | readonly [6, number, number] | readonly [7, string, 0 | 1, number];
export const SINGLE_PLAYER_CLOUD_MAX_REVISION = Number.MAX_SAFE_INTEGER;
export const SINGLE_PLAYER_CLOUD_MAX_TIMESTAMP = 8_640_000_000_000_000;
export const SINGLE_PLAYER_CLOUD_WORLD_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const SINGLE_PLAYER_CLOUD_HASH = /^[0-9a-f]{8}$/;
const MAX_SNAPSHOT = 150_000;
const QUARANTINED = "backup_quarantined";

export type PreparedSinglePlayerCloudBackup = readonly [
  requestJson: string,
  snapshotJson: string,
  sequence: number,
  savedAt: number,
  checksum: string,
];
export type SinglePlayerCloudLineage = readonly [string, number, number, string];

/** Reads one already-committed journal slot twice and uploads only those exact, locally validated bytes. */
export function prepareSinglePlayerCloudBackup(
  storage: SinglePlayerStorageAdapter,
  world: LocalWorldRecord,
  expectedRevision: string,
): { ok: true; backup: PreparedSinglePlayerCloudBackup }
  | { ok: false; reason: "local_save_unavailable" | "readback_drift" | "invalid_local_save" } {
  const { id, name, seed, initialGameMode, createdAt } = world;
  const loaded = loadSinglePlayerSave(storage, { migrateLegacy: false, worldId: id });
  if (loaded.status !== "loaded" && loaded.status !== "recovered") {
    return { ok: false, reason: "local_save_unavailable" };
  }
  const { snapshot, status, slot, sequence, savedAt, raw, checksum } = loaded;
  if (snapshot.world.seed !== seed || snapshot.world.createdAt !== createdAt
    || (snapshot.world.gameMode !== undefined && snapshot.world.gameMode !== initialGameMode)) {
    return { ok: false, reason: "invalid_local_save" };
  }
  const confirmed = loadSinglePlayerSave(storage, { migrateLegacy: false, worldId: id });
  if ((confirmed.status !== "loaded" && confirmed.status !== "recovered") || confirmed.status !== status || confirmed.slot !== slot
    || confirmed.sequence !== sequence || confirmed.savedAt !== savedAt || confirmed.raw !== raw) {
    return { ok: false, reason: "readback_drift" };
  }
  if (!/^(?:0|[1-9]\d{0,15})$/.test(expectedRevision)
    || Number(expectedRevision) > SINGLE_PLAYER_CLOUD_MAX_REVISION || raw.length > MAX_SNAPSHOT) {
    return { ok: false, reason: "invalid_local_save" };
  }
  const requestJson = JSON.stringify([1, id, name, seed, initialGameMode, createdAt, expectedRevision, raw]);
  return { ok: true, backup: [requestJson, raw, sequence, savedAt, checksum] };
}

export const singlePlayerCloudNumber = (value: unknown, minimum: number, maximum: number) => {
  if (typeof value !== "string" || !/^-?\d{1,16}$/.test(value)) return false;
  const number = Number(value);
  return String(number) === value && Number.isSafeInteger(number) && number >= minimum && number <= maximum;
};
const dense = (value: unknown): value is unknown[] => Array.isArray(value) && Object.keys(value).length === value.length;
const text = (value: unknown): value is string => typeof value === "string";
const matches = (value: unknown, pattern: RegExp): value is string => text(value) && pattern.test(value);
const timestamp = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0
  && (value as number) <= SINGLE_PLAYER_CLOUD_MAX_TIMESTAMP;
export function parseSinglePlayerCloudQueryWire(value: unknown): SinglePlayerCloudQueryWire | null {
  if (!dense(value)) return null;
  if (value.length === 0) return value;
  const tag = value[0];
  if (value.length === 2 && tag === 2 && timestamp(value[1])) return value as [2, number];
  if (value.length === 3 && tag === 3 && timestamp(value[1])
    && singlePlayerCloudNumber(value[2], 0, SINGLE_PLAYER_CLOUD_MAX_REVISION)) return value as [3, number, string];
  return value.length === 4 && tag === 1 && timestamp(value[1]) && dense(value[2]) && dense(value[3])
    ? value as [1, number, unknown[], unknown[]] : null;
}
export function parseSinglePlayerCloudMutationWire(value: unknown): SinglePlayerCloudMutationWire | null {
  if (!dense(value)) return null;
  const tag = value[0];
  if (value.length === 2 && tag === 4 && timestamp(value[1])) return value as [4, number];
  if (value.length === 4 && tag === 7 && singlePlayerCloudNumber(value[1], 1, SINGLE_PLAYER_CLOUD_MAX_REVISION)
    && (value[2] === 0 || value[2] === 1) && timestamp(value[3])) return value as [7, string, 0 | 1, number];
  if (value.length !== 3 || !timestamp(value[2])) return null;
  if ((tag === 1 || tag === 8)
    && singlePlayerCloudNumber(value[1], 1, SINGLE_PLAYER_CLOUD_MAX_REVISION - 1)
    || tag === 2 && singlePlayerCloudNumber(value[1], 0, SINGLE_PLAYER_CLOUD_MAX_REVISION - 1)) {
    return value as [1 | 2 | 8, string, number];
  }
  if ((tag === 3 && (value[1] === "cloud_capacity" || value[1] === "world_limit"
    || value[1] === "tombstone_capacity"))
    || (tag === 5 && text(value[1]) && value[1].length > 0 && value[1].length <= 64)) {
    return value as [3 | 5, string, number];
  }
  return tag === 6 && Number.isSafeInteger(value[1]) && Number(value[1]) > 0
    && Number(value[1]) <= SINGLE_PLAYER_CLOUD_MAX_TIMESTAMP
    ? value as [6, number, number] : null;
}
export function parseSinglePlayerCloudBackupWire(value: unknown): SinglePlayerCloudBackupWire | null {
  if (!Array.isArray(value) || value.length !== 10) return null;
  const tag = value[0], worldId = value[1], name = value[2], seed = value[3], mode = value[4],
    createdAt = value[5], hash = value[6], snapshot = value[7], revision = value[8], uploadedAt = value[9];
  if (tag !== 1 || !matches(worldId, SINGLE_PLAYER_CLOUD_WORLD_ID)
    || !text(name) || name.length < 1 || name.length > 48
    || name !== name.trim().replace(/\s+/g, " ") || /[\u0000-\u001f\u007f]/.test(name)
    || !singlePlayerCloudNumber(seed, -2_147_483_648, 2_147_483_647)
    || mode !== "survival" && mode !== "creative"
    || !singlePlayerCloudNumber(createdAt, 0, SINGLE_PLAYER_CLOUD_MAX_TIMESTAMP)
    || !matches(hash, SINGLE_PLAYER_CLOUD_HASH)
    || !text(snapshot) || snapshot.length < 1 || snapshot.length > MAX_SNAPSHOT || singlePlayerSaveChecksum(snapshot) !== hash
    || !singlePlayerCloudNumber(revision, 1, SINGLE_PLAYER_CLOUD_MAX_REVISION)
    || !singlePlayerCloudNumber(uploadedAt, 0, SINGLE_PLAYER_CLOUD_MAX_TIMESTAMP)) return null;
  return value as unknown as SinglePlayerCloudBackupWire;
}

/** Returns the only safe CAS revision, or null when no automatic upload is authorized. */
export function singlePlayerCloudUploadRevision(local: PreparedSinglePlayerCloudBackup,
  remote: SinglePlayerCloudBackupWire | null, lineage: SinglePlayerCloudLineage | null, disabled: boolean): string | null {
  if (remote?.[7] === local[1] || disabled) return null;
  if (!remote) return lineage ? null : "0";
  if (!lineage || lineage[0] !== remote[8]) return null;
  if (local[2] === lineage[1] && local[3] === lineage[2] && local[4] === lineage[3]) return null;
  return local[2] > lineage[1] && local[3] >= lineage[2] ? remote[8] : null;
}

export type RestorableSinglePlayerCloudBackup = {
  wire: SinglePlayerCloudBackupWire;
  snapshot: SinglePlayerSnapshot;
  snapshotSavedAt: number;
};

export type QuarantinedSinglePlayerCloudBackup = readonly [worldId: string, revision: string];
export type SinglePlayerCloudDescriptor = readonly [1, string, string, string, string]
  | readonly [2, string] | readonly [3, string, string];

export function parseSinglePlayerCloudDescriptor(value: unknown): SinglePlayerCloudDescriptor | null {
  if (!dense(value)) return null;
  const tag = value[0];
  if (value.length === 2 && tag === 2
    && singlePlayerCloudNumber(value[1], 1, SINGLE_PLAYER_CLOUD_MAX_REVISION)) return value as unknown as SinglePlayerCloudDescriptor;
  if (value.length === 3 && tag === 3 && matches(value[1], SINGLE_PLAYER_CLOUD_WORLD_ID)
    && singlePlayerCloudNumber(value[2], 0, SINGLE_PLAYER_CLOUD_MAX_REVISION)) return value as unknown as SinglePlayerCloudDescriptor;
  return value.length === 5 && tag === 1 && matches(value[1], SINGLE_PLAYER_CLOUD_WORLD_ID)
    && singlePlayerCloudNumber(value[2], 1, SINGLE_PLAYER_CLOUD_MAX_REVISION)
    && singlePlayerCloudNumber(value[3], 0, SINGLE_PLAYER_CLOUD_MAX_REVISION)
    && singlePlayerCloudNumber(value[4], 0, SINGLE_PLAYER_CLOUD_MAX_TIMESTAMP)
    ? value as unknown as SinglePlayerCloudDescriptor : null;
}

/** Preserves only the server's bounded delete descriptor for an unreconstructable world. */
export function parseServerQuarantinedSinglePlayerCloudBackup(value: unknown):
  QuarantinedSinglePlayerCloudBackup | null {
  return dense(value) && value.length === 2 && matches(value[0], SINGLE_PLAYER_CLOUD_WORLD_ID)
    && singlePlayerCloudNumber(value[1], 0, SINGLE_PLAYER_CLOUD_MAX_REVISION)
    ? value as unknown as QuarantinedSinglePlayerCloudBackup : null;
}

/** Cloud bytes remain quarantined until both transport and the complete local journal schema validate. */
export function validateRestorableSinglePlayerCloudBackup(value: unknown):
  readonly [SinglePlayerCloudBackupWire, SinglePlayerSaveEnvelope | null] | null {
  const wire = parseSinglePlayerCloudBackupWire(value);
  if (!wire) return null;
  const parsed = parseSinglePlayerSaveEnvelope(wire[7], wire[1]);
  const envelope = parsed[0];
  return [wire, envelope && envelope.payload.world.seed === Number(wire[3])
    && envelope.payload.world.createdAt === Number(wire[5])
    && (envelope.payload.world.gameMode === undefined || envelope.payload.world.gameMode === wire[4])
    ? envelope : null];
}
export function parseRestorableSinglePlayerCloudBackupWire(value: unknown): SinglePlayerCloudBackupWire | null {
  const parsed = validateRestorableSinglePlayerCloudBackup(value);
  return parsed?.[1] ? parsed[0] : null;
}
export function parseRestorableSinglePlayerCloudBackup(value: unknown):
  | { ok: true; backup: RestorableSinglePlayerCloudBackup }
  | { ok: false; reason: "backup_quarantined"; quarantine?: QuarantinedSinglePlayerCloudBackup } {
  const parsed = validateRestorableSinglePlayerCloudBackup(value);
  if (!parsed) return { ok: false, reason: QUARANTINED };
  if (!parsed[1]) return { ok: false, reason: QUARANTINED, quarantine: [parsed[0][1], parsed[0][8]] };
  return { ok: true, backup: { wire: parsed[0], snapshot: parsed[1].payload, snapshotSavedAt: parsed[1].savedAt } };
}

/** Explicit restore delegates to the registry's stable-empty, crash-recoverable transaction. */
export function restoreSinglePlayerCloudBackup(
  storage: SinglePlayerStorageAdapter,
  value: unknown,
): LocalWorldMutationResult {
  const parsed = validateRestorableSinglePlayerCloudBackup(value);
  if (!parsed?.[1]) return { ok: false, reason: QUARANTINED, mutationStarted: false };
  const wire = parsed[0], envelope = parsed[1];
  return restoreMissingLocalWorld(storage, {
    worldId: wire[1], name: wire[2], seed: Number(wire[3]), gameMode: wire[4], createdAt: Number(wire[5]),
    snapshot: envelope.payload, snapshotSavedAt: envelope.savedAt,
  });
}
