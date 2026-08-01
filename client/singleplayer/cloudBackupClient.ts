import {
  SINGLEPLAYER_SAVE_SLOT_A_KEY,
  SINGLEPLAYER_SAVE_SLOT_B_KEY,
  loadSinglePlayerSave,
  parseSinglePlayerSaveEnvelope,
  singlePlayerWorldStorageKey,
  type SinglePlayerStorageAdapter,
  type SinglePlayerSnapshot,
} from "./localSave.ts";
import {
  restoreMissingLocalWorld,
  type LocalWorldMutationResult,
  type LocalWorldRecord,
} from "./localWorldRegistry.ts";
import {
  parseSinglePlayerCloudBackupCommitRequest,
  parseSinglePlayerCloudBackupWire,
  type SinglePlayerCloudBackupWire,
} from "../../shared/singlePlayerCloudBackups.ts";

export type PreparedSinglePlayerCloudBackup = {
  requestJson: string;
  snapshotJson: string;
  sequence: number;
  savedAt: number;
};

/** Reads one already-committed journal slot twice and uploads only those exact, locally validated bytes. */
export function prepareSinglePlayerCloudBackup(
  storage: SinglePlayerStorageAdapter,
  world: LocalWorldRecord,
  expectedRevision: string,
): { ok: true; backup: PreparedSinglePlayerCloudBackup }
  | { ok: false; reason: "local_save_unavailable" | "readback_drift" | "invalid_local_save" } {
  const loaded = loadSinglePlayerSave(storage, { migrateLegacy: false, worldId: world.id });
  if ((loaded.status !== "loaded" && loaded.status !== "recovered") || !loaded.slot) {
    return { ok: false, reason: "local_save_unavailable" };
  }
  const key = singlePlayerWorldStorageKey(world.id,
    loaded.slot === "a" ? SINGLEPLAYER_SAVE_SLOT_A_KEY : SINGLEPLAYER_SAVE_SLOT_B_KEY);
  let first: string | null;
  let second: string | null;
  try {
    first = storage.getItem(key);
    second = storage.getItem(key);
  } catch {
    return { ok: false, reason: "local_save_unavailable" };
  }
  if (first === null || second !== first) return { ok: false, reason: "readback_drift" };
  const parsed = parseSinglePlayerSaveEnvelope(first, world.id);
  if (!parsed.ok || parsed.envelope.sequence !== loaded.sequence || parsed.envelope.savedAt !== loaded.savedAt
    || parsed.envelope.payload.world.seed !== world.seed
    || parsed.envelope.payload.world.createdAt !== world.createdAt
    || (parsed.envelope.payload.world.gameMode !== undefined
      && parsed.envelope.payload.world.gameMode !== world.initialGameMode)) {
    return { ok: false, reason: "invalid_local_save" };
  }
  const confirmed = loadSinglePlayerSave(storage, { migrateLegacy: false, worldId: world.id });
  let confirmedRaw: string | null;
  try { confirmedRaw = storage.getItem(key); } catch { return { ok: false, reason: "local_save_unavailable" }; }
  if ((confirmed.status !== "loaded" && confirmed.status !== "recovered") || confirmed.slot !== loaded.slot
    || confirmed.sequence !== loaded.sequence || confirmed.savedAt !== loaded.savedAt || confirmedRaw !== first) {
    return { ok: false, reason: "readback_drift" };
  }
  const requestJson = JSON.stringify([1, world.id, world.name, world.seed, world.initialGameMode,
    world.createdAt, expectedRevision, first]);
  if (!parseSinglePlayerCloudBackupCommitRequest(requestJson).ok) {
    return { ok: false, reason: "invalid_local_save" };
  }
  return { ok: true, backup: { requestJson, snapshotJson: first, sequence: loaded.sequence, savedAt: loaded.savedAt } };
}

export type RestorableSinglePlayerCloudBackup = {
  wire: SinglePlayerCloudBackupWire;
  snapshot: SinglePlayerSnapshot;
  snapshotSavedAt: number;
};

export type QuarantinedSinglePlayerCloudBackup = {
  worldId: string;
  name: string;
  seed: number;
  gameMode: "survival" | "creative";
  worldCreatedAt: number;
  revision: string;
  uploadedAt: number;
  deleteRequestJson: string;
};

export type ServerQuarantinedSinglePlayerCloudBackup = {
  worldId: string;
  status: "corrupt";
  expectedRevision: string;
  deleteRequestJson: string;
};

/** Preserves only the server's bounded delete descriptor for an unreconstructable world. */
export function parseServerQuarantinedSinglePlayerCloudBackup(value: unknown):
  ServerQuarantinedSinglePlayerCloudBackup | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const keys = Object.keys(row).sort();
  if (keys.join(",") !== "deleteRequestJson,expectedRevision,status,worldId"
    || row.status !== "corrupt" || typeof row.worldId !== "string"
    || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(row.worldId)
    || typeof row.expectedRevision !== "string" || !/^(?:0|[1-9][0-9]{0,15})$/.test(row.expectedRevision)
    || Number(row.expectedRevision) > Number.MAX_SAFE_INTEGER || typeof row.deleteRequestJson !== "string"
    || row.deleteRequestJson !== JSON.stringify([1, row.worldId, row.expectedRevision])) return null;
  return row as unknown as ServerQuarantinedSinglePlayerCloudBackup;
}

function quarantinedDescriptor(wire: SinglePlayerCloudBackupWire): QuarantinedSinglePlayerCloudBackup {
  return {
    worldId: wire[1], name: wire[2], seed: Number(wire[3]), gameMode: wire[4],
    worldCreatedAt: Number(wire[5]), revision: wire[8], uploadedAt: Number(wire[9]),
    deleteRequestJson: JSON.stringify([1, wire[1], wire[8]]),
  };
}

/** Cloud bytes remain quarantined until both transport and the complete local journal schema validate. */
export function parseRestorableSinglePlayerCloudBackup(value: unknown):
  | { ok: true; backup: RestorableSinglePlayerCloudBackup }
  | { ok: false; reason: "backup_quarantined"; quarantine?: QuarantinedSinglePlayerCloudBackup } {
  const transport = parseSinglePlayerCloudBackupWire(value);
  if (!transport.ok) return { ok: false, reason: "backup_quarantined" };
  const parsed = parseSinglePlayerSaveEnvelope(transport.wire[7], transport.wire[1]);
  if (!parsed.ok || parsed.envelope.payload.world.seed !== Number(transport.wire[3])
    || parsed.envelope.payload.world.createdAt !== Number(transport.wire[5])
    || (parsed.envelope.payload.world.gameMode !== undefined
      && parsed.envelope.payload.world.gameMode !== transport.wire[4])) {
    return { ok: false, reason: "backup_quarantined", quarantine: quarantinedDescriptor(transport.wire) };
  }
  return { ok: true, backup: { wire: transport.wire, snapshot: parsed.envelope.payload,
    snapshotSavedAt: parsed.envelope.savedAt } };
}

/** Explicit restore delegates to the registry's stable-empty, crash-recoverable transaction. */
export function restoreSinglePlayerCloudBackup(
  storage: SinglePlayerStorageAdapter,
  value: unknown,
): LocalWorldMutationResult {
  const parsed = parseRestorableSinglePlayerCloudBackup(value);
  if (!parsed.ok) return { ok: false, reason: parsed.reason, mutationStarted: false };
  const { wire, snapshot, snapshotSavedAt } = parsed.backup;
  return restoreMissingLocalWorld(storage, {
    worldId: wire[1], name: wire[2], seed: Number(wire[3]), gameMode: wire[4], createdAt: Number(wire[5]),
    snapshot, snapshotSavedAt,
  });
}
