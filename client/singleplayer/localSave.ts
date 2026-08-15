import {
  HOTBAR_SIZE,
  INVENTORY_SIZE,
  ITEMS,
  MAX_HUNGER,
  createEmptyEquipment,
  createStarterInventory,
  maxItemDurability,
  type ArmorId,
  type ArmorSlot,
  type Equipment,
  type Inventory,
  type ItemId,
  type ItemStack,
} from "../../shared/game.ts";
import * as BS from "../../shared/bundleStrings.ts";
import {
  BLOCK,
  validateVoxelRuntimeSnapshotDetailed,
  type BedStructure,
  type BlockId,
  type VoxelRuntimeSnapshot,
  type WorldEdit,
} from "../game/types.ts";
import { validateBedStructures } from "../game/localBeds.ts";
import { validateFurnaceState, type FurnaceState } from "../../shared/furnaces.ts";
import type { LocalGameMode } from "./localCommands.ts";
import { LOCAL_DROP_TERMINAL_VELOCITY } from "./localDropGravity.ts";

export const SINGLEPLAYER_SAVE_FORMAT = "lakecraft.singleplayer" as const;
export const SINGLEPLAYER_SAVE_VERSION = 2 as const;
export const SINGLEPLAYER_GENERATOR_VERSION = 2 as const;
export const SINGLEPLAYER_SAVE_SLOT_A_KEY = "lakecraft.singleplayer.save.a";
export const SINGLEPLAYER_SAVE_SLOT_B_KEY = "lakecraft.singleplayer.save.b";
export const SINGLEPLAYER_SAVE_HEAD_KEY = "lakecraft.singleplayer.save.head";
export const SINGLEPLAYER_WORLD_STORAGE_PREFIX = "lakecraft.singleplayer.world.";
/** localStorage is commonly quota-limited to a few MiB; leave room for the second slot and other app data. */
export const SINGLEPLAYER_SAVE_MAX_SLOT_CHARS = 900_000;
// Namespaced world journals share one synchronous localStorage origin. Keep
// each of the six registry worlds below a fixed per-slot budget so one world
// cannot consume the origin before its siblings can save.
export const SINGLEPLAYER_WORLD_SAVE_MAX_SLOT_CHARS = 150_000;

export const SINGLEPLAYER_SAVE_LIMITS = Object.freeze({
  worldCoordinate: 30_000_000,
  verticalCoordinate: 2_048,
  edits: 12_000,
  beds: 6_000,
  drops: 512,
  chests: 512,
  furnaces: 512,
  mobs: 512,
  primedTnt: 64,
  progressionEntries: 512,
  identifierChars: 96,
});

const MAX_TIMESTAMP = 8_640_000_000_000_000;
const SINGLEPLAYER_WORLD_MIN_Y = 1;
const SINGLEPLAYER_WORLD_MAX_Y = 192;
const MAX_WEATHER_MS = 7 * 24 * 60 * 60 * 1_000;
const ARMOR_SLOTS: readonly ArmorSlot[] = ["head", "chest", "legs", "feet"];
const WEATHER_KINDS = new Set(["clear", "rain", "thunder"]);

export type SinglePlayerSaveSlot = "a" | "b";

export interface SinglePlayerStorageAdapter {
  getItem(key: string): string | null;
  listKeys?(): string[];
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

const UNAVAILABLE_SINGLEPLAYER_STORAGE: SinglePlayerStorageAdapter = {
  getItem: () => { throw new Error("Browser storage is unavailable."); },
  setItem: () => { throw new Error("Browser storage is unavailable."); },
};

/**
 * Captures the browser storage getter and its methods behind one guarded
 * boundary. Privacy modes may throw while reading `window.localStorage` or a
 * method property, before an ordinary storage call can enter its own try/catch.
 */
export function browserSinglePlayerStorage(): SinglePlayerStorageAdapter {
  try {
    const storage = window.localStorage;
    const getItem = storage.getItem;
    const setItem = storage.setItem;
    const removeItem = storage.removeItem;
    const key = storage.key;
    if (typeof getItem !== "function" || typeof setItem !== "function") {
      return UNAVAILABLE_SINGLEPLAYER_STORAGE;
    }
    return {
      getItem: (key) => getItem.call(storage, key),
      ...(typeof key === "function"
        ? { listKeys: () => {
          const length = storage.length;
          const keys = Array.from({ length }, (_, index) => key.call(storage, index));
          if (storage.length !== length || keys.some((value) => typeof value !== "string")
            || new Set(keys).size !== length) {
            throw new Error("Browser storage enumeration changed.");
          }
          return keys as string[];
        } }
        : {}),
      setItem: (key, value) => setItem.call(storage, key, value),
      ...(typeof removeItem === "function"
        ? { removeItem: (key: string) => removeItem.call(storage, key) }
        : {}),
    };
  } catch {
    return UNAVAILABLE_SINGLEPLAYER_STORAGE;
  }
}

export interface SinglePlayerWorldStorageOptions {
  worldId?: string;
}

export interface SinglePlayerPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

export interface SinglePlayerWeatherState {
  kind: "clear" | "rain" | "thunder";
  remainingMs: number;
}

export interface SinglePlayerDropState {
  dropId: string;
  item: ItemStack;
  x: number;
  y: number;
  z: number;
  droppedAt: number;
  velocityY: number;
  settled: boolean;
}

export interface SinglePlayerChestState {
  coordKey: string;
  inventory: Array<ItemStack | null>;
}

export type SinglePlayerFurnaceState = FurnaceState;

export interface SinglePlayerPrimedTntState {
  eventId: string;
  x: number;
  y: number;
  z: number;
  ignitedAt: number;
  dueAt: number;
}

export interface SinglePlayerSnapshot {
  world: {
    worldId: string;
    generatorVersion: number;
    seed: number;
    createdAt: number;
    activePlayMs: number;
    gameMode: LocalGameMode;
    weather: SinglePlayerWeatherState;
    edits: WorldEdit[];
    beds: BedStructure[];
  };
  player: {
    inventory: Inventory;
    equipment: Equipment;
    selectedHotbar: number;
    hunger: number;
  };
  progression: {
    experience: number;
    recipes: string[];
    advancements: string[];
  };
  drops: SinglePlayerDropState[];
  chests: SinglePlayerChestState[];
  furnaces: SinglePlayerFurnaceState[];
  primedTnt: SinglePlayerPrimedTntState[];
  /** Authoritative engine pose/respawn/health/time/mob simulation snapshot. Null only for a fresh world. */
  runtime: VoxelRuntimeSnapshot | null;
}

export interface SinglePlayerSaveEnvelope {
  checksum: string;
  format: typeof SINGLEPLAYER_SAVE_FORMAT;
  payload: SinglePlayerSnapshot;
  savedAt: number;
  sequence: number;
  version: typeof SINGLEPLAYER_SAVE_VERSION;
}

export type SinglePlayerSnapshotValidation =
  | { ok: true; snapshot: SinglePlayerSnapshot }
  | { ok: false; reason: "invalid_snapshot"; path: string };

export type SinglePlayerLoadResult =
  | { status: "empty"; snapshot: null; sequence: 0 }
  | { status: "loaded" | "recovered"; snapshot: SinglePlayerSnapshot; sequence: number; savedAt: number; slot: SinglePlayerSaveSlot; issues: string[] }
  | { status: "corrupt"; snapshot: null; sequence: 0; reason: "storage_read_failed" | "no_valid_snapshot"; issues: string[] }
  | { status: "unsupported"; snapshot: null; sequence: 0; versions: number[]; issues: string[] };

export type SinglePlayerSaveResult =
  | { ok: true; envelope: SinglePlayerSaveEnvelope; slot: SinglePlayerSaveSlot; sequence: number; chars: number; headUpdated: boolean }
  | { ok: false; reason: "invalid_snapshot" | "too_large" | "storage_read_failed" | "storage_write_failed" | "readback_failed" | "unsafe_existing_data"; path?: string; previousSequence: number };

export type SinglePlayerResetResult =
  | { ok: true; removedKeys: string[] }
  | {
    ok: false;
    reason: "storage_read_failed" | "storage_delete_unavailable" | "storage_delete_failed" | "storage_verify_failed";
    key?: string;
    mutationStarted: boolean;
  };

export function unsupportedSinglePlayerSaveMessage(versions: readonly number[]): string {
  return versions.length > 0 && versions.every((version) => version < SINGLEPLAYER_SAVE_VERSION)
    ? "This world uses the retired terrain coordinate system and cannot be loaded. No data was changed; reset it to start fresh."
    : "This world needs a newer Lakecraft version. Saving is disabled; reset it to start fresh.";
}

type ParsedSlot =
  | { kind: "empty"; slot: SinglePlayerSaveSlot }
  | { kind: "valid"; slot: SinglePlayerSaveSlot; envelope: SinglePlayerSaveEnvelope; raw: string }
  | { kind: "unsupported"; slot: SinglePlayerSaveSlot; version: number }
  | { kind: "corrupt"; slot: SinglePlayerSaveSlot; reason: string };

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

function finiteNumber(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function identifier(value: unknown, allowEmpty = false): value is string {
  return typeof value === "string" && (allowEmpty || value.length > 0)
    && value.length <= SINGLEPLAYER_SAVE_LIMITS.identifierChars
    && /^[A-Za-z0-9_.:\-]*$/.test(value);
}

function worldStorageIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 64
    && /^[a-z0-9][a-z0-9-]*$/.test(value);
}

export function singlePlayerWorldStorageKey(worldId: string, key: string): string {
  if (!worldStorageIdentifier(worldId) || !key.startsWith("lakecraft.singleplayer.")) {
    throw new Error("Invalid single-player world storage namespace.");
  }
  return `${SINGLEPLAYER_WORLD_STORAGE_PREFIX}${worldId}.${key.slice("lakecraft.singleplayer.".length)}`;
}

export function singlePlayerWorldStorageKeys(worldId: string): readonly string[] {
  return [
    singlePlayerWorldStorageKey(worldId, SINGLEPLAYER_SAVE_HEAD_KEY),
    singlePlayerWorldStorageKey(worldId, SINGLEPLAYER_SAVE_SLOT_A_KEY),
    singlePlayerWorldStorageKey(worldId, SINGLEPLAYER_SAVE_SLOT_B_KEY),
  ];
}

export function createSinglePlayerWorldStorage(
  storage: SinglePlayerStorageAdapter,
  worldId: string,
): SinglePlayerStorageAdapter {
  // Validate before returning an adapter so an invalid registry entry can never
  // escape its namespace and touch another world's journal.
  singlePlayerWorldStorageKey(worldId, SINGLEPLAYER_SAVE_HEAD_KEY);
  let removeItem: ((key: string) => void) | undefined;
  try {
    const candidate = storage.removeItem;
    if (typeof candidate === "function") {
      removeItem = (key) => candidate.call(storage, singlePlayerWorldStorageKey(worldId, key));
    }
  } catch {
    // A throwing optional-method getter means deletion is unavailable.
  }
  return {
    getItem: (key) => storage.getItem(singlePlayerWorldStorageKey(worldId, key)),
    setItem: (key, value) => storage.setItem(singlePlayerWorldStorageKey(worldId, key), value),
    ...(removeItem ? { removeItem } : {}),
  };
}

function selectedStorage(
  storage: SinglePlayerStorageAdapter,
  options: SinglePlayerWorldStorageOptions,
): SinglePlayerStorageAdapter {
  return options.worldId ? createSinglePlayerWorldStorage(storage, options.worldId) : storage;
}

function coordinateKey(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 64) return false;
  const match = /^(-?\d+):(-?\d+):(-?\d+)$/.exec(value);
  if (!match) return false;
  const [x, y, z] = match.slice(1).map(Number);
  return safeInteger(x, -SINGLEPLAYER_SAVE_LIMITS.worldCoordinate, SINGLEPLAYER_SAVE_LIMITS.worldCoordinate)
    && safeInteger(y, SINGLEPLAYER_WORLD_MIN_Y, SINGLEPLAYER_WORLD_MAX_Y)
    && safeInteger(z, -SINGLEPLAYER_SAVE_LIMITS.worldCoordinate, SINGLEPLAYER_SAVE_LIMITS.worldCoordinate)
    && value === `${x}:${y}:${z}`;
}

function validateStack(value: unknown): ItemStack | null | undefined {
  if (value === null) return null;
  if (!isRecord(value) || !exactKeys(value, value.durability === undefined
    ? ["itemId", "count"]
    : ["itemId", "count", "durability"])) return undefined;
  if (typeof value.itemId !== "string" || !Object.prototype.hasOwnProperty.call(ITEMS, value.itemId)) return undefined;
  const itemId = value.itemId as ItemId;
  const definition = ITEMS[itemId];
  if (!safeInteger(value.count, 1, definition.maxStack)) return undefined;
  const maximum = maxItemDurability(itemId);
  if (maximum === null) {
    return value.durability === undefined ? { itemId, count: value.count } : undefined;
  }
  if (value.count !== 1 || !safeInteger(value.durability, 1, maximum)) return undefined;
  return { itemId, count: 1, durability: value.durability };
}

function validateInventory(value: unknown, size = INVENTORY_SIZE): Inventory | null {
  if (!Array.isArray(value) || value.length !== size) return null;
  const inventory: Inventory = [];
  for (const candidate of value) {
    const stack = validateStack(candidate);
    if (stack === undefined) return null;
    inventory.push(stack);
  }
  return inventory;
}

function validateEquipment(value: unknown): Equipment | null {
  if (!isRecord(value) || !exactKeys(value, ARMOR_SLOTS)) return null;
  const equipment = createEmptyEquipment();
  for (const slot of ARMOR_SLOTS) {
    const candidate = value[slot];
    if (candidate === null) continue;
    if (!isRecord(candidate) || !exactKeys(candidate, ["itemId", "durability"])
      || typeof candidate.itemId !== "string" || !Object.prototype.hasOwnProperty.call(ITEMS, candidate.itemId)) return null;
    const itemId = candidate.itemId as ItemId;
    const armor = ITEMS[itemId].armor;
    if (!armor || armor.slot !== slot || !safeInteger(candidate.durability, 1, armor.maxDurability)) return null;
    equipment[slot] = { itemId: itemId as ArmorId, durability: candidate.durability };
  }
  return equipment;
}

function validateEdits(value: unknown): WorldEdit[] | null {
  if (!Array.isArray(value) || value.length > SINGLEPLAYER_SAVE_LIMITS.edits) return null;
  const edits: WorldEdit[] = [];
  const coordinates = new Set<string>();
  for (const candidate of value) {
    if (!isRecord(candidate) || !exactKeys(candidate, ["x", "y", "z", "block"])
      || !safeInteger(candidate.x, -SINGLEPLAYER_SAVE_LIMITS.worldCoordinate, SINGLEPLAYER_SAVE_LIMITS.worldCoordinate)
      || !safeInteger(candidate.y, SINGLEPLAYER_WORLD_MIN_Y + 1, SINGLEPLAYER_WORLD_MAX_Y)
      || !safeInteger(candidate.z, -SINGLEPLAYER_SAVE_LIMITS.worldCoordinate, SINGLEPLAYER_SAVE_LIMITS.worldCoordinate)
      || !safeInteger(candidate.block, BLOCK.AIR, BLOCK.NETHER_WART_BLOCK)
      || candidate.block === BLOCK.BEDROCK) return null;
    const key = `${candidate.x}:${candidate.y}:${candidate.z}`;
    if (coordinates.has(key)) return null;
    coordinates.add(key);
    edits.push({ x: candidate.x, y: candidate.y, z: candidate.z, block: candidate.block as BlockId });
  }
  return edits.sort((left, right) => left.x - right.x || left.y - right.y || left.z - right.z);
}

function validateDrops(value: unknown): SinglePlayerDropState[] | null {
  if (!Array.isArray(value) || value.length > SINGLEPLAYER_SAVE_LIMITS.drops) return null;
  const drops: SinglePlayerDropState[] = [];
  const ids = new Set<string>();
  for (const candidate of value) {
    if (!isRecord(candidate)
      || !(exactKeys(candidate, ["dropId", "item", "x", "y", "z", "droppedAt", "velocityY", "settled"])
        // Old saves used a leave-radius latch. Accept and discard it so those
        // worlds migrate naturally to the universal timestamp-only delay.
        || exactKeys(candidate, ["dropId", "item", "x", "y", "z", "droppedAt", "velocityY", "settled", "ownerPickupBlocked"]))
      || !identifier(candidate.dropId)
      || !finiteNumber(candidate.x, -SINGLEPLAYER_SAVE_LIMITS.worldCoordinate, SINGLEPLAYER_SAVE_LIMITS.worldCoordinate)
      || !finiteNumber(candidate.y, SINGLEPLAYER_WORLD_MIN_Y, SINGLEPLAYER_WORLD_MAX_Y)
      || !finiteNumber(candidate.z, -SINGLEPLAYER_SAVE_LIMITS.worldCoordinate, SINGLEPLAYER_SAVE_LIMITS.worldCoordinate)
      || ids.has(candidate.dropId) || !safeInteger(candidate.droppedAt, 0, MAX_TIMESTAMP)
      || !finiteNumber(candidate.velocityY, LOCAL_DROP_TERMINAL_VELOCITY, 0)
      || typeof candidate.settled !== "boolean"
      || (candidate.ownerPickupBlocked !== undefined && typeof candidate.ownerPickupBlocked !== "boolean")
      || (candidate.settled && candidate.velocityY !== 0)) return null;
    const item = validateStack(candidate.item);
    if (!item) return null;
    ids.add(candidate.dropId);
    drops.push({
      dropId: candidate.dropId,
      item,
      x: candidate.x,
      y: candidate.y,
      z: candidate.z,
      droppedAt: candidate.droppedAt,
      velocityY: candidate.velocityY,
      settled: candidate.settled,
    });
  }
  return drops.sort((left, right) => left.dropId.localeCompare(right.dropId));
}

function validateChests(value: unknown): SinglePlayerChestState[] | null {
  if (!Array.isArray(value) || value.length > SINGLEPLAYER_SAVE_LIMITS.chests) return null;
  const chests: SinglePlayerChestState[] = [];
  const coordinates = new Set<string>();
  for (const candidate of value) {
    if (!isRecord(candidate) || !exactKeys(candidate, ["coordKey", "inventory"]) || !coordinateKey(candidate.coordKey)
      || coordinates.has(candidate.coordKey)) return null;
    const inventory = validateInventory(candidate.inventory, 27);
    if (!inventory) return null;
    coordinates.add(candidate.coordKey);
    chests.push({ coordKey: candidate.coordKey, inventory });
  }
  return chests.sort((left, right) => left.coordKey.localeCompare(right.coordKey));
}

function validateFurnaces(value: unknown): SinglePlayerFurnaceState[] | null {
  if (!Array.isArray(value) || value.length > SINGLEPLAYER_SAVE_LIMITS.furnaces) return null;
  const furnaces: SinglePlayerFurnaceState[] = [];
  const coordinates = new Set<string>();
  for (const candidate of value) {
    if (!isRecord(candidate) || typeof candidate.coordKey !== "string" || !coordinateKey(candidate.coordKey)
      || coordinates.has(candidate.coordKey)) return null;
    const validation = validateFurnaceState(candidate, candidate.coordKey);
    if (!validation.ok) return null;
    coordinates.add(validation.state.coordKey);
    furnaces.push(validation.state);
  }
  return furnaces.sort((left, right) => left.coordKey.localeCompare(right.coordKey));
}

function validatePrimedTnt(value: unknown): SinglePlayerPrimedTntState[] | null {
  if (!Array.isArray(value) || value.length > SINGLEPLAYER_SAVE_LIMITS.primedTnt) return null;
  const fuses: SinglePlayerPrimedTntState[] = [];
  const ids = new Set<string>();
  for (const candidate of value) {
    if (!isRecord(candidate) || !exactKeys(candidate, ["eventId", "x", "y", "z", "ignitedAt", "dueAt"])
      || !identifier(candidate.eventId) || ids.has(candidate.eventId)
      || !safeInteger(candidate.x, -SINGLEPLAYER_SAVE_LIMITS.worldCoordinate, SINGLEPLAYER_SAVE_LIMITS.worldCoordinate)
      || !safeInteger(candidate.y, SINGLEPLAYER_WORLD_MIN_Y + 1, SINGLEPLAYER_WORLD_MAX_Y)
      || !safeInteger(candidate.z, -SINGLEPLAYER_SAVE_LIMITS.worldCoordinate, SINGLEPLAYER_SAVE_LIMITS.worldCoordinate)
      || !safeInteger(candidate.ignitedAt, 0, MAX_TIMESTAMP) || !safeInteger(candidate.dueAt, candidate.ignitedAt, MAX_TIMESTAMP)) return null;
    ids.add(candidate.eventId);
    fuses.push({ eventId: candidate.eventId, x: candidate.x, y: candidate.y, z: candidate.z, ignitedAt: candidate.ignitedAt, dueAt: candidate.dueAt });
  }
  return fuses.sort((left, right) => left.eventId.localeCompare(right.eventId));
}

function validateProgression(value: unknown): SinglePlayerSnapshot["progression"] | null {
  if (!isRecord(value) || !exactKeys(value, ["experience", "recipes", "advancements"])
    || !safeInteger(value.experience, 0, Number.MAX_SAFE_INTEGER)) return null;
  const validateList = (candidate: unknown): string[] | null => {
    if (!Array.isArray(candidate) || candidate.length > SINGLEPLAYER_SAVE_LIMITS.progressionEntries) return null;
    const output: string[] = [];
    const unique = new Set<string>();
    for (const entry of candidate) {
      if (!identifier(entry) || unique.has(entry)) return null;
      unique.add(entry);
      output.push(entry);
    }
    return output.sort((left, right) => left.localeCompare(right));
  };
  const recipes = validateList(value.recipes);
  const advancements = validateList(value.advancements);
  return recipes && advancements ? { experience: value.experience, recipes, advancements } : null;
}

export function validateSinglePlayerSnapshot(value: unknown): SinglePlayerSnapshotValidation {
  if (!isRecord(value) || !exactKeys(value, ["world", "player", "progression", "drops", "chests", "furnaces", "primedTnt", "runtime"])) {
    return { ok: false, reason: BS.invalidSnapshot, path: "$" };
  }
  if (!isRecord(value.world)
    || !exactKeys(value.world, ["worldId", "generatorVersion", "seed", "createdAt", "activePlayMs", "gameMode", "weather", "edits", "beds"])
    || !identifier(value.world.worldId)
    || value.world.generatorVersion !== SINGLEPLAYER_GENERATOR_VERSION
    || !safeInteger(value.world.seed, -2_147_483_648, 2_147_483_647)
    || !safeInteger(value.world.createdAt, 0, MAX_TIMESTAMP)
    || !safeInteger(value.world.activePlayMs, 0, MAX_TIMESTAMP)
    || (value.world.gameMode !== "survival" && value.world.gameMode !== "creative")) {
    return { ok: false, reason: BS.invalidSnapshot, path: "$.world" };
  }
  if (!isRecord(value.world.weather) || !exactKeys(value.world.weather, ["kind", "remainingMs"])
    || typeof value.world.weather.kind !== "string" || !WEATHER_KINDS.has(value.world.weather.kind)
    || !safeInteger(value.world.weather.remainingMs, 0, MAX_WEATHER_MS)) return { ok: false, reason: BS.invalidSnapshot, path: "$.world.weather" };
  const edits = validateEdits(value.world.edits);
  if (!edits) return { ok: false, reason: BS.invalidSnapshot, path: "$.world.edits" };
  const beds = validateBedStructures(value.world.beds, edits, SINGLEPLAYER_SAVE_LIMITS.beds);
  if (!beds) return { ok: false, reason: BS.invalidSnapshot, path: "$.world.beds" };

  if (!isRecord(value.player) || !exactKeys(value.player, ["inventory", "equipment", "selectedHotbar", "hunger"])) {
    return { ok: false, reason: BS.invalidSnapshot, path: "$.player" };
  }
  const inventory = validateInventory(value.player.inventory);
  const equipment = validateEquipment(value.player.equipment);
  if (!inventory) return { ok: false, reason: BS.invalidSnapshot, path: "$.player.inventory" };
  if (!equipment) return { ok: false, reason: BS.invalidSnapshot, path: "$.player.equipment" };
  if (!safeInteger(value.player.selectedHotbar, 0, HOTBAR_SIZE - 1)
    || !safeInteger(value.player.hunger, 0, MAX_HUNGER)) {
    return { ok: false, reason: BS.invalidSnapshot, path: "$.player.vitals" };
  }
  const progression = validateProgression(value.progression);
  if (!progression) return { ok: false, reason: BS.invalidSnapshot, path: "$.progression" };
  const drops = validateDrops(value.drops);
  const chests = validateChests(value.chests);
  const furnaces = validateFurnaces(value.furnaces);
  const primedTnt = validatePrimedTnt(value.primedTnt);
  const runtimeValidation = value.runtime === null ? null : validateVoxelRuntimeSnapshotDetailed(value.runtime);
  const runtime = runtimeValidation?.ok ? runtimeValidation.snapshot : null;
  if (!drops) return { ok: false, reason: BS.invalidSnapshot, path: "$.drops" };
  if (!chests) return { ok: false, reason: BS.invalidSnapshot, path: "$.chests" };
  if (!furnaces) return { ok: false, reason: BS.invalidSnapshot, path: "$.furnaces" };
  if (!primedTnt) return { ok: false, reason: BS.invalidSnapshot, path: "$.primedTnt" };
  if (value.runtime !== null && (!runtimeValidation || !runtimeValidation.ok)) {
    const runtimePath = runtimeValidation?.path === "$" ? "" : runtimeValidation?.path.slice(1);
    return { ok: false, reason: BS.invalidSnapshot, path: `$.runtime${runtimePath ?? ""}` };
  }

  return {
    ok: true,
    snapshot: {
      world: {
        worldId: value.world.worldId, generatorVersion: value.world.generatorVersion, seed: value.world.seed,
        createdAt: value.world.createdAt, activePlayMs: value.world.activePlayMs,
        gameMode: value.world.gameMode as LocalGameMode, beds,
        weather: { kind: value.world.weather.kind as SinglePlayerWeatherState["kind"], remainingMs: value.world.weather.remainingMs }, edits,
      },
      player: { inventory, equipment, selectedHotbar: value.player.selectedHotbar, hunger: value.player.hunger },
      progression,
      drops, chests, furnaces, primedTnt, runtime,
    },
  };
}

export function createDefaultSinglePlayerSnapshot(seed = 7_319, createdAt = 0, worldId = "local-default"): SinglePlayerSnapshot {
  return {
    world: {
      worldId,
      generatorVersion: SINGLEPLAYER_GENERATOR_VERSION,
      seed,
      createdAt,
      activePlayMs: 0,
      gameMode: "survival",
      weather: { kind: "clear", remainingMs: 0 },
      edits: [],
      beds: [],
    },
    player: {
      inventory: createStarterInventory(),
      equipment: createEmptyEquipment(),
      selectedHotbar: 2,
      hunger: MAX_HUNGER,
    },
    progression: { experience: 0, recipes: [], advancements: [] },
    drops: [], chests: [], furnaces: [], primedTnt: [], runtime: null,
  };
}

/** Stable key ordering makes snapshots byte-for-byte reproducible and keeps checksums independent of caller object insertion order. */
export function canonicalSinglePlayerJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalSinglePlayerJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalSinglePlayerJson(record[key])}`).join(",")}}`;
}

export function singlePlayerSaveChecksum(value: unknown): string {
  const text = typeof value === "string" ? value : canonicalSinglePlayerJson(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function envelopeBody(payload: SinglePlayerSnapshot, sequence: number, savedAt: number): Omit<SinglePlayerSaveEnvelope, "checksum"> {
  return { format: SINGLEPLAYER_SAVE_FORMAT, payload, savedAt, sequence, version: SINGLEPLAYER_SAVE_VERSION };
}

export function serializeSinglePlayerSave(payload: SinglePlayerSnapshot, sequence: number, savedAt: number):
  | { ok: true; envelope: SinglePlayerSaveEnvelope; raw: string }
  | { ok: false; reason: "invalid_snapshot" | "too_large"; path?: string } {
  const validated = validateSinglePlayerSnapshot(payload);
  if (!validated.ok) return validated;
  if (!safeInteger(sequence, 1, Number.MAX_SAFE_INTEGER) || !safeInteger(savedAt, 0, MAX_TIMESTAMP)) {
    return { ok: false, reason: BS.invalidSnapshot, path: "$.envelope" };
  }
  const body = envelopeBody(validated.snapshot, sequence, savedAt);
  const envelope: SinglePlayerSaveEnvelope = { checksum: singlePlayerSaveChecksum(body), ...body };
  const raw = canonicalSinglePlayerJson(envelope);
  return raw.length <= SINGLEPLAYER_SAVE_MAX_SLOT_CHARS
    ? { ok: true, envelope, raw }
    : { ok: false, reason: "too_large" };
}

function parseSlotRaw(slot: SinglePlayerSaveSlot, raw: string | null, expectedWorldId?: string): ParsedSlot {
  if (raw === null) return { kind: "empty", slot };
  if (raw.length === 0 || raw.length > SINGLEPLAYER_SAVE_MAX_SLOT_CHARS) return { kind: "corrupt", slot, reason: "invalid_size" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: "corrupt", slot, reason: "invalid_json" };
  }
  if (!isRecord(parsed)) return { kind: "corrupt", slot, reason: "invalid_envelope" };
  if (parsed.format === SINGLEPLAYER_SAVE_FORMAT && typeof parsed.version === "number"
    && Number.isSafeInteger(parsed.version) && parsed.version !== SINGLEPLAYER_SAVE_VERSION) {
    return { kind: "unsupported", slot, version: parsed.version };
  }
  if (!exactKeys(parsed, ["checksum", "format", "payload", "savedAt", "sequence", "version"])
    || parsed.format !== SINGLEPLAYER_SAVE_FORMAT || parsed.version !== SINGLEPLAYER_SAVE_VERSION
    || typeof parsed.checksum !== "string" || !/^[0-9a-f]{8}$/.test(parsed.checksum)
    || !safeInteger(parsed.sequence, 1, Number.MAX_SAFE_INTEGER) || !safeInteger(parsed.savedAt, 0, MAX_TIMESTAMP)) {
    return { kind: "corrupt", slot, reason: "invalid_envelope" };
  }
  const validated = validateSinglePlayerSnapshot(parsed.payload);
  if (!validated.ok) return { kind: "corrupt", slot, reason: validated.path };
  if (expectedWorldId && validated.snapshot.world.worldId !== expectedWorldId) {
    return { kind: "corrupt", slot, reason: "$.world.worldId" };
  }
  const body = envelopeBody(validated.snapshot, parsed.sequence, parsed.savedAt);
  if (singlePlayerSaveChecksum(body) !== parsed.checksum) return { kind: "corrupt", slot, reason: "checksum_mismatch" };
  const envelope: SinglePlayerSaveEnvelope = { checksum: parsed.checksum, ...body };
  if (canonicalSinglePlayerJson(envelope) !== raw) return { kind: "corrupt", slot, reason: "noncanonical_envelope" };
  return { kind: "valid", slot, envelope, raw };
}

function slotKey(slot: SinglePlayerSaveSlot): string {
  return slot === "a" ? SINGLEPLAYER_SAVE_SLOT_A_KEY : SINGLEPLAYER_SAVE_SLOT_B_KEY;
}

function readSlots(storage: SinglePlayerStorageAdapter, expectedWorldId?: string): { slots: ParsedSlot[]; readFailed: boolean } {
  const slots: ParsedSlot[] = [];
  let readFailed = false;
  for (const slot of ["a", "b"] as const) {
    try {
      slots.push(parseSlotRaw(slot, storage.getItem(slotKey(slot)), expectedWorldId));
    } catch {
      readFailed = true;
      slots.push({ kind: "corrupt", slot, reason: "storage_read_failed" });
    }
  }
  return { slots, readFailed };
}

function highestValid(slots: readonly ParsedSlot[]): Extract<ParsedSlot, { kind: "valid" }> | null {
  const valid = slots.filter((slot): slot is Extract<ParsedSlot, { kind: "valid" }> => slot.kind === "valid");
  valid.sort((left, right) => right.envelope.sequence - left.envelope.sequence || left.slot.localeCompare(right.slot));
  return valid[0] ?? null;
}

function readHead(storage: SinglePlayerStorageAdapter): { slot: SinglePlayerSaveSlot; sequence: number } | null {
  try {
    const raw = storage.getItem(SINGLEPLAYER_SAVE_HEAD_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) && exactKeys(parsed, ["sequence", "slot"])
      && (parsed.slot === "a" || parsed.slot === "b") && safeInteger(parsed.sequence, 1, Number.MAX_SAFE_INTEGER)
      ? { slot: parsed.slot, sequence: parsed.sequence }
      : null;
  } catch {
    return null;
  }
}

export function loadSinglePlayerSave(
  storage: SinglePlayerStorageAdapter,
  options: SinglePlayerWorldStorageOptions = {},
): SinglePlayerLoadResult {
  const targetStorage = selectedStorage(storage, options);
  const scanned = readSlots(targetStorage, options.worldId);
  const issues = scanned.slots.flatMap((slot) => slot.kind === "corrupt" ? [`${slot.slot}:${slot.reason}`]
    : slot.kind === "unsupported" ? [`${slot.slot}:unsupported_v${slot.version}`] : []);
  const unsupported = scanned.slots.filter((slot): slot is Extract<ParsedSlot, { kind: "unsupported" }> => slot.kind === "unsupported");
  // A future client may have written either slot. Never load an older sibling
  // and later overwrite the unknown format during ordinary play.
  if (unsupported.length > 0) {
    return { status: "unsupported", snapshot: null, sequence: 0, versions: [...new Set(unsupported.map(({ version }) => version))].sort((a, b) => a - b), issues };
  }
  const selected = highestValid(scanned.slots);
  if (selected) {
    const head = readHead(targetStorage);
    const recovered = issues.length > 0 || Boolean(head && (head.slot !== selected.slot || head.sequence !== selected.envelope.sequence));
    return {
      status: recovered ? "recovered" : "loaded",
      snapshot: selected.envelope.payload,
      sequence: selected.envelope.sequence,
      savedAt: selected.envelope.savedAt,
      slot: selected.slot,
      issues,
    };
  }
  const occupiedInvalid = scanned.slots.some((slot) => slot.kind === "corrupt");
  if (occupiedInvalid || scanned.readFailed) {
    return { status: "corrupt", snapshot: null, sequence: 0, reason: scanned.readFailed ? "storage_read_failed" : "no_valid_snapshot", issues };
  }
  return { status: "empty", snapshot: null, sequence: 0 };
}

export function saveSinglePlayerSnapshot(
  storage: SinglePlayerStorageAdapter,
  snapshot: SinglePlayerSnapshot,
  savedAt = Date.now(),
  options: SinglePlayerWorldStorageOptions = {},
): SinglePlayerSaveResult {
  const targetStorage = selectedStorage(storage, options);
  if (options.worldId && snapshot.world.worldId !== options.worldId) {
    return { ok: false, reason: BS.invalidSnapshot, path: "$.world.worldId", previousSequence: 0 };
  }
  const scanned = readSlots(targetStorage, options.worldId);
  const current = highestValid(scanned.slots);
  const previousSequence = current?.envelope.sequence ?? 0;
  if (scanned.readFailed) return { ok: false, reason: "storage_read_failed", previousSequence };
  if (scanned.slots.some((slot) => slot.kind === "unsupported")
    || (!current && scanned.slots.some((slot) => slot.kind !== "empty"))) {
    return { ok: false, reason: "unsafe_existing_data", previousSequence };
  }
  if (previousSequence >= Number.MAX_SAFE_INTEGER) return { ok: false, reason: BS.invalidSnapshot, path: "$.envelope.sequence", previousSequence };
  const serialized = serializeSinglePlayerSave(snapshot, previousSequence + 1, savedAt);
  if (!serialized.ok) return { ok: false, reason: serialized.reason, path: serialized.path, previousSequence };
  if (options.worldId && serialized.raw.length > SINGLEPLAYER_WORLD_SAVE_MAX_SLOT_CHARS) {
    return { ok: false, reason: "too_large", previousSequence };
  }
  const target: SinglePlayerSaveSlot = current ? (current.slot === "a" ? "b" : "a") : "a";
  try {
    targetStorage.setItem(slotKey(target), serialized.raw);
  } catch {
    return { ok: false, reason: "storage_write_failed", previousSequence };
  }
  let readback: string | null;
  try {
    readback = targetStorage.getItem(slotKey(target));
  } catch {
    return { ok: false, reason: "readback_failed", previousSequence };
  }
  const verified = parseSlotRaw(target, readback, options.worldId);
  if (readback !== serialized.raw || verified.kind !== "valid" || verified.envelope.sequence !== previousSequence + 1) {
    return { ok: false, reason: "readback_failed", previousSequence };
  }
  let headUpdated = true;
  try {
    targetStorage.setItem(SINGLEPLAYER_SAVE_HEAD_KEY, canonicalSinglePlayerJson({ sequence: previousSequence + 1, slot: target }));
  } catch {
    headUpdated = false;
  }
  return { ok: true, envelope: serialized.envelope, slot: target, sequence: previousSequence + 1, chars: serialized.raw.length, headUpdated };
}

/**
 * Explicitly deletes the local world journal after the UI has obtained user
 * confirmation. The selected valid slot is removed last so an interrupted
 * reset retains the best recoverable snapshot for as long as possible.
 */
export function resetSinglePlayerSave(
  storage: SinglePlayerStorageAdapter,
  options: SinglePlayerWorldStorageOptions = {},
): SinglePlayerResetResult {
  const targetStorage = selectedStorage(storage, options);
  let removeItem: ((key: string) => void) | null = null;
  try {
    const candidate = targetStorage.removeItem;
    if (typeof candidate === "function") removeItem = candidate.bind(targetStorage);
  } catch {
    // Treat a throwing optional-method getter as deletion being unavailable.
  }
  if (!removeItem) {
    return { ok: false, reason: "storage_delete_unavailable", mutationStarted: false };
  }
  const scanned = readSlots(targetStorage, options.worldId);
  const completeSlotScan = scanned.slots.length === 2
    && scanned.slots.some(({ slot }) => slot === "a")
    && scanned.slots.some(({ slot }) => slot === "b");
  if (scanned.readFailed || !completeSlotScan) {
    return { ok: false, reason: "storage_read_failed", mutationStarted: false };
  }
  const selected = highestValid(scanned.slots);
  const selectedKey = selected ? slotKey(selected.slot) : null;
  const nonSelectedKeys = [
    SINGLEPLAYER_SAVE_HEAD_KEY,
    SINGLEPLAYER_SAVE_SLOT_A_KEY,
    SINGLEPLAYER_SAVE_SLOT_B_KEY,
  ].filter((key) => key !== selectedKey);
  const orderedKeys = [
    ...nonSelectedKeys,
    ...(selectedKey ? [selectedKey] : []),
  ];
  const removedKeys: string[] = [];
  for (const key of orderedKeys) {
    try {
      removeItem(key);
    } catch {
      return { ok: false, reason: "storage_delete_failed", key, mutationStarted: true };
    }
    try {
      if (targetStorage.getItem(key) !== null) {
        return { ok: false, reason: "storage_verify_failed", key, mutationStarted: true };
      }
    } catch {
      return { ok: false, reason: "storage_verify_failed", key, mutationStarted: true };
    }
    removedKeys.push(key);
  }
  return { ok: true, removedKeys };
}
