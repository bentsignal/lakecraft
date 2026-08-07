import type { LocalGameMode } from "./localCommands.ts";
import {
  SINGLEPLAYER_WORLD_SAVE_MAX_SLOT_CHARS,
  canonicalSinglePlayerJson,
  createDefaultSinglePlayerSnapshot,
  loadSinglePlayerSave,
  saveSinglePlayerSnapshot,
  singlePlayerSaveChecksum,
  singlePlayerWorldStorageKey,
  singlePlayerWorldStorageKeys,
  type SinglePlayerStorageAdapter,
} from "./localSave.ts";

export const LOCAL_WORLD_REGISTRY_FORMAT = "lakecraft.local-world-registry" as const;
export const LOCAL_WORLD_REGISTRY_VERSION = 4 as const;
export const LOCAL_WORLD_REGISTRY_SLOT_A_KEY = "lakecraft.singleplayer.worlds.a";
export const LOCAL_WORLD_REGISTRY_SLOT_B_KEY = "lakecraft.singleplayer.worlds.b";
export const LOCAL_WORLD_TRANSACTION_LEASE_MS = 5_000;
export const LOCAL_WORLD_REGISTRY_MAX_WORLDS = 6;
export const LOCAL_WORLD_REGISTRY_MAX_CHARS = 32_000;
export const LOCAL_WORLD_NAME_MAX_CHARS = 48;
export const LOCAL_WORLD_NAMESPACE_BUDGET_CHARS = SINGLEPLAYER_WORLD_SAVE_MAX_SLOT_CHARS * 2
  + Math.ceil(LOCAL_WORLD_REGISTRY_MAX_CHARS * 2 / LOCAL_WORLD_REGISTRY_MAX_WORLDS)
  + 2_048;
export const LOCAL_WORLD_CAPACITY_WARNING_CHARS = Math.floor(LOCAL_WORLD_NAMESPACE_BUDGET_CHARS * 0.8);

const MAX_TIMESTAMP = 8_640_000_000_000_000;
const TRANSACTION_RECOVERY_PENDING = "transaction:recovery_pending";

export interface LocalWorldRecord {
  id: string;
  name: string;
  seed: number;
  initialGameMode: LocalGameMode;
  createdAt: number;
  lastPlayedAt: number;
}

export interface LocalWorldRegistry {
  worlds: LocalWorldRecord[];
}

export interface LocalWorldRegistryEnvelope {
  checksum: string;
  format: typeof LOCAL_WORLD_REGISTRY_FORMAT;
  payload: LocalWorldRegistry;
  savedAt: number;
  sequence: number;
  version: typeof LOCAL_WORLD_REGISTRY_VERSION;
}

export type LocalWorldRegistryLoadResult =
  | { status: "empty"; registry: LocalWorldRegistry; sequence: 0; issues: string[] }
  | { status: "loaded" | "recovered"; registry: LocalWorldRegistry; sequence: number; issues: string[] }
  | { status: "corrupt"; registry: null; sequence: 0; issues: string[] }
  | { status: "unsupported"; registry: null; sequence: 0; versions: number[]; issues: string[] };

export type LocalWorldRegistrySaveResult =
  | { ok: true; registry: LocalWorldRegistry; sequence: number; slot: "a" | "b" }
  | {
    ok: false;
    /** True once setItem was attempted; a thrown result or failed readback may still be durable. */
    mutationStarted: boolean;
    reason: "invalid_registry" | "too_large" | "storage_read_failed" | "storage_write_failed" | "readback_failed" | "stale_registry" | "unsafe_existing_data";
  };

export type LocalWorldMutationResult =
  | { ok: true; world: LocalWorldRecord; registry: LocalWorldRegistry }
  | { ok: false; reason: string; mutationStarted: boolean };

function failure<R extends string>(reason: R, mutationStarted = false) {
  return { ok: false as const, reason, mutationStarted };
}

export type LocalWorldHealth = "ready" | "healthy" | "recovered" | "corrupt" | "unsupported";
export type LocalWorldCapacity = "ok" | "warning" | "exceeded" | "unavailable";

export interface LocalWorldInspection {
  world: LocalWorldRecord;
  health: LocalWorldHealth;
  capacity: LocalWorldCapacity;
  usedChars: number;
  gameMode: LocalGameMode;
  lastSavedAt: number | null;
  load: SinglePlayerLoadResult;
}

export function canPlayLocalWorld(world: LocalWorldInspection): boolean {
  return world.health !== "corrupt"
    && world.health !== "unsupported"
    && world.capacity !== "exceeded";
}

export function isLocalWorldRegistryTransactionReadOnly(load: LocalWorldRegistryLoadResult): boolean {
  return hasPendingNamespaceRecovery(load.issues);
}

/**
 * Updating last-played metadata is useful but not a prerequisite for reading an
 * already verified world. Only the exact pre-mutation recovery gate may fall
 * back after stable read-only registry and namespace revalidation.
 */
export function resolveLocalWorldPlay(
  storage: SinglePlayerStorageAdapter,
  selected: LocalWorldInspection,
  touch: LocalWorldMutationResult,
): LocalWorldRecord | null {
  if (touch.ok) return touch.world;
  if (touch.reason !== "world_touch_recovery_pending"
    || touch.mutationStarted !== false
    || !canPlayLocalWorld(selected)) return null;
  const before = scanRegistryState(storage);
  if (!before || pendingDeletesWorld(before[5], selected.world.id)) return null;
  const current = before[3].worlds.find(({ id }) => id === selected.world.id);
  if (!current || !sameWorld(current, selected.world)) return null;
  const firstValues = readWorldValues(storage, current.id);
  if (!firstValues) return null;
  const firstInspection = inspectLocalWorld(storage, current);
  if (!isReadOnlyFallbackPlayable(firstInspection)) return null;
  const after = scanRegistryState(storage);
  if (!after || after[2] !== before[2] || pendingDeletesWorld(after[5], current.id)) return null;
  const verified = after[3].worlds.find(({ id }) => id === current.id);
  if (!verified || !sameWorld(verified, current)) return null;
  const secondValues = readWorldValues(storage, verified.id);
  if (!secondValues || !sameStrings(firstValues, secondValues)) return null;
  return verified;
}

function isReadOnlyFallbackPlayable(world: LocalWorldInspection): boolean {
  return (world.health === "healthy" || world.health === "recovered")
    && (world.capacity === "ok" || world.capacity === "warning")
    && world.load.snapshot?.world.worldId === world.world.id;
}

function readWorldValues(storage: SinglePlayerStorageAdapter, worldId: string): Array<string | null> | null {
  try {
    return singlePlayerWorldStorageKeys(worldId).map((key) => storage.getItem(key));
  } catch {
    return null;
  }
}

type ParsedRegistrySlot =
  | [0, 0 | 1]
  | [1, 0 | 1, string, LocalWorldRegistry, number, LocalWorldPendingTransaction | null]
  | [2, 0 | 1, string]
  | [3, 0 | 1, number];

type LocalWorldPendingTransaction =
  | [0, number, number, LocalWorldRecord]
  | [1, number, number, number, LocalWorldRecord];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function safeInteger(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function timestamp(value: number): number {
  return Math.max(0, Math.min(MAX_TIMESTAMP, Math.floor(value)));
}

export function normalizeLocalWorldName(value: string): string | null {
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length >= 1 && normalized.length <= LOCAL_WORLD_NAME_MAX_CHARS
    && !/[\u0000-\u001f\u007f]/.test(normalized)
    ? normalized
    : null;
}

export type LocalWorldListNavigationKey = "ArrowDown" | "ArrowUp" | "Home" | "End";

export function reconcileLocalWorldSelection(
  selectedId: string | null,
  visibleWorldIds: readonly string[],
): string | null {
  return selectedId && visibleWorldIds.includes(selectedId) ? selectedId : null;
}

export function moveLocalWorldSelection(
  selectedId: string | null,
  visibleWorldIds: readonly string[],
  key: LocalWorldListNavigationKey,
): string | null {
  if (visibleWorldIds.length === 0) return null;
  if (key === "Home") return visibleWorldIds[0];
  if (key === "End") return visibleWorldIds[visibleWorldIds.length - 1];
  const index = selectedId ? visibleWorldIds.indexOf(selectedId) : -1;
  if (key === "ArrowDown") return index < 0
    ? visibleWorldIds[0]
    : visibleWorldIds[Math.min(visibleWorldIds.length - 1, index + 1)];
  return index < 0
    ? visibleWorldIds[visibleWorldIds.length - 1]
    : visibleWorldIds[Math.max(0, index - 1)];
}

function validWorldId(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 64
    && /^[a-z0-9][a-z0-9-]*$/.test(value);
}

function validateWorldRecord(value: unknown): LocalWorldRecord | null {
  if (!isRecord(value)
    || !exactKeys(value, ["id", "name", "seed", "initialGameMode", "createdAt", "lastPlayedAt"])
    || !validWorldId(value.id)
    || typeof value.name !== "string" || normalizeLocalWorldName(value.name) !== value.name
    || !safeInteger(value.seed, -2_147_483_648, 2_147_483_647)
    || (value.initialGameMode !== "survival" && value.initialGameMode !== "creative")
    || !safeInteger(value.createdAt, 0, MAX_TIMESTAMP)
    || (!safeInteger(value.lastPlayedAt, value.createdAt, MAX_TIMESTAMP) && value.lastPlayedAt !== 0)) return null;
  return {
    id: value.id,
    name: value.name,
    seed: value.seed,
    initialGameMode: value.initialGameMode,
    createdAt: value.createdAt,
    lastPlayedAt: value.lastPlayedAt,
  };
}

export function validateLocalWorldRegistry(value: unknown): LocalWorldRegistry | null {
  if (!isRecord(value) || !exactKeys(value, ["worlds"])
    || !Array.isArray(value.worlds) || value.worlds.length > LOCAL_WORLD_REGISTRY_MAX_WORLDS) return null;
  const worlds: LocalWorldRecord[] = [];
  const ids = new Set<string>();
  for (const candidate of value.worlds) {
    const world = validateWorldRecord(candidate);
    if (!world || ids.has(world.id)) return null;
    ids.add(world.id);
    worlds.push(world);
  }
  return { worlds: worlds.sort((left, right) => left.id.localeCompare(right.id)) };
}

function registryBody(
  payload: LocalWorldRegistry,
  sequence: number,
  savedAt: number,
  pending: LocalWorldPendingTransaction | null,
): [number, number, number, LocalWorldRecord[], LocalWorldPendingTransaction | null] {
  return [LOCAL_WORLD_REGISTRY_VERSION, sequence, savedAt, payload.worlds, pending];
}

function serializeRegistry(
  value: LocalWorldRegistry,
  sequence: number,
  savedAt: number,
  pending: LocalWorldPendingTransaction | null,
): [LocalWorldRegistry, number, string] | "invalid_registry" | "too_large" {
  const registry = validateLocalWorldRegistry(value);
  if (!registry || !safeInteger(sequence, 1, Number.MAX_SAFE_INTEGER) || !safeInteger(savedAt, 0, MAX_TIMESTAMP)) {
    return "invalid_registry";
  }
  const body = registryBody(registry, sequence, savedAt, pending);
  const checksum = singlePlayerSaveChecksum(body);
  const raw = canonicalSinglePlayerJson([body[0], checksum, ...body.slice(1)]);
  return raw.length <= (pending ? SINGLEPLAYER_WORLD_SAVE_MAX_SLOT_CHARS * 10 : LOCAL_WORLD_REGISTRY_MAX_CHARS)
    ? [registry, sequence, raw]
    : "too_large";
}

function registrySlotKey(slot: 0 | 1): string {
  return slot ? LOCAL_WORLD_REGISTRY_SLOT_B_KEY : LOCAL_WORLD_REGISTRY_SLOT_A_KEY;
}

function parsePending(value: unknown): LocalWorldPendingTransaction | null {
  if (!Array.isArray(value) || (value.length !== 4 && value.length !== 5)
    || (value[0] !== 0 && value[0] !== 1)
    || !safeInteger(value[1], 1, Number.MAX_SAFE_INTEGER)
    || !safeInteger(value[2], 0, MAX_TIMESTAMP)) return null;
  const type = value[0];
  const deletedAt = value[3];
  const world = validateWorldRecord(value[type ? 4 : 3]);
  if (!world || (type
    ? value.length !== 5 || !safeInteger(deletedAt, 0, MAX_TIMESTAMP)
    : value.length !== 4)) return null;
  const recoverAfter = Math.min(
    MAX_TIMESTAMP,
    (type ? deletedAt as number : world.createdAt) + LOCAL_WORLD_TRANSACTION_LEASE_MS,
  );
  if (value[2] !== recoverAfter) return null;
  return type
    ? [1, value[1], recoverAfter, deletedAt as number, world]
    : [0, value[1], recoverAfter, world];
}

function makePending(
  type: 0 | 1,
  generation: number,
  world: LocalWorldRecord,
  deletedAt?: number,
): LocalWorldPendingTransaction {
  const recoverAfter = Math.min(
    MAX_TIMESTAMP,
    (type ? deletedAt! : world.createdAt) + LOCAL_WORLD_TRANSACTION_LEASE_MS,
  );
  return type
    ? [1, generation, recoverAfter, deletedAt!, world]
    : [0, generation, recoverAfter, world];
}

function parseRegistrySlot(slot: 0 | 1, raw: string | null): ParsedRegistrySlot {
  if (raw === null) return [0, slot];
  if (raw.length === 0 || raw.length > SINGLEPLAYER_WORLD_SAVE_MAX_SLOT_CHARS * 10) return [2, slot, "invalid_size"];
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return [2, slot, "invalid_json"];
  }
  if (Array.isArray(value) && typeof value[0] === "number"
    && Number.isSafeInteger(value[0]) && value[0] !== LOCAL_WORLD_REGISTRY_VERSION) {
    return [3, slot, value[0]];
  }
  if (!Array.isArray(value) || value.length !== 6
    || value[0] !== LOCAL_WORLD_REGISTRY_VERSION
    || typeof value[1] !== "string" || !/^[0-9a-f]{8}$/.test(value[1])
    || !safeInteger(value[2], 1, Number.MAX_SAFE_INTEGER)
    || !safeInteger(value[3], 0, MAX_TIMESTAMP)) {
    return [2, slot, "invalid_envelope"];
  }
  const registry = validateLocalWorldRegistry({ worlds: value[4] });
  if (!registry) return [2, slot, "invalid_registry"];
  const pending = value[5] === null ? null : parsePending(value[5]);
  if (value[5] !== null && (!pending || pending[1] !== value[2])) return [2, slot, "invalid_registry"];
  const body = registryBody(registry, value[2], value[3], pending);
  if (singlePlayerSaveChecksum(body) !== value[1]) return [2, slot, "checksum_mismatch"];
  if (canonicalSinglePlayerJson([body[0], value[1], ...body.slice(1)]) !== raw) {
    return [2, slot, "noncanonical_envelope"];
  }
  return [1, slot, raw, registry, value[2], pending];
}

function readRegistrySlots(storage: SinglePlayerStorageAdapter, cleanup = false): [ParsedRegistrySlot[], boolean] {
  const slots: ParsedRegistrySlot[] = [];
  const raw: Array<string | null> = [];
  let readFailed = false;
  for (const slot of [0, 1] as const) {
    try {
      raw[slot] = storage.getItem(registrySlotKey(slot));
      slots.push(parseRegistrySlot(slot, raw[slot]));
    } catch {
      readFailed = true;
      raw[slot] = null;
      slots.push([2, slot, "storage_read_failed"]);
    }
  }
  if (cleanup && !readFailed && !slots.some((slot) => slot[0] === 1)) {
    try {
      for (let slot = 0 as 0 | 1; slot < 2; slot += 1) {
        if (slots[slot][0] < 2) continue;
        const key = registrySlotKey(slot);
        if (storage.getItem(key) !== raw[slot]) throw 0;
        storage.removeItem?.(key);
        if (storage.getItem(key) !== null) throw 0;
        slots[slot] = [0, slot];
      }
    } catch {}
  }
  return [slots, readFailed];
}

function highestRegistrySlot(slots: readonly ParsedRegistrySlot[]): Extract<ParsedRegistrySlot, [1, ...unknown[]]> | null {
  return slots
    .filter((slot): slot is Extract<ParsedRegistrySlot, [1, ...unknown[]]> => slot[0] === 1)
    .sort((left, right) => right[4] - left[4] || left[1] - right[1])[0] ?? null;
}

function hasRegistryGenerationConflict(slots: readonly ParsedRegistrySlot[]): boolean {
  const valid = slots
    .filter((slot): slot is Extract<ParsedRegistrySlot, [1, ...unknown[]]> => slot[0] === 1)
    .sort((left, right) => right[4] - left[4]);
  return valid.length > 1
    && valid[0][4] === valid[1][4]
    && valid[0][2] !== valid[1][2];
}

type ValidRegistrySlot = Extract<ParsedRegistrySlot, [1, ...unknown[]]>;

function loadRegistryState(
  storage: SinglePlayerStorageAdapter,
  cleanup = false,
): [LocalWorldRegistryLoadResult, ValidRegistrySlot | null] {
  const scanned = readRegistrySlots(storage, cleanup);
  const issues = scanned[0].flatMap((slot) => slot[0] === 2 ? [`${slot[1] ? "b" : "a"}:${slot[2]}`]
    : slot[0] === 3 ? [`${slot[1] ? "b" : "a"}:unsupported_v${slot[2]}`] : []);
  const unsupported = scanned[0].filter((slot): slot is Extract<ParsedRegistrySlot, [3, ...unknown[]]> => slot[0] === 3);
  if (unsupported.length) {
    return [{
      status: "unsupported",
      registry: null,
      sequence: 0,
      versions: [...new Set(unsupported.map((slot) => slot[2]))].sort((a, b) => a - b),
      issues,
    }, null];
  }
  if (hasRegistryGenerationConflict(scanned[0])) {
    return [{
      status: "corrupt",
      registry: null,
      sequence: 0,
      issues: [...issues, "registry:generation_conflict"],
    }, null];
  }
  const selected = highestRegistrySlot(scanned[0]);
  if (selected) {
    return [{
      status: issues.length > 0 ? "recovered" : "loaded",
      registry: selected[3],
      sequence: selected[4],
      issues,
    }, selected];
  }
  if (scanned[1] || scanned[0].some((slot) => slot[0] === 2)) {
    return [{ status: "corrupt", registry: null, sequence: 0, issues }, null];
  }
  return [{ status: "empty", registry: { worlds: [] }, sequence: 0, issues: [] }, null];
}

function scanRegistryState(storage: SinglePlayerStorageAdapter): ValidRegistrySlot | null {
  const [first, selected] = loadRegistryState(storage);
  if (first.status !== "loaded" || !selected) return null;
  const [second, verified] = loadRegistryState(storage);
  return second.status === "loaded"
    && verified?.[1] === selected[1] && verified[2] === selected[2]
    ? verified
    : null;
}

function sameStrings(left: readonly (string | null)[], right: readonly (string | null)[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function storageRemover(storage: SinglePlayerStorageAdapter): ((key: string) => void) | null {
  try {
    const removeItem = storage.removeItem;
    return typeof removeItem === "function" ? removeItem.bind(storage) : null;
  } catch {
    return null;
  }
}

function sameWorld(left: LocalWorldRecord, right: LocalWorldRecord): boolean {
  return canonicalSinglePlayerJson(left) === canonicalSinglePlayerJson(right);
}

function sameWorldIdentity(left: LocalWorldRecord, right: LocalWorldRecord): boolean {
  return left.id === right.id
    && left.name === right.name
    && left.seed === right.seed
    && left.initialGameMode === right.initialGameMode
    && left.createdAt === right.createdAt;
}

function pendingDeletesWorld(pending: LocalWorldPendingTransaction | null, worldId: string): boolean {
  return pending?.[0] === 1 && pending[4].id === worldId;
}

function samePending(
  left: LocalWorldPendingTransaction | null,
  right: LocalWorldPendingTransaction | null,
): boolean {
  return canonicalSinglePlayerJson(left) === canonicalSinglePlayerJson(right);
}

function withRecoveryIssue(
  loaded: LocalWorldRegistryLoadResult,
  issue: string,
): LocalWorldRegistryLoadResult {
  const issues = [...loaded.issues, issue];
  if (!loaded.registry) return { ...loaded, issues };
  return { status: "recovered", registry: loaded.registry, sequence: loaded.sequence, issues };
}

function hasPendingNamespaceRecovery(issues: readonly string[]): boolean {
  return issues.some((issue) => issue.startsWith("transaction:")
    || issue.endsWith(":recovery_pending"));
}

export function loadLocalWorldRegistry(
  storage: SinglePlayerStorageAdapter,
  observedAt = Date.now(),
): LocalWorldRegistryLoadResult {
  const recoveryAt = timestamp(observedAt);
  const [loaded, slot] = loadRegistryState(storage, true);
  const pending = slot?.[5];
  if (!pending) return loaded;
  if (recoveryAt < pending[2]) return withRecoveryIssue(loaded, "transaction:active");
  if (!loaded.registry || !slot) return withRecoveryIssue(loaded, TRANSACTION_RECOVERY_PENDING);
  const pendingRaw = mirrorPending(storage, slot[4], pending);
  if (!pendingRaw) return withRecoveryIssue(loaded, TRANSACTION_RECOVERY_PENDING);

  const type = pending[0] ? "delete" : "create";
  const world = pending[pending[0] ? 4 : 3] as LocalWorldRecord;
  const registered = loaded.registry.worlds.find(({ id }) => id === world.id);
  let completed = "invalid_transaction_cleared";
  const removeItem = storageRemover(storage);
  try {
    if (!pending[0]) {
      if (!registered) {
        if (!removeItem) throw new Error();
        for (const key of singlePlayerWorldStorageKeys(world.id)) {
          if (!ownsMirroredPending(storage, pendingRaw)) throw new Error();
          removeItem(key);
          if (!ownsMirroredPending(storage, pendingRaw)) throw new Error();
        }
        const values = readWorldValues(storage, world.id);
        if (!values || values.some((value) => value !== null)) throw new Error();
        completed = "cleanup_completed";
      } else if (sameWorld(registered, world)) {
        const created = loadSinglePlayerSave(storage, { worldId: world.id });
        if (!created.snapshot || created.snapshot.world.worldId !== world.id
          || created.snapshot.world.gameMode !== world.initialGameMode) throw new Error();
        completed = "commit_completed";
      }
    } else if (!registered) {
      if (!removeItem) throw new Error();
      for (const key of singlePlayerWorldStorageKeys(world.id)) {
        if (!ownsMirroredPending(storage, pendingRaw)) throw new Error();
        removeItem(key);
        if (!ownsMirroredPending(storage, pendingRaw)) throw new Error();
      }
      const values = readWorldValues(storage, world.id);
      if (!values || values.some((value) => value !== null)) throw new Error();
      completed = "cleanup_completed";
    }
  } catch {
    return withRecoveryIssue(loaded, `${type}:recovery_pending`);
  }
  if (!ownsMirroredPending(storage, pendingRaw)) {
    return withRecoveryIssue(loaded, `${type}:recovery_pending`);
  }
  const cleared = saveRegistryState(
    storage,
    loaded.registry,
    recoveryAt,
    slot[4],
    null,
    pending,
  );
  return cleared.ok
    ? {
      status: "recovered",
      registry: cleared.registry,
      sequence: cleared.sequence,
      issues: [...loaded.issues, `${type}:${completed}`],
    }
    : withRecoveryIssue(loaded, `${type}:recovery_pending`);
}

function saveRegistryState(
  storage: SinglePlayerStorageAdapter,
  registry: LocalWorldRegistry,
  savedAt: number,
  expectedSequence: number | undefined,
  pending: LocalWorldPendingTransaction | null,
  expectedPending: LocalWorldPendingTransaction | null,
): LocalWorldRegistrySaveResult {
  const scanned = readRegistrySlots(storage);
  const current = highestRegistrySlot(scanned[0]);
  if (scanned[1]) return failure("storage_read_failed");
  if (scanned[0].some((slot) => slot[0] === 3)
    || hasRegistryGenerationConflict(scanned[0])
    || (!current && scanned[0].some((slot) => slot[0]))) {
    return failure("unsafe_existing_data");
  }
  if (expectedSequence !== undefined && (current?.[4] ?? 0) !== expectedSequence) {
    return failure("stale_registry");
  }
  if (!samePending(current?.[5] ?? null, expectedPending)) return failure("stale_registry");
  const serialized = serializeRegistry(registry, (current?.[4] ?? 0) + 1, savedAt, pending);
  if (typeof serialized === "string") return failure(serialized);
  const target: 0 | 1 = current ? (current[1] ? 0 : 1) : 0;
  try {
    storage.setItem(registrySlotKey(target), serialized[2]);
  } catch {
    return failure("storage_write_failed", true);
  }
  let readback: string | null;
  try {
    readback = storage.getItem(registrySlotKey(target));
  } catch {
    return failure("readback_failed", true);
  }
  const verified = parseRegistrySlot(target, readback);
  if (readback !== serialized[2] || verified[0] !== 1
    || verified[4] !== serialized[1]) {
    return failure("readback_failed", true);
  }
  const committed = readRegistrySlots(storage);
  const selected = highestRegistrySlot(committed[0]);
  const conflict = committed[0].some((slot) => slot[0] === 1
    && slot[4] >= serialized[1]
    && slot[2] !== serialized[2]);
  if (committed[1] || conflict || !selected
    || selected[1] !== target || selected[2] !== serialized[2]) {
    return failure("stale_registry", true);
  }
  return {
    ok: true,
    registry: serialized[0],
    sequence: serialized[1],
    slot: target ? "b" : "a",
  };
}

export function saveLocalWorldRegistry(
  storage: SinglePlayerStorageAdapter,
  registry: LocalWorldRegistry,
  savedAt = Date.now(),
  expectedSequence?: number,
): LocalWorldRegistrySaveResult {
  return saveRegistryState(storage, registry, savedAt, expectedSequence, null, null);
}

function ownsPending(
  storage: SinglePlayerStorageAdapter,
  sequence: number,
  pending: LocalWorldPendingTransaction,
): boolean {
  const selected = scanRegistryState(storage);
  return selected?.[4] === sequence && samePending(selected[5], pending);
}

function ownsMirroredPending(storage: SinglePlayerStorageAdapter, raw: string): boolean {
  try {
    for (let pass = 0; pass < 2; pass += 1) {
      if (storage.getItem(LOCAL_WORLD_REGISTRY_SLOT_A_KEY) !== raw
        || storage.getItem(LOCAL_WORLD_REGISTRY_SLOT_B_KEY) !== raw) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function stablePendingRaw(
  storage: SinglePlayerStorageAdapter,
  raw: string,
): ValidRegistrySlot | null {
  const [, first] = loadRegistryState(storage);
  if (first?.[2] !== raw || !first[5]) return null;
  const [, second] = loadRegistryState(storage);
  return second?.[1] === first[1] && second[2] === raw ? second : null;
}

function mirrorPending(
  storage: SinglePlayerStorageAdapter,
  sequence: number,
  pending: LocalWorldPendingTransaction,
): string | null {
  const current = loadRegistryState(storage)[1];
  if (current?.[4] !== sequence || !samePending(current[5], pending)) return null;
  const selected = stablePendingRaw(storage, current[2]);
  if (!selected) return null;
  try {
    storage.setItem(registrySlotKey(selected[1] ? 0 : 1), selected[2]);
  } catch {
    return null;
  }
  return ownsMirroredPending(storage, selected[2]) ? selected[2] : null;
}

export function deterministicLocalWorldSeed(value: string): number {
  const normalized = value.trim();
  if (/^-?\d+$/.test(normalized)) {
    const numeric = Number(normalized);
    if (Number.isSafeInteger(numeric) && numeric >= -2_147_483_648 && numeric <= 2_147_483_647) return numeric;
  }
  let hash = 0x811c9dc5;
  const source = normalized || "Lakecraft";
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash | 0;
}

function nextWorldId(registry: LocalWorldRegistry, seed: number, createdAt: number): string | null {
  const stem = `world-${createdAt.toString(36)}-${(seed >>> 0).toString(36)}`;
  const occupied = new Set(registry.worlds.map(({ id }) => id));
  for (let suffix = 0; suffix <= LOCAL_WORLD_REGISTRY_MAX_WORLDS; suffix += 1) {
    const id = suffix === 0 ? stem : `${stem}-${suffix.toString(36)}`;
    if (!occupied.has(id)) return id;
  }
  return null;
}

function persistNewLocalWorld(
  storage: SinglePlayerStorageAdapter,
  registry: LocalWorldRegistry,
  generation: number,
  input: { name: string; seed: number; gameMode: LocalGameMode; createdAt: number },
): LocalWorldMutationResult {
  const name = normalizeLocalWorldName(input.name);
  if (!name || !safeInteger(input.seed, -2_147_483_648, 2_147_483_647)
    || (input.gameMode !== "survival" && input.gameMode !== "creative")
    || !safeInteger(input.createdAt, 0, MAX_TIMESTAMP)) {
    return failure("invalid_world");
  }
  const replayed = registry.worlds.find((candidate) =>
    candidate.name === name
    && candidate.seed === input.seed
    && candidate.initialGameMode === input.gameMode
    && candidate.createdAt === input.createdAt);
  if (replayed) return { ok: true, world: replayed, registry };
  if (registry.worlds.length >= LOCAL_WORLD_REGISTRY_MAX_WORLDS) {
    return failure("world_limit_reached");
  }
  const id = nextWorldId(registry, input.seed, input.createdAt);
  if (!id) return failure("world_id_unavailable");
  const world: LocalWorldRecord = {
    id,
    name,
    seed: input.seed,
    initialGameMode: input.gameMode,
    createdAt: input.createdAt,
    lastPlayedAt: 0,
  };
  const pending = makePending(0, generation, world);
  const begun = saveRegistryState(storage, registry, input.createdAt, generation - 1, pending, null);
  if (!begun.ok) {
    return failure(
      begun.mutationStarted
        ? `registry_${begun.reason}_transaction_pending`
        : `registry_${begun.reason}`,
      begun.mutationStarted,
    );
  }
  if (!ownsPending(storage, begun.sequence, pending)) {
    return failure("world_create_transaction_pending", true);
  }
  if (!mirrorPending(storage, begun.sequence, pending)) {
    return failure("world_create_transaction_pending", true);
  }
  const snapshot = createDefaultSinglePlayerSnapshot(input.seed, input.createdAt, id);
  snapshot.world.gameMode = input.gameMode;
  const saved = saveSinglePlayerSnapshot(storage, snapshot, input.createdAt, { worldId: id });
  if (!saved.ok) return failure(`world_save_${saved.reason}_transaction_pending`, true);
  const nextRegistry = { worlds: [...registry.worlds, world] };
  const protectedPending = makePending(0, begun.sequence + 1, world);
  const protectedWrite = saveRegistryState(
    storage,
    nextRegistry,
    input.createdAt,
    begun.sequence,
    protectedPending,
    pending,
  );
  if (!protectedWrite.ok) {
    return failure(`registry_${protectedWrite.reason}_transaction_pending`, true);
  }
  if (!mirrorPending(storage, protectedWrite.sequence, protectedPending)) {
    return failure("world_create_transaction_pending", true);
  }
  const registryWrite = saveRegistryState(
    storage,
    nextRegistry,
    input.createdAt,
    protectedWrite.sequence,
    null,
    protectedPending,
  );
  if (!registryWrite.ok) {
    return failure(`registry_${registryWrite.reason}_transaction_pending`, true);
  }
  return { ok: true, world, registry: registryWrite.registry };
}

export function createLocalWorld(
  storage: SinglePlayerStorageAdapter,
  input: { name: string; seedText: string; gameMode: LocalGameMode; now?: number },
): LocalWorldMutationResult {
  const createdAt = timestamp(input.now ?? Date.now());
  const loaded = loadLocalWorldRegistry(storage, createdAt);
  if (!loaded.registry) return failure(`registry_${loaded.status}`);
  if (hasPendingNamespaceRecovery(loaded.issues)) {
    return failure("world_create_recovery_pending");
  }
  const name = normalizeLocalWorldName(input.name);
  const seed = deterministicLocalWorldSeed(input.seedText);
  const replayed = name ? loaded.registry.worlds.find((candidate) =>
    candidate.name === name
    && candidate.seed === seed
    && candidate.initialGameMode === input.gameMode
    && candidate.createdAt === createdAt) : null;
  if (replayed) return { ok: true, world: replayed, registry: loaded.registry };
  return persistNewLocalWorld(storage, loaded.registry, loaded.sequence + 1, {
    name: input.name,
    seed,
    gameMode: input.gameMode,
    createdAt,
  });
}

export function inspectLocalWorld(
  storage: SinglePlayerStorageAdapter,
  world: LocalWorldRecord,
  registryOverheadChars = 0,
): LocalWorldInspection {
  const load = loadSinglePlayerSave(storage, { worldId: world.id });
  let usedChars = Math.max(0, Math.floor(registryOverheadChars));
  let largestSlotChars = 0;
  let capacity: LocalWorldCapacity = "ok";
  try {
    for (const key of singlePlayerWorldStorageKeys(world.id)) {
      const raw = storage.getItem(key);
      if (raw === null) continue;
      usedChars += key.length + raw.length;
      if (key.endsWith(".save.a") || key.endsWith(".save.b")) {
        largestSlotChars = Math.max(largestSlotChars, raw.length);
      }
    }
    if (largestSlotChars > SINGLEPLAYER_WORLD_SAVE_MAX_SLOT_CHARS
      || usedChars > LOCAL_WORLD_NAMESPACE_BUDGET_CHARS) capacity = "exceeded";
    else if (usedChars >= LOCAL_WORLD_CAPACITY_WARNING_CHARS) capacity = "warning";
  } catch {
    capacity = "unavailable";
  }
  const health: LocalWorldHealth = load.status === "loaded" ? "healthy"
    : load.status === "recovered" ? "recovered"
      : load.status === "unsupported" ? "unsupported"
        : load.status === "corrupt" ? "corrupt"
          : "ready";
  if (load.status === "corrupt" && load.issues.some((issue) => issue.includes("invalid_size"))) capacity = "exceeded";
  return {
    world,
    health,
    capacity,
    usedChars,
    gameMode: load.snapshot?.world.gameMode ?? world.initialGameMode,
    lastSavedAt: "savedAt" in load ? load.savedAt : null,
    load,
  };
}

export function listLocalWorlds(storage: SinglePlayerStorageAdapter): {
  registryLoad: LocalWorldRegistryLoadResult;
  worlds: LocalWorldInspection[];
} {
  const registryLoad = loadLocalWorldRegistry(storage);
  if (!registryLoad.registry) return { registryLoad, worlds: [] };
  let registryChars = 0;
  try {
    for (const key of [LOCAL_WORLD_REGISTRY_SLOT_A_KEY, LOCAL_WORLD_REGISTRY_SLOT_B_KEY]) {
      const raw = storage.getItem(key);
      if (raw !== null) registryChars += key.length + raw.length;
    }
  } catch {
    // The registry load already reports read failures; keep this presentation
    // calculation local to the registry rather than coupling it to origin use.
  }
  const registryShare = Math.ceil(registryChars / Math.max(1, registryLoad.registry.worlds.length));
  const worlds = registryLoad.registry.worlds
    .map((world) => inspectLocalWorld(storage, world, registryShare))
    .sort((left, right) => right.world.lastPlayedAt - left.world.lastPlayedAt || left.world.name.localeCompare(right.world.name));
  return { registryLoad, worlds };
}

export function touchLocalWorld(
  storage: SinglePlayerStorageAdapter,
  worldId: string,
  playedAt = Date.now(),
  expectedWorld?: LocalWorldRecord,
): LocalWorldMutationResult {
  const committedAt = timestamp(playedAt);
  const loaded = loadLocalWorldRegistry(storage, committedAt);
  if (!loaded.registry) return failure(`registry_${loaded.status}`);
  const world = loaded.registry.worlds.find(({ id }) => id === worldId);
  if (!world) return failure("world_not_found");
  if (expectedWorld && !sameWorld(world, expectedWorld)) {
    return failure("world_changed");
  }
  if (hasPendingNamespaceRecovery(loaded.issues)) {
    return failure("world_touch_recovery_pending");
  }
  const nextWorld = {
    ...world,
    lastPlayedAt: Math.max(world.createdAt, world.lastPlayedAt, committedAt),
  };
  const nextRegistry = {
    worlds: loaded.registry.worlds.map((candidate) => candidate.id === worldId ? nextWorld : candidate),
  };
  const saved = saveLocalWorldRegistry(storage, nextRegistry, nextWorld.lastPlayedAt, loaded.sequence);
  return saved.ok
    ? { ok: true, world: nextWorld, registry: saved.registry }
    : failure(`registry_${saved.reason}`, saved.mutationStarted);
}

/**
 * Finalizes a newly created world's first verified play session. Immediate
 * creation intentionally enters the world without making this registry write;
 * the caller must invoke this only after the world snapshot has committed.
 * Exact retries and a concurrent winner are successful without another write.
 */
export function recordFirstLocalWorldPlay(
  storage: SinglePlayerStorageAdapter,
  expectedWorld: LocalWorldRecord,
  playedAt = Date.now(),
): LocalWorldMutationResult {
  const committedAt = timestamp(playedAt);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const loaded = loadLocalWorldRegistry(storage, committedAt);
    if (!loaded.registry) return failure(`registry_${loaded.status}`);
    const world = loaded.registry.worlds.find(({ id }) => id === expectedWorld.id);
    if (!world) return failure("world_not_found");
    if (!sameWorldIdentity(world, expectedWorld)) return failure("world_changed");
    if (world.lastPlayedAt > 0) return { ok: true, world, registry: loaded.registry };
    if (hasPendingNamespaceRecovery(loaded.issues)) {
      return failure("world_first_play_recovery_pending");
    }
    const nextWorld = {
      ...world,
      lastPlayedAt: Math.max(world.createdAt, committedAt),
    };
    const nextRegistry = {
      worlds: loaded.registry.worlds.map((candidate) =>
        candidate.id === world.id ? nextWorld : candidate),
    };
    const saved = saveLocalWorldRegistry(
      storage,
      nextRegistry,
      nextWorld.lastPlayedAt,
      loaded.sequence,
    );
    if (saved.ok) return { ok: true, world: nextWorld, registry: saved.registry };

    // A lost acknowledgement or concurrent first-play writer can leave the
    // intended metadata durably committed even though this attempt failed.
    const reconciled = loadLocalWorldRegistry(storage, committedAt);
    const current = reconciled.registry?.worlds.find(({ id }) => id === expectedWorld.id);
    if (current && sameWorldIdentity(current, expectedWorld) && current.lastPlayedAt > 0) {
      return { ok: true, world: current, registry: reconciled.registry! };
    }
    if (saved.reason === "stale_registry" && !saved.mutationStarted && attempt === 0) continue;
    return failure(`registry_${saved.reason}`, saved.mutationStarted);
  }
  return failure("registry_stale_registry");
}

export function deleteLocalWorld(
  storage: SinglePlayerStorageAdapter,
  worldId: string,
  deletedAt = Date.now(),
): LocalWorldMutationResult {
  const committedAt = timestamp(deletedAt);
  const loaded = loadLocalWorldRegistry(storage, committedAt);
  if (!loaded.registry) return failure("world_not_found");
  if (hasPendingNamespaceRecovery(loaded.issues)) {
    return failure("world_delete_recovery_pending");
  }
  const world = loaded.registry.worlds.find(({ id }) => id === worldId);
  if (!world) return failure("world_not_found");
  if (!readWorldValues(storage, world.id)) return failure("world_delete_transaction_failed");
  const pending = makePending(1, loaded.sequence + 1, world, committedAt);
  const nextRegistry = { worlds: loaded.registry.worlds.filter(({ id }) => id !== worldId) };
  const saved = saveRegistryState(storage, nextRegistry, committedAt, loaded.sequence, pending, null);
  if (!saved.ok) {
    return failure(
      saved.mutationStarted || saved.reason === "stale_registry"
        ? `registry_${saved.reason}_transaction_pending`
        : `registry_${saved.reason}`,
      saved.mutationStarted,
    );
  }
  if (!ownsPending(storage, saved.sequence, pending)) {
    return failure("world_delete_transaction_pending", true);
  }
  const pendingRaw = mirrorPending(storage, saved.sequence, pending);
  if (!pendingRaw) {
    return failure("world_delete_transaction_pending", true);
  }
  const removeItem = storageRemover(storage);
  try {
    if (!removeItem) throw new Error();
    for (const key of singlePlayerWorldStorageKeys(world.id)) {
      if (!ownsMirroredPending(storage, pendingRaw)) throw new Error();
      removeItem(key);
      if (!ownsMirroredPending(storage, pendingRaw)) throw new Error();
    }
    const remaining = readWorldValues(storage, world.id);
    if (!remaining || remaining.some((value) => value !== null)) throw new Error();
  } catch {
    return failure("world_delete_cleanup_pending", true);
  }
  const cleared = saveRegistryState(
    storage,
    saved.registry,
    committedAt,
    saved.sequence,
    null,
    pending,
  );
  return cleared.ok
    ? { ok: true, world, registry: cleared.registry }
    : failure("world_delete_cleanup_pending", true);
}
