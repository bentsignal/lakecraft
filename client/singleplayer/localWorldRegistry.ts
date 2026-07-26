import type { LocalGameMode } from "./localCommands.ts";
import {
  SINGLEPLAYER_LEGACY_SAVE_KEY,
  SINGLEPLAYER_SAVE_HEAD_KEY,
  SINGLEPLAYER_SAVE_SLOT_A_KEY,
  SINGLEPLAYER_SAVE_SLOT_B_KEY,
  SINGLEPLAYER_WORLD_SAVE_MAX_SLOT_CHARS,
  canonicalSinglePlayerJson,
  createDefaultSinglePlayerSnapshot,
  loadSinglePlayerSave,
  resetSinglePlayerSave,
  saveSinglePlayerSnapshot,
  singlePlayerSaveChecksum,
  singlePlayerWorldStorageKey,
  singlePlayerWorldStorageKeys,
  type SinglePlayerLoadResult,
  type SinglePlayerSnapshot,
  type SinglePlayerStorageAdapter,
} from "./localSave.ts";

export const LOCAL_WORLD_REGISTRY_FORMAT = "lakecraft.local-world-registry" as const;
export const LOCAL_WORLD_REGISTRY_VERSION = 1 as const;
export const LOCAL_WORLD_REGISTRY_SLOT_A_KEY = "lakecraft.singleplayer.worlds.a";
export const LOCAL_WORLD_REGISTRY_SLOT_B_KEY = "lakecraft.singleplayer.worlds.b";
export const LOCAL_WORLD_CREATE_TRANSACTION_KEY = "lakecraft.singleplayer.worlds.create";
export const LOCAL_WORLD_DELETE_TRANSACTION_KEY = "lakecraft.singleplayer.worlds.delete";
export const LOCAL_WORLD_TRANSACTION_LEASE_MS = 5_000;
export const LOCAL_WORLD_REGISTRY_MAX_WORLDS = 6;
export const LOCAL_WORLD_REGISTRY_MAX_CHARS = 32_000;
export const LOCAL_WORLD_NAME_MAX_CHARS = 48;
export const LOCAL_WORLD_NAMESPACE_BUDGET_CHARS = SINGLEPLAYER_WORLD_SAVE_MAX_SLOT_CHARS * 2
  + Math.ceil(LOCAL_WORLD_REGISTRY_MAX_CHARS * 2 / LOCAL_WORLD_REGISTRY_MAX_WORLDS)
  + 2_048;
export const LOCAL_WORLD_CAPACITY_WARNING_CHARS = Math.floor(LOCAL_WORLD_NAMESPACE_BUDGET_CHARS * 0.8);

const MAX_TIMESTAMP = 8_640_000_000_000_000;
const LEGACY_KEYS = [
  SINGLEPLAYER_LEGACY_SAVE_KEY,
  SINGLEPLAYER_SAVE_HEAD_KEY,
  SINGLEPLAYER_SAVE_SLOT_A_KEY,
  SINGLEPLAYER_SAVE_SLOT_B_KEY,
] as const;

export interface LocalWorldRecord {
  id: string;
  name: string;
  seed: number;
  initialGameMode: LocalGameMode;
  createdAt: number;
  lastPlayedAt: number;
  importedLegacy: boolean;
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
  return load.issues.some((issue) =>
    issue === "transaction:enumeration_failed"
    || issue === "transaction:recovery_pending"
    || issue === "create:transaction_read_failed"
    || issue === "delete:transaction_read_failed");
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
  const transactions = scanLocalWorldTransactions(storage);
  if (transactions.status === "stable" && transactions.entries.some((entry) =>
    entry.status === "valid"
    && entry.type === "delete"
    && entry.transaction.worldId === selected.world.id)) return null;
  const before = loadLocalWorldRegistryRaw(storage);
  const current = before.registry?.worlds.find(({ id }) => id === selected.world.id);
  if (!current || !sameWorld(current, selected.world)) return null;
  const firstInspection = inspectLocalWorld(storage, current);
  if (!isReadOnlyFallbackPlayable(firstInspection)) return null;
  const after = loadLocalWorldRegistryRaw(storage);
  const verified = after.registry?.worlds.find(({ id }) => id === selected.world.id);
  if (!verified || after.sequence !== before.sequence || !sameWorld(verified, current)) return null;
  const secondInspection = inspectLocalWorld(storage, verified);
  if (!isReadOnlyFallbackPlayable(secondInspection)
    || firstInspection.load.sequence !== secondInspection.load.sequence
    || canonicalSinglePlayerJson(firstInspection.load.snapshot)
      !== canonicalSinglePlayerJson(secondInspection.load.snapshot)) return null;
  const closingTransactions = scanLocalWorldTransactions(storage);
  if (!sameTransactionScan(transactions, closingTransactions)
    || (closingTransactions.status === "stable" && closingTransactions.entries.some((entry) =>
      entry.status === "valid"
      && entry.type === "delete"
      && entry.transaction.worldId === selected.world.id))) return null;
  return verified;
}

function isReadOnlyFallbackPlayable(world: LocalWorldInspection): boolean {
  return (world.health === "healthy" || world.health === "recovered")
    && (world.capacity === "ok" || world.capacity === "warning")
    && world.load.snapshot?.world.worldId === world.world.id;
}

function sameTransactionScan(
  left: LocalWorldTransactionScan,
  right: LocalWorldTransactionScan,
): boolean {
  if (left.status !== "stable" || right.status !== "stable") return false;
  return left.entries.length === right.entries.length
    && left.entries.every((entry, index) => {
      const candidate = right.entries[index];
      return candidate !== undefined
        && entry.status === candidate.status
        && entry.type === candidate.type
        && entry.key === candidate.key
        && entry.raw === candidate.raw;
    });
}

export type LegacyLocalWorldInspection =
  | { status: "none" }
  | { status: "available"; load: SinglePlayerLoadResult }
  | { status: "corrupt" | "unsupported"; load: SinglePlayerLoadResult };

type ParsedRegistrySlot =
  | { kind: "empty"; slot: "a" | "b" }
  | { kind: "valid"; slot: "a" | "b"; envelope: LocalWorldRegistryEnvelope; raw: string }
  | { kind: "corrupt"; slot: "a" | "b"; reason: string }
  | { kind: "unsupported"; slot: "a" | "b"; version: number };

interface LocalWorldDeleteTransaction {
  checksum: string;
  deletedAt: number;
  format: "lakecraft.local-world-delete";
  generation: number;
  recoverAfter: number;
  values: Array<string | null>;
  version: 2;
  world: LocalWorldRecord;
  worldId: string;
}

interface LocalWorldCreateTransaction {
  checksum: string;
  format: "lakecraft.local-world-create";
  generation: number;
  recoverAfter: number;
  version: 2;
  world: LocalWorldRecord;
}

type LocalWorldTransactionEntry =
  | {
    status: "valid";
    key: string;
    raw: string;
    type: "create";
    transaction: LocalWorldCreateTransaction;
  }
  | {
    status: "valid";
    key: string;
    raw: string;
    type: "delete";
    transaction: LocalWorldDeleteTransaction;
  }
  | { status: "invalid"; key: string; raw: string; type: "create" | "delete" };

type LocalWorldCreateRecovery = {
  status: "completed" | "warning";
  issue:
    | "create:commit_completed"
    | "create:cleanup_completed"
    | "create:transaction_read_failed"
    | "create:invalid_transaction_cleared"
    | "create:invalid_transaction_pending"
    | "create:recovery_pending";
  transaction?: LocalWorldCreateTransaction;
};

type LocalWorldDeleteRecovery =
  { status: "completed"; issue: "delete:rollback_completed" | "delete:cleanup_completed" }
  | {
    status: "warning";
    issue:
      | "delete:transaction_read_failed"
      | "delete:invalid_transaction_cleared"
      | "delete:invalid_transaction_pending"
      | "delete:recovery_pending";
  };

type LocalWorldTransactionScan =
  | { status: "stable"; entries: LocalWorldTransactionEntry[] }
  | { status: "failed" };

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
    || !exactKeys(value, ["id", "name", "seed", "initialGameMode", "createdAt", "lastPlayedAt", "importedLegacy"])
    || !validWorldId(value.id)
    || typeof value.name !== "string" || normalizeLocalWorldName(value.name) !== value.name
    || !safeInteger(value.seed, -2_147_483_648, 2_147_483_647)
    || (value.initialGameMode !== "survival" && value.initialGameMode !== "creative")
    || !safeInteger(value.createdAt, 0, MAX_TIMESTAMP)
    || (!safeInteger(value.lastPlayedAt, value.createdAt, MAX_TIMESTAMP) && value.lastPlayedAt !== 0)
    || typeof value.importedLegacy !== "boolean") return null;
  return {
    id: value.id,
    name: value.name,
    seed: value.seed,
    initialGameMode: value.initialGameMode,
    createdAt: value.createdAt,
    lastPlayedAt: value.lastPlayedAt,
    importedLegacy: value.importedLegacy,
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
): Omit<LocalWorldRegistryEnvelope, "checksum"> {
  return {
    format: LOCAL_WORLD_REGISTRY_FORMAT,
    payload,
    savedAt,
    sequence,
    version: LOCAL_WORLD_REGISTRY_VERSION,
  };
}

function serializeRegistry(
  value: LocalWorldRegistry,
  sequence: number,
  savedAt: number,
): { ok: true; envelope: LocalWorldRegistryEnvelope; raw: string } | { ok: false; reason: "invalid_registry" | "too_large" } {
  const registry = validateLocalWorldRegistry(value);
  if (!registry || !safeInteger(sequence, 1, Number.MAX_SAFE_INTEGER) || !safeInteger(savedAt, 0, MAX_TIMESTAMP)) {
    return { ok: false, reason: "invalid_registry" };
  }
  const body = registryBody(registry, sequence, savedAt);
  const envelope = { checksum: singlePlayerSaveChecksum(body), ...body };
  const raw = canonicalSinglePlayerJson(envelope);
  return raw.length <= LOCAL_WORLD_REGISTRY_MAX_CHARS
    ? { ok: true, envelope, raw }
    : { ok: false, reason: "too_large" };
}

function registrySlotKey(slot: "a" | "b"): string {
  return slot === "a" ? LOCAL_WORLD_REGISTRY_SLOT_A_KEY : LOCAL_WORLD_REGISTRY_SLOT_B_KEY;
}

function parseRegistrySlot(slot: "a" | "b", raw: string | null): ParsedRegistrySlot {
  if (raw === null) return { kind: "empty", slot };
  if (raw.length === 0 || raw.length > LOCAL_WORLD_REGISTRY_MAX_CHARS) return { kind: "corrupt", slot, reason: "invalid_size" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: "corrupt", slot, reason: "invalid_json" };
  }
  if (!isRecord(parsed)) return { kind: "corrupt", slot, reason: "invalid_envelope" };
  if (parsed.format === LOCAL_WORLD_REGISTRY_FORMAT && typeof parsed.version === "number"
    && Number.isSafeInteger(parsed.version) && parsed.version !== LOCAL_WORLD_REGISTRY_VERSION) {
    return { kind: "unsupported", slot, version: parsed.version };
  }
  if (!exactKeys(parsed, ["checksum", "format", "payload", "savedAt", "sequence", "version"])
    || parsed.format !== LOCAL_WORLD_REGISTRY_FORMAT || parsed.version !== LOCAL_WORLD_REGISTRY_VERSION
    || typeof parsed.checksum !== "string" || !/^[0-9a-f]{8}$/.test(parsed.checksum)
    || !safeInteger(parsed.savedAt, 0, MAX_TIMESTAMP)
    || !safeInteger(parsed.sequence, 1, Number.MAX_SAFE_INTEGER)) {
    return { kind: "corrupt", slot, reason: "invalid_envelope" };
  }
  const registry = validateLocalWorldRegistry(parsed.payload);
  if (!registry) return { kind: "corrupt", slot, reason: "invalid_registry" };
  const body = registryBody(registry, parsed.sequence, parsed.savedAt);
  const envelope = { checksum: parsed.checksum, ...body };
  if (singlePlayerSaveChecksum(body) !== parsed.checksum) return { kind: "corrupt", slot, reason: "checksum_mismatch" };
  if (canonicalSinglePlayerJson(envelope) !== raw) return { kind: "corrupt", slot, reason: "noncanonical_envelope" };
  return { kind: "valid", slot, envelope, raw };
}

function readRegistrySlots(storage: SinglePlayerStorageAdapter): { slots: ParsedRegistrySlot[]; readFailed: boolean } {
  const slots: ParsedRegistrySlot[] = [];
  let readFailed = false;
  for (const slot of ["a", "b"] as const) {
    try {
      slots.push(parseRegistrySlot(slot, storage.getItem(registrySlotKey(slot))));
    } catch {
      readFailed = true;
      slots.push({ kind: "corrupt", slot, reason: "storage_read_failed" });
    }
  }
  return { slots, readFailed };
}

function highestRegistrySlot(slots: readonly ParsedRegistrySlot[]): Extract<ParsedRegistrySlot, { kind: "valid" }> | null {
  return slots
    .filter((slot): slot is Extract<ParsedRegistrySlot, { kind: "valid" }> => slot.kind === "valid")
    .sort((left, right) => right.envelope.sequence - left.envelope.sequence || left.slot.localeCompare(right.slot))[0] ?? null;
}

function hasRegistryGenerationConflict(slots: readonly ParsedRegistrySlot[]): boolean {
  const valid = slots
    .filter((slot): slot is Extract<ParsedRegistrySlot, { kind: "valid" }> => slot.kind === "valid")
    .sort((left, right) => right.envelope.sequence - left.envelope.sequence);
  return valid.length > 1
    && valid[0].envelope.sequence === valid[1].envelope.sequence
    && valid[0].raw !== valid[1].raw;
}

function loadLocalWorldRegistryRaw(storage: SinglePlayerStorageAdapter): LocalWorldRegistryLoadResult {
  const scanned = readRegistrySlots(storage);
  const issues = scanned.slots.flatMap((slot) => slot.kind === "corrupt" ? [`${slot.slot}:${slot.reason}`]
    : slot.kind === "unsupported" ? [`${slot.slot}:unsupported_v${slot.version}`] : []);
  const unsupported = scanned.slots.filter((slot): slot is Extract<ParsedRegistrySlot, { kind: "unsupported" }> => slot.kind === "unsupported");
  if (unsupported.length) {
    return {
      status: "unsupported",
      registry: null,
      sequence: 0,
      versions: [...new Set(unsupported.map(({ version }) => version))].sort((a, b) => a - b),
      issues,
    };
  }
  if (hasRegistryGenerationConflict(scanned.slots)) {
    return {
      status: "corrupt",
      registry: null,
      sequence: 0,
      issues: [...issues, "registry:generation_conflict"],
    };
  }
  const selected = highestRegistrySlot(scanned.slots);
  if (selected) {
    return {
      status: issues.length > 0 ? "recovered" : "loaded",
      registry: selected.envelope.payload,
      sequence: selected.envelope.sequence,
      issues,
    };
  }
  if (scanned.readFailed || scanned.slots.some((slot) => slot.kind === "corrupt")) {
    return { status: "corrupt", registry: null, sequence: 0, issues };
  }
  return { status: "empty", registry: { worlds: [] }, sequence: 0, issues: [] };
}

function createTransactionBody(
  world: LocalWorldRecord,
  generation: number,
): Omit<LocalWorldCreateTransaction, "checksum"> {
  return {
    format: "lakecraft.local-world-create",
    generation,
    recoverAfter: Math.min(MAX_TIMESTAMP, world.createdAt + LOCAL_WORLD_TRANSACTION_LEASE_MS),
    version: 2,
    world,
  };
}

function deleteTransactionBody(
  world: LocalWorldRecord,
  values: Array<string | null>,
  deletedAt: number,
  generation: number,
): Omit<LocalWorldDeleteTransaction, "checksum"> {
  return {
    deletedAt,
    format: "lakecraft.local-world-delete",
    generation,
    recoverAfter: Math.min(MAX_TIMESTAMP, deletedAt + LOCAL_WORLD_TRANSACTION_LEASE_MS),
    values,
    version: 2,
    world,
    worldId: world.id,
  };
}

function transactionAddress(raw: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < raw.length; index += 1) {
    const code = raw.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ (code + index), 0x85ebca6b);
  }
  return `${raw.length.toString(36)}-${(first >>> 0).toString(16).padStart(8, "0")}-${(second >>> 0).toString(16).padStart(8, "0")}`;
}

function transactionKey(
  type: "create" | "delete",
  generation: number,
  raw: string,
): string {
  const prefix = type === "create" ? LOCAL_WORLD_CREATE_TRANSACTION_KEY : LOCAL_WORLD_DELETE_TRANSACTION_KEY;
  return `${prefix}.${generation.toString(36).padStart(11, "0")}.${transactionAddress(raw)}`;
}

function transactionTypeForKey(key: string): "create" | "delete" | null {
  if (key === LOCAL_WORLD_CREATE_TRANSACTION_KEY || key.startsWith(`${LOCAL_WORLD_CREATE_TRANSACTION_KEY}.`)) {
    return "create";
  }
  if (key === LOCAL_WORLD_DELETE_TRANSACTION_KEY || key.startsWith(`${LOCAL_WORLD_DELETE_TRANSACTION_KEY}.`)) {
    return "delete";
  }
  return null;
}

function parseCreateTransaction(key: string, raw: string): LocalWorldTransactionEntry {
  const invalid = (): LocalWorldTransactionEntry => ({ status: "invalid", key, raw, type: "create" });
  if (raw.length === 0 || raw.length > LOCAL_WORLD_REGISTRY_MAX_CHARS) return invalid();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return invalid();
  }
  if (!isRecord(parsed)
    || !exactKeys(parsed, ["checksum", "format", "generation", "recoverAfter", "version", "world"])
    || parsed.format !== "lakecraft.local-world-create" || parsed.version !== 2
    || typeof parsed.checksum !== "string" || !/^[0-9a-f]{8}$/.test(parsed.checksum)
    || !safeInteger(parsed.generation, 1, Number.MAX_SAFE_INTEGER)
    || !safeInteger(parsed.recoverAfter, 0, MAX_TIMESTAMP)) {
    return invalid();
  }
  const world = validateWorldRecord(parsed.world);
  if (!world) return invalid();
  const body = createTransactionBody(world, parsed.generation);
  if (parsed.recoverAfter !== body.recoverAfter) return invalid();
  const transaction = { checksum: parsed.checksum, ...body };
  if (singlePlayerSaveChecksum(body) !== parsed.checksum
    || canonicalSinglePlayerJson(transaction) !== raw
    || transactionKey("create", transaction.generation, raw) !== key) return invalid();
  return { status: "valid", key, raw, type: "create", transaction };
}

function parseDeleteTransaction(key: string, raw: string): LocalWorldTransactionEntry {
  const invalid = (): LocalWorldTransactionEntry => ({ status: "invalid", key, raw, type: "delete" });
  if (raw.length === 0 || raw.length > SINGLEPLAYER_WORLD_SAVE_MAX_SLOT_CHARS * 10) {
    return invalid();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return invalid();
  }
  if (!isRecord(parsed)
    || !exactKeys(parsed, ["checksum", "deletedAt", "format", "generation", "recoverAfter", "values", "version", "world", "worldId"])
    || parsed.format !== "lakecraft.local-world-delete" || parsed.version !== 2
    || typeof parsed.checksum !== "string" || !/^[0-9a-f]{8}$/.test(parsed.checksum)
    || !safeInteger(parsed.generation, 1, Number.MAX_SAFE_INTEGER)
    || !safeInteger(parsed.recoverAfter, 0, MAX_TIMESTAMP)
    || !validWorldId(parsed.worldId) || !safeInteger(parsed.deletedAt, 0, MAX_TIMESTAMP)
    || !Array.isArray(parsed.values) || parsed.values.length !== 4
    || !parsed.values.every((value) => value === null || typeof value === "string")) {
    return invalid();
  }
  const world = validateWorldRecord(parsed.world);
  if (!world || world.id !== parsed.worldId) return invalid();
  const body = deleteTransactionBody(
    world,
    parsed.values as Array<string | null>,
    parsed.deletedAt,
    parsed.generation,
  );
  if (parsed.recoverAfter !== body.recoverAfter) return invalid();
  const transaction = { checksum: parsed.checksum, ...body };
  if (singlePlayerSaveChecksum(body) !== parsed.checksum
    || canonicalSinglePlayerJson(transaction) !== raw
    || transactionKey("delete", transaction.generation, raw) !== key) return invalid();
  return { status: "valid", key, raw, type: "delete", transaction };
}

function listTransactionKeys(storage: SinglePlayerStorageAdapter): string[] | null {
  try {
    const listKeys = storage.listKeys;
    if (typeof listKeys !== "function") return null;
    const keys = listKeys.call(storage)
      .filter((key) => typeof key === "string" && transactionTypeForKey(key) !== null)
      .sort();
    return keys.length === new Set(keys).size ? keys : null;
  } catch {
    return null;
  }
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function scanLocalWorldTransactions(storage: SinglePlayerStorageAdapter): LocalWorldTransactionScan {
  const firstKeys = listTransactionKeys(storage);
  if (!firstKeys) return { status: "failed" };
  const raws = new Map<string, string>();
  try {
    for (const key of firstKeys) {
      const raw = storage.getItem(key);
      if (raw === null) return { status: "failed" };
      raws.set(key, raw);
    }
  } catch {
    return { status: "failed" };
  }
  const secondKeys = listTransactionKeys(storage);
  if (!secondKeys || !sameStrings(firstKeys, secondKeys)) return { status: "failed" };
  try {
    for (const key of firstKeys) {
      if (storage.getItem(key) !== raws.get(key)) return { status: "failed" };
    }
  } catch {
    return { status: "failed" };
  }
  const thirdKeys = listTransactionKeys(storage);
  if (!thirdKeys || !sameStrings(firstKeys, thirdKeys)) return { status: "failed" };
  return {
    status: "stable",
    entries: firstKeys.map((key) => {
      const raw = raws.get(key)!;
      return transactionTypeForKey(key) === "create"
        ? parseCreateTransaction(key, raw)
        : parseDeleteTransaction(key, raw);
    }),
  };
}

function writeAndElectTransaction(
  storage: SinglePlayerStorageAdapter,
  entry: Extract<LocalWorldTransactionEntry, { status: "valid" }>,
): "elected" | "failed" | "pending" {
  try {
    storage.setItem(entry.key, entry.raw);
    if (storage.getItem(entry.key) !== entry.raw) return "pending";
  } catch {
    const scan = scanLocalWorldTransactions(storage);
    return scan.status === "stable" && scan.entries.length === 0 ? "failed" : "pending";
  }
  const scan = scanLocalWorldTransactions(storage);
  return scan.status === "stable"
    && scan.entries[0]?.status === "valid"
    && scan.entries[0].key === entry.key
    && scan.entries[0].raw === entry.raw
    ? "elected"
    : "pending";
}

function storageRemover(storage: SinglePlayerStorageAdapter): ((key: string) => void) | null {
  try {
    const removeItem = storage.removeItem;
    return typeof removeItem === "function" ? removeItem.bind(storage) : null;
  } catch {
    return null;
  }
}

function clearTransaction(storage: SinglePlayerStorageAdapter, key: string, expectedRaw: string): boolean {
  const removeItem = storageRemover(storage);
  if (!removeItem) return false;
  try {
    if (storage.getItem(key) !== expectedRaw) return false;
    removeItem(key);
    return storage.getItem(key) === null;
  } catch {
    return false;
  }
}

function sameWorld(left: LocalWorldRecord, right: LocalWorldRecord): boolean {
  return canonicalSinglePlayerJson(left) === canonicalSinglePlayerJson(right);
}

/**
 * Resolves a create at its registry commit point. A matching registry record
 * proves the create committed. Its absence proves that only the exact
 * checksummed namespace may be removed.
 */
function recoverLocalWorldCreate(
  storage: SinglePlayerStorageAdapter,
  registryLoad: LocalWorldRegistryLoadResult,
  pending: Extract<LocalWorldTransactionEntry, { status: "valid"; type: "create" }>,
): LocalWorldCreateRecovery {
  if (!registryLoad.registry) {
    return { status: "warning", issue: "create:recovery_pending", transaction: pending.transaction };
  }
  const { transaction } = pending;
  const registered = registryLoad.registry.worlds.find(({ id }) => id === transaction.world.id);
  if (registered && !sameWorld(registered, transaction.world)) {
    return {
      status: "warning",
      issue: clearTransaction(storage, pending.key, pending.raw)
        ? "create:invalid_transaction_cleared"
        : "create:invalid_transaction_pending",
    };
  }
  if (!registered) {
    const removeItem = storageRemover(storage);
    if (!removeItem) {
      return { status: "warning", issue: "create:recovery_pending", transaction };
    }
    try {
      for (const key of singlePlayerWorldStorageKeys(transaction.world.id)) removeItem(key);
      for (const key of singlePlayerWorldStorageKeys(transaction.world.id)) {
        if (storage.getItem(key) !== null) {
          return { status: "warning", issue: "create:recovery_pending", transaction };
        }
      }
    } catch {
      return { status: "warning", issue: "create:recovery_pending", transaction };
    }
  }
  const issue = registered ? "create:commit_completed" : "create:cleanup_completed";
  return clearTransaction(storage, pending.key, pending.raw)
    ? { status: "completed", issue, transaction }
    : { status: "warning", issue: "create:recovery_pending", transaction };
}

/**
 * Completes an interrupted delete at its registry commit point. Before that
 * point the complete journal is restored; after it, all primary keys are
 * removed. The checksummed transaction remains until either state verifies.
 */
function recoverLocalWorldDelete(
  storage: SinglePlayerStorageAdapter,
  registryLoad: LocalWorldRegistryLoadResult,
  pending: Extract<LocalWorldTransactionEntry, { status: "valid"; type: "delete" }>,
): LocalWorldDeleteRecovery {
  if (!registryLoad.registry) return { status: "warning", issue: "delete:recovery_pending" };
  const removeItem = storageRemover(storage);
  if (!removeItem) return { status: "warning", issue: "delete:recovery_pending" };
  const { transaction } = pending;
  const keys = singlePlayerWorldStorageKeys(transaction.worldId);
  const registered = registryLoad.registry.worlds.find(({ id }) => id === transaction.worldId);
  if (registered && !sameWorld(registered, transaction.world)) {
    return {
      status: "warning",
      issue: clearTransaction(storage, pending.key, pending.raw)
        ? "delete:invalid_transaction_cleared"
        : "delete:invalid_transaction_pending",
    };
  }
  const restore = Boolean(registered);
  try {
    for (let index = 0; index < keys.length; index += 1) {
      const value = transaction.values[index];
      if (restore && value !== null) storage.setItem(keys[index], value);
      else removeItem(keys[index]);
    }
    for (let index = 0; index < keys.length; index += 1) {
      const expected = restore ? transaction.values[index] : null;
      if (storage.getItem(keys[index]) !== expected) {
        return { status: "warning", issue: "delete:recovery_pending" };
      }
    }
  } catch {
    return { status: "warning", issue: "delete:recovery_pending" };
  }
  return clearTransaction(storage, pending.key, pending.raw)
    ? { status: "completed", issue: restore ? "delete:rollback_completed" : "delete:cleanup_completed" }
    : { status: "warning", issue: "delete:recovery_pending" };
}

function withRecoveryIssue(
  loaded: LocalWorldRegistryLoadResult,
  issue: string,
): LocalWorldRegistryLoadResult {
  const issues = [...loaded.issues, issue];
  if (!loaded.registry) return { ...loaded, issues };
  return { status: "recovered", registry: loaded.registry, sequence: loaded.sequence, issues };
}

function hasPendingDeleteRecovery(issues: readonly string[]): boolean {
  return issues.includes("delete:transaction_read_failed")
    || issues.includes("delete:invalid_transaction_pending")
    || issues.includes("delete:recovery_pending")
    || issues.includes("transaction:enumeration_failed");
}

function hasPendingCreateRecovery(issues: readonly string[]): boolean {
  return issues.includes("create:transaction_read_failed")
    || issues.includes("create:invalid_transaction_pending")
    || issues.includes("create:recovery_pending")
    || issues.includes("transaction:enumeration_failed");
}

function hasPendingNamespaceRecovery(issues: readonly string[]): boolean {
  return issues.includes("transaction:recovery_pending")
    || issues.includes("transaction:active")
    || hasPendingDeleteRecovery(issues)
    || hasPendingCreateRecovery(issues);
}

export function loadLocalWorldRegistry(
  storage: SinglePlayerStorageAdapter,
  observedAt = Date.now(),
): LocalWorldRegistryLoadResult {
  const recoveryAt = Math.max(0, Math.min(MAX_TIMESTAMP, Math.floor(observedAt)));
  let loaded = loadLocalWorldRegistryRaw(storage);
  for (let step = 0; step < LOCAL_WORLD_REGISTRY_MAX_WORLDS * 2 + 4; step += 1) {
    const scan = scanLocalWorldTransactions(storage);
    if (scan.status === "failed") return withRecoveryIssue(loaded, "transaction:enumeration_failed");
    const pending = scan.entries[0];
    if (!pending) return loaded;
    if (pending.status === "invalid") {
      const cleared = clearTransaction(storage, pending.key, pending.raw);
      loaded = withRecoveryIssue(
        loaded,
        `${pending.type}:invalid_transaction_${cleared ? "cleared" : "pending"}`,
      );
      if (!cleared) return loaded;
      continue;
    }
    if (recoveryAt < pending.transaction.recoverAfter) {
      return withRecoveryIssue(loaded, "transaction:active");
    }
    const recovery = pending.type === "create"
      ? recoverLocalWorldCreate(storage, loaded, pending)
      : recoverLocalWorldDelete(storage, loaded, pending);
    loaded = withRecoveryIssue(loaded, recovery.issue);
    if (recovery.status === "warning"
      && (recovery.issue.endsWith("_pending") || recovery.issue.endsWith("_failed"))) return loaded;
  }
  const remaining = scanLocalWorldTransactions(storage);
  return remaining.status === "stable" && remaining.entries.length === 0
    ? loaded
    : withRecoveryIssue(loaded, "transaction:recovery_pending");
}

export function saveLocalWorldRegistry(
  storage: SinglePlayerStorageAdapter,
  registry: LocalWorldRegistry,
  savedAt = Date.now(),
  expectedSequence?: number,
): LocalWorldRegistrySaveResult {
  const scanned = readRegistrySlots(storage);
  const current = highestRegistrySlot(scanned.slots);
  if (scanned.readFailed) return { ok: false, reason: "storage_read_failed", mutationStarted: false };
  if (scanned.slots.some((slot) => slot.kind === "unsupported")
    || hasRegistryGenerationConflict(scanned.slots)
    || (!current && scanned.slots.some((slot) => slot.kind !== "empty"))) {
    return { ok: false, reason: "unsafe_existing_data", mutationStarted: false };
  }
  if (expectedSequence !== undefined && (current?.envelope.sequence ?? 0) !== expectedSequence) {
    return { ok: false, reason: "stale_registry", mutationStarted: false };
  }
  const serialized = serializeRegistry(registry, (current?.envelope.sequence ?? 0) + 1, savedAt);
  if (!serialized.ok) return { ...serialized, mutationStarted: false };
  const target = current ? (current.slot === "a" ? "b" : "a") : "a";
  try {
    storage.setItem(registrySlotKey(target), serialized.raw);
  } catch {
    return { ok: false, reason: "storage_write_failed", mutationStarted: true };
  }
  let readback: string | null;
  try {
    readback = storage.getItem(registrySlotKey(target));
  } catch {
    return { ok: false, reason: "readback_failed", mutationStarted: true };
  }
  const verified = parseRegistrySlot(target, readback);
  if (readback !== serialized.raw || verified.kind !== "valid"
    || verified.envelope.sequence !== serialized.envelope.sequence) {
    return { ok: false, reason: "readback_failed", mutationStarted: true };
  }
  const committed = readRegistrySlots(storage);
  const selected = highestRegistrySlot(committed.slots);
  const conflict = committed.slots.some((slot) => slot.kind === "valid"
    && slot.envelope.sequence >= serialized.envelope.sequence
    && slot.raw !== serialized.raw);
  if (committed.readFailed || conflict || !selected
    || selected.slot !== target || selected.raw !== serialized.raw) {
    return { ok: false, reason: "stale_registry", mutationStarted: true };
  }
  return {
    ok: true,
    registry: serialized.envelope.payload,
    sequence: serialized.envelope.sequence,
    slot: target,
  };
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

function createWorldFromSnapshot(
  storage: SinglePlayerStorageAdapter,
  registry: LocalWorldRegistry,
  generation: number,
  input: { name: string; seed: number; gameMode: LocalGameMode; createdAt: number; importedLegacy: boolean },
  sourceSnapshot?: SinglePlayerSnapshot,
): LocalWorldMutationResult {
  const name = normalizeLocalWorldName(input.name);
  if (!name || !safeInteger(input.seed, -2_147_483_648, 2_147_483_647)
    || (input.gameMode !== "survival" && input.gameMode !== "creative")
    || !safeInteger(input.createdAt, 0, MAX_TIMESTAMP)) {
    return { ok: false, reason: "invalid_world", mutationStarted: false };
  }
  const replayed = registry.worlds.find((candidate) =>
    candidate.name === name
    && candidate.seed === input.seed
    && candidate.initialGameMode === input.gameMode
    && candidate.createdAt === input.createdAt
    && candidate.importedLegacy === input.importedLegacy);
  if (replayed) return { ok: true, world: replayed, registry };
  if (registry.worlds.length >= LOCAL_WORLD_REGISTRY_MAX_WORLDS) {
    return { ok: false, reason: "world_limit_reached", mutationStarted: false };
  }
  const id = nextWorldId(registry, input.seed, input.createdAt);
  if (!id) return { ok: false, reason: "world_id_unavailable", mutationStarted: false };
  const world: LocalWorldRecord = {
    id,
    name,
    seed: input.seed,
    initialGameMode: input.gameMode,
    createdAt: input.createdAt,
    lastPlayedAt: 0,
    importedLegacy: input.importedLegacy,
  };
  const transactionBody = createTransactionBody(world, generation);
  const transaction = { checksum: singlePlayerSaveChecksum(transactionBody), ...transactionBody };
  const transactionRaw = canonicalSinglePlayerJson(transaction);
  const key = transactionKey("create", generation, transactionRaw);
  const entry = parseCreateTransaction(key, transactionRaw);
  if (entry.status !== "valid" || entry.type !== "create") {
    return { ok: false, reason: "world_create_transaction_failed", mutationStarted: false };
  }
  const election = writeAndElectTransaction(storage, entry);
  if (election !== "elected") {
    return {
      ok: false,
      reason: election === "failed" ? "world_create_transaction_failed" : "world_create_transaction_pending",
      mutationStarted: true,
    };
  }
  const snapshot = sourceSnapshot
    ? {
      ...sourceSnapshot,
      world: {
        ...sourceSnapshot.world,
        worldId: id,
        gameMode: sourceSnapshot.world.gameMode ?? input.gameMode,
        weather: { ...sourceSnapshot.world.weather },
        edits: sourceSnapshot.world.edits.map((edit) => ({ ...edit })),
      },
    }
    : createDefaultSinglePlayerSnapshot(input.seed, input.createdAt, id);
  snapshot.world.gameMode = input.gameMode;
  const saved = saveSinglePlayerSnapshot(storage, snapshot, input.createdAt, { worldId: id });
  if (!saved.ok) return { ok: false, reason: `world_save_${saved.reason}_transaction_pending`, mutationStarted: true };
  const nextRegistry = { worlds: [...registry.worlds, world] };
  const registryWrite = saveLocalWorldRegistry(storage, nextRegistry, input.createdAt, generation - 1);
  if (!registryWrite.ok) {
    return { ok: false, reason: `registry_${registryWrite.reason}_transaction_pending`, mutationStarted: true };
  }
  clearTransaction(storage, key, transactionRaw);
  return { ok: true, world, registry: registryWrite.registry };
}

export function createLocalWorld(
  storage: SinglePlayerStorageAdapter,
  input: { name: string; seedText: string; gameMode: LocalGameMode; now?: number },
): LocalWorldMutationResult {
  const createdAt = Math.max(0, Math.min(MAX_TIMESTAMP, Math.floor(input.now ?? Date.now())));
  const loaded = loadLocalWorldRegistry(storage, createdAt);
  if (!loaded.registry) return { ok: false, reason: `registry_${loaded.status}`, mutationStarted: false };
  const name = normalizeLocalWorldName(input.name);
  const seed = deterministicLocalWorldSeed(input.seedText);
  const replayed = name ? loaded.registry.worlds.find((candidate) =>
    candidate.name === name
    && candidate.seed === seed
    && candidate.initialGameMode === input.gameMode
    && candidate.createdAt === createdAt
    && !candidate.importedLegacy) : null;
  if (replayed) return { ok: true, world: replayed, registry: loaded.registry };
  if (hasPendingNamespaceRecovery(loaded.issues)) {
    return { ok: false, reason: "world_create_recovery_pending", mutationStarted: false };
  }
  return createWorldFromSnapshot(storage, loaded.registry, loaded.sequence + 1, {
    name: input.name,
    seed,
    gameMode: input.gameMode,
    createdAt,
    importedLegacy: false,
  });
}

export function inspectLocalWorld(
  storage: SinglePlayerStorageAdapter,
  world: LocalWorldRecord,
  registryOverheadChars = 0,
): LocalWorldInspection {
  const load = loadSinglePlayerSave(storage, { migrateLegacy: false, worldId: world.id });
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
  const committedAt = Math.max(0, Math.min(MAX_TIMESTAMP, Math.floor(playedAt)));
  const loaded = loadLocalWorldRegistry(storage, committedAt);
  if (!loaded.registry) return { ok: false, reason: `registry_${loaded.status}`, mutationStarted: false };
  const world = loaded.registry.worlds.find(({ id }) => id === worldId);
  if (!world) return { ok: false, reason: "world_not_found", mutationStarted: false };
  if (expectedWorld && !sameWorld(world, expectedWorld)) {
    return { ok: false, reason: "world_changed", mutationStarted: false };
  }
  if (hasPendingNamespaceRecovery(loaded.issues)) {
    return { ok: false, reason: "world_touch_recovery_pending", mutationStarted: false };
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
    : { ok: false, reason: `registry_${saved.reason}`, mutationStarted: saved.mutationStarted };
}

export function resetLocalWorldData(
  storage: SinglePlayerStorageAdapter,
  worldId: string,
  resetAt = Date.now(),
): LocalWorldMutationResult {
  const committedAt = Math.max(0, Math.min(MAX_TIMESTAMP, Math.floor(resetAt)));
  const loaded = loadLocalWorldRegistry(storage, committedAt);
  if (!loaded.registry) return { ok: false, reason: "world_not_found", mutationStarted: false };
  if (hasPendingNamespaceRecovery(loaded.issues)) {
    return { ok: false, reason: "world_reset_recovery_pending", mutationStarted: false };
  }
  const world = loaded.registry.worlds.find(({ id }) => id === worldId);
  if (!world) return { ok: false, reason: "world_not_found", mutationStarted: false };
  const reset = resetSinglePlayerSave(storage, { worldId });
  if (!reset.ok) return { ok: false, reason: `world_reset_${reset.reason}`, mutationStarted: reset.mutationStarted };
  const snapshot = createDefaultSinglePlayerSnapshot(world.seed, world.createdAt, world.id);
  snapshot.world.gameMode = world.initialGameMode;
  const saved = saveSinglePlayerSnapshot(storage, snapshot, committedAt, { worldId });
  return saved.ok
    ? { ok: true, world, registry: loaded.registry }
    : { ok: false, reason: `world_save_${saved.reason}`, mutationStarted: true };
}

function beginLocalWorldDelete(
  storage: SinglePlayerStorageAdapter,
  world: LocalWorldRecord,
  deletedAt: number,
  generation: number,
): { ok: true; key: string; raw: string } | { ok: false; mutationStarted: boolean } {
  const values: Array<string | null> = [];
  try {
    for (const key of singlePlayerWorldStorageKeys(world.id)) values.push(storage.getItem(key));
    const body = deleteTransactionBody(world, values, deletedAt, generation);
    const transaction = { checksum: singlePlayerSaveChecksum(body), ...body };
    const raw = canonicalSinglePlayerJson(transaction);
    if (raw.length > SINGLEPLAYER_WORLD_SAVE_MAX_SLOT_CHARS * 10) {
      return { ok: false, mutationStarted: false };
    }
    const key = transactionKey("delete", generation, raw);
    const entry = parseDeleteTransaction(key, raw);
    if (entry.status !== "valid" || entry.type !== "delete") {
      return { ok: false, mutationStarted: false };
    }
    const election = writeAndElectTransaction(storage, entry);
    return election === "elected"
      ? { ok: true, key, raw }
      : { ok: false, mutationStarted: election === "pending" };
  } catch {
    return { ok: false, mutationStarted: false };
  }
}

export function deleteLocalWorld(
  storage: SinglePlayerStorageAdapter,
  worldId: string,
  deletedAt = Date.now(),
): LocalWorldMutationResult {
  const committedAt = Math.max(0, Math.min(MAX_TIMESTAMP, Math.floor(deletedAt)));
  const loaded = loadLocalWorldRegistry(storage, committedAt);
  if (!loaded.registry) return { ok: false, reason: "world_not_found", mutationStarted: false };
  if (hasPendingNamespaceRecovery(loaded.issues)) {
    return { ok: false, reason: "world_delete_recovery_pending", mutationStarted: false };
  }
  const world = loaded.registry.worlds.find(({ id }) => id === worldId);
  if (!world) return { ok: false, reason: "world_not_found", mutationStarted: false };
  const begun = beginLocalWorldDelete(storage, world, committedAt, loaded.sequence + 1);
  if (!begun.ok) {
    return {
      ok: false,
      reason: begun.mutationStarted ? "world_delete_transaction_pending" : "world_delete_transaction_failed",
      mutationStarted: begun.mutationStarted,
    };
  }
  const nextRegistry = { worlds: loaded.registry.worlds.filter(({ id }) => id !== worldId) };
  const saved = saveLocalWorldRegistry(storage, nextRegistry, committedAt, loaded.sequence);
  if (!saved.ok) {
    if (saved.mutationStarted || saved.reason === "stale_registry") {
      return {
        ok: false,
        reason: `registry_${saved.reason}_transaction_pending`,
        mutationStarted: true,
      };
    }
    const cleared = clearTransaction(storage, begun.key, begun.raw);
    return {
      ok: false,
      reason: cleared ? `registry_${saved.reason}` : `registry_${saved.reason}_transaction_pending`,
      mutationStarted: !cleared,
    };
  }
  const entry = parseDeleteTransaction(begun.key, begun.raw);
  if (entry.status === "valid" && entry.type === "delete") {
    const recovered = recoverLocalWorldDelete(storage, {
      status: "loaded",
      registry: saved.registry,
      sequence: saved.sequence,
      issues: [],
    }, entry);
    if (recovered.status === "completed") {
      return { ok: true, world, registry: saved.registry };
    }
  }
  return { ok: false, reason: "world_delete_cleanup_pending", mutationStarted: true };
}

export function inspectLegacyLocalWorld(storage: SinglePlayerStorageAdapter): LegacyLocalWorldInspection {
  let present = false;
  try {
    present = LEGACY_KEYS.some((key) => storage.getItem(key) !== null);
  } catch {
    return {
      status: "corrupt",
      load: { status: "corrupt", snapshot: null, sequence: 0, reason: "storage_read_failed", issues: ["legacy:storage_read_failed"] },
    };
  }
  if (!present) return { status: "none" };
  const load = loadSinglePlayerSave(storage, { migrateLegacy: false });
  if (load.status === "unsupported") return { status: "unsupported", load };
  if (load.status === "corrupt") return { status: "corrupt", load };
  return { status: "available", load };
}

export function importLegacyLocalWorld(
  storage: SinglePlayerStorageAdapter,
  input: { name: string; now?: number },
): LocalWorldMutationResult {
  const now = Math.max(0, Math.min(MAX_TIMESTAMP, Math.floor(input.now ?? Date.now())));
  const loadedRegistry = loadLocalWorldRegistry(storage, now);
  if (!loadedRegistry.registry) return { ok: false, reason: `registry_${loadedRegistry.status}`, mutationStarted: false };
  if (hasPendingNamespaceRecovery(loadedRegistry.issues)) {
    return { ok: false, reason: "world_import_recovery_pending", mutationStarted: false };
  }
  // This is the only path that enables the old one-key migration, and it is
  // called solely from the user's explicit Import action.
  const legacy = loadSinglePlayerSave(storage, {
    migrateLegacy: true,
    persistMigration: false,
    now: () => now,
  });
  if (!legacy.snapshot) return { ok: false, reason: `legacy_${legacy.status}`, mutationStarted: false };
  return createWorldFromSnapshot(storage, loadedRegistry.registry, loadedRegistry.sequence + 1, {
    name: input.name,
    seed: legacy.snapshot.world.seed,
    gameMode: legacy.snapshot.world.gameMode ?? "survival",
    createdAt: now,
    importedLegacy: true,
  }, legacy.snapshot);
}

export function resetLegacyLocalWorld(
  storage: SinglePlayerStorageAdapter,
  resetAt = Date.now(),
): LocalWorldMutationResult {
  const committedAt = Math.max(0, Math.min(MAX_TIMESTAMP, Math.floor(resetAt)));
  const loaded = loadLocalWorldRegistry(storage, committedAt);
  if (hasPendingNamespaceRecovery(loaded.issues)) {
    return { ok: false, reason: "legacy_reset_recovery_pending", mutationStarted: false };
  }
  const reset = resetSinglePlayerSave(storage);
  if (!reset.ok) return { ok: false, reason: `legacy_reset_${reset.reason}`, mutationStarted: reset.mutationStarted };
  const placeholder: LocalWorldRecord = {
    id: "legacy-reset",
    name: "Legacy World",
    seed: 0,
    initialGameMode: "survival",
    createdAt: 0,
    lastPlayedAt: 0,
    importedLegacy: true,
  };
  return { ok: true, world: placeholder, registry: loaded.registry ?? { worlds: [] } };
}
