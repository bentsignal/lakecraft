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
  const loaded = loadSinglePlayerSave(storage, { migrateLegacy: false, worldId: world.id });
  if (loaded.status !== "loaded" && loaded.status !== "recovered") {
    return { ok: false, reason: "local_save_unavailable" };
  }
  if (loaded.snapshot.world.seed !== world.seed || loaded.snapshot.world.createdAt !== world.createdAt
    || (loaded.snapshot.world.gameMode !== undefined && loaded.snapshot.world.gameMode !== world.initialGameMode)) {
    return { ok: false, reason: "invalid_local_save" };
  }
  const confirmed = loadSinglePlayerSave(storage, { migrateLegacy: false, worldId: world.id });
  if ((confirmed.status !== "loaded" && confirmed.status !== "recovered") || confirmed.status !== loaded.status || confirmed.slot !== loaded.slot
    || confirmed.sequence !== loaded.sequence || confirmed.savedAt !== loaded.savedAt || confirmed.raw !== loaded.raw) {
    return { ok: false, reason: "readback_drift" };
  }
  if (!/^(?:0|[1-9]\d{0,15})$/.test(expectedRevision)
    || Number(expectedRevision) > SINGLE_PLAYER_CLOUD_MAX_REVISION || loaded.raw.length > MAX_SNAPSHOT) {
    return { ok: false, reason: "invalid_local_save" };
  }
  const requestJson = JSON.stringify([1, world.id, world.name, world.seed, world.initialGameMode,
    world.createdAt, expectedRevision, loaded.raw]);
  return { ok: true, backup: [requestJson, loaded.raw, loaded.sequence, loaded.savedAt, loaded.checksum] };
}

export const singlePlayerCloudNumber = (value: unknown, minimum: number, maximum: number) => {
  if (typeof value !== "string" || !/^-?\d{1,16}$/.test(value)) return false;
  const number = Number(value);
  return String(number) === value && Number.isSafeInteger(number) && number >= minimum && number <= maximum;
};
const dense = (value: unknown): value is unknown[] => Array.isArray(value) && Object.keys(value).length === value.length;
const timestamp = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0
  && (value as number) <= SINGLE_PLAYER_CLOUD_MAX_TIMESTAMP;
export function parseSinglePlayerCloudQueryWire(value: unknown): SinglePlayerCloudQueryWire | null {
  if (!dense(value)) return null;
  if (value.length === 0) return value;
  if (value.length === 2 && value[0] === 2 && timestamp(value[1])) return value as [2, number];
  if (value.length === 3 && value[0] === 3 && timestamp(value[1])
    && singlePlayerCloudNumber(value[2], 0, SINGLE_PLAYER_CLOUD_MAX_REVISION)) return value as [3, number, string];
  return value.length === 4 && value[0] === 1 && timestamp(value[1]) && dense(value[2]) && dense(value[3])
    ? value as [1, number, unknown[], unknown[]] : null;
}
export function parseSinglePlayerCloudMutationWire(value: unknown): SinglePlayerCloudMutationWire | null {
  if (!dense(value)) return null;
  if (value.length === 2 && value[0] === 4 && timestamp(value[1])) return value as [4, number];
  if (value.length === 4 && value[0] === 7 && singlePlayerCloudNumber(value[1], 1, SINGLE_PLAYER_CLOUD_MAX_REVISION)
    && (value[2] === 0 || value[2] === 1) && timestamp(value[3])) return value as [7, string, 0 | 1, number];
  if (value.length !== 3 || !timestamp(value[2])) return null;
  if ((value[0] === 1 || value[0] === 8)
    && singlePlayerCloudNumber(value[1], 1, SINGLE_PLAYER_CLOUD_MAX_REVISION - 1)
    || value[0] === 2 && singlePlayerCloudNumber(value[1], 0, SINGLE_PLAYER_CLOUD_MAX_REVISION - 1)) {
    return value as [1 | 2 | 8, string, number];
  }
  if ((value[0] === 3 && (value[1] === "cloud_capacity" || value[1] === "world_limit"
    || value[1] === "tombstone_capacity"))
    || (value[0] === 5 && typeof value[1] === "string" && value[1].length > 0 && value[1].length <= 64)) {
    return value as [3 | 5, string, number];
  }
  return value[0] === 6 && Number.isSafeInteger(value[1]) && Number(value[1]) > 0
    && Number(value[1]) <= SINGLE_PLAYER_CLOUD_MAX_TIMESTAMP
    ? value as [6, number, number] : null;
}
export function parseSinglePlayerCloudBackupWire(value: unknown): SinglePlayerCloudBackupWire | null {
  if (!Array.isArray(value) || value.length !== 10 || value[0] !== 1
    || typeof value[1] !== "string" || !SINGLE_PLAYER_CLOUD_WORLD_ID.test(value[1])
    || typeof value[2] !== "string" || value[2].length < 1 || value[2].length > 48
    || value[2] !== value[2].trim().replace(/\s+/g, " ") || /[\u0000-\u001f\u007f]/.test(value[2])
    || !singlePlayerCloudNumber(value[3], -2_147_483_648, 2_147_483_647)
    || value[4] !== "survival" && value[4] !== "creative"
    || !singlePlayerCloudNumber(value[5], 0, SINGLE_PLAYER_CLOUD_MAX_TIMESTAMP)
    || typeof value[6] !== "string" || !SINGLE_PLAYER_CLOUD_HASH.test(value[6])
    || typeof value[7] !== "string" || value[7].length < 1 || value[7].length > MAX_SNAPSHOT || singlePlayerSaveChecksum(value[7]) !== value[6]
    || !singlePlayerCloudNumber(value[8], 1, SINGLE_PLAYER_CLOUD_MAX_REVISION)
    || !singlePlayerCloudNumber(value[9], 0, SINGLE_PLAYER_CLOUD_MAX_TIMESTAMP)) return null;
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
  if (value.length === 2 && value[0] === 2
    && singlePlayerCloudNumber(value[1], 1, SINGLE_PLAYER_CLOUD_MAX_REVISION)) return value as unknown as SinglePlayerCloudDescriptor;
  if (value.length === 3 && value[0] === 3 && typeof value[1] === "string"
    && SINGLE_PLAYER_CLOUD_WORLD_ID.test(value[1])
    && singlePlayerCloudNumber(value[2], 0, SINGLE_PLAYER_CLOUD_MAX_REVISION)) return value as unknown as SinglePlayerCloudDescriptor;
  return value.length === 5 && value[0] === 1 && typeof value[1] === "string"
    && SINGLE_PLAYER_CLOUD_WORLD_ID.test(value[1])
    && singlePlayerCloudNumber(value[2], 1, SINGLE_PLAYER_CLOUD_MAX_REVISION)
    && singlePlayerCloudNumber(value[3], 0, SINGLE_PLAYER_CLOUD_MAX_REVISION)
    && singlePlayerCloudNumber(value[4], 0, SINGLE_PLAYER_CLOUD_MAX_TIMESTAMP)
    ? value as unknown as SinglePlayerCloudDescriptor : null;
}

/** Preserves only the server's bounded delete descriptor for an unreconstructable world. */
export function parseServerQuarantinedSinglePlayerCloudBackup(value: unknown):
  QuarantinedSinglePlayerCloudBackup | null {
  return dense(value) && value.length === 2 && typeof value[0] === "string"
    && SINGLE_PLAYER_CLOUD_WORLD_ID.test(value[0])
    && singlePlayerCloudNumber(value[1], 0, SINGLE_PLAYER_CLOUD_MAX_REVISION)
    ? value as unknown as QuarantinedSinglePlayerCloudBackup : null;
}

/** Cloud bytes remain quarantined until both transport and the complete local journal schema validate. */
function validateRestorableSinglePlayerCloudBackup(value: unknown):
  readonly [SinglePlayerCloudBackupWire, SinglePlayerSaveEnvelope | null] | null {
  const wire = parseSinglePlayerCloudBackupWire(value);
  if (!wire) return null;
  const parsed = parseSinglePlayerSaveEnvelope(wire[7], wire[1]);
  return [wire, parsed.ok && parsed.envelope.payload.world.seed === Number(wire[3])
    && parsed.envelope.payload.world.createdAt === Number(wire[5])
    && (parsed.envelope.payload.world.gameMode === undefined || parsed.envelope.payload.world.gameMode === wire[4])
    ? parsed.envelope : null];
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
  const [wire, envelope] = parsed;
  return restoreMissingLocalWorld(storage, {
    worldId: wire[1], name: wire[2], seed: Number(wire[3]), gameMode: wire[4], createdAt: Number(wire[5]),
    snapshot: envelope.payload, snapshotSavedAt: envelope.savedAt,
  });
}
