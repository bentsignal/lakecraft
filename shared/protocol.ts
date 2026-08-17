import type { ItemId } from "./game.ts";
import * as BS from "./bundleStrings.ts";
import { EXPANDED_BLOCK_STATE_TYPES, NATURAL_BLOCK_STATE_TYPES, type ExpandedWorldBlockState, type NaturalBlockState } from "./expandedBuildingCatalog.ts";

export const BLOCK_TYPES = [
  "air",
  "grass",
  "dirt",
  "stone",
  "wood",
  "leaves",
  "planks",
  BS.craftingTable,
  "torch",
  "chest",
  BS.doorClosed,
  BS.doorOpen,
  "bed",
  BS.coalOre,
  BS.ironOre,
  BS.goldOre,
  BS.diamondOre,
  "furnace",
  "ladder",
  BS.cobblestone,
  "sand",
  "glass",
  "tnt",
  "gravel",
  "wool",
  "sapling",
  BS.stoneBricks,
  BS.oakFence,
  BS.oakFenceGateClosed,
  BS.oakFenceGateOpen,
  BS.stoneBrickSlab,
  "clay",
  "bricks",
  "bedrock",
  "wall_torch_east",
  "wall_torch_north",
  "wall_torch_south",
  "wall_torch_west",
  "oak_slab",
  "cobblestone_slab",
  "brick_slab",
  "oak_stairs_east",
  "oak_stairs_north",
  "oak_stairs_south",
  "oak_stairs_west",
  "cobblestone_stairs_east",
  "cobblestone_stairs_north",
  "cobblestone_stairs_south",
  "cobblestone_stairs_west",
  "stone_brick_stairs_east",
  "stone_brick_stairs_north",
  "stone_brick_stairs_south",
  "stone_brick_stairs_west",
  "brick_stairs_east",
  "brick_stairs_north",
  "brick_stairs_south",
  "brick_stairs_west",
  ...EXPANDED_BLOCK_STATE_TYPES,
  ...NATURAL_BLOCK_STATE_TYPES,
] as const;

export type BlockType = (typeof BLOCK_TYPES)[number] | ExpandedWorldBlockState | NaturalBlockState;

export type InventoryItem = ItemId;

export type InventoryCounts = Partial<Record<InventoryItem, number>>;

export type WorldEdit = {
  id: string;
  coordKey: string;
  x: string;
  y: string;
  z: string;
  blockType: string;
  actorId: string;
  editedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type PlayerPresence = {
  id: string;
  userId: string;
  displayName: string;
  color: string;
  x: string;
  y: string;
  z: string;
  yaw: string;
  pitch: string;
  /** Quantized velocity fields; older rows are surfaced as zero by the schema. */
  vx: string;
  vy: string;
  vz: string;
  /** Canonical shared item IDs; physically old Lakebed rows may omit these fields. */
  heldItem?: string;
  armorHead?: string;
  armorChest?: string;
  armorLegs?: string;
  armorFeet?: string;
  sessionId?: string;
  poseSequence?: string;
  fallGrounded?: boolean;
  fallPeakY?: string;
  heartbeatAt: string;
  online: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PersistedInventory = {
  id: string;
  userId: string;
  inventoryJson: string;
  revision: string;
  createdAt: string;
  updatedAt: string;
};

/** Sparse solo leases stay visible without spending the entire daily request bucket. */
export const PLAYER_STALE_AFTER_MS = 90_000;

export function blockCoordinateKey(x: number, y: number, z: number): string {
  if (![x, y, z].every(Number.isInteger)) {
    throw new Error("Block coordinates must be integers.");
  }
  return `${x}:${y}:${z}`;
}

export function parseBlockCoordinateKey(key: string): [number, number, number] | null {
  const parts = key.split(":");
  if (parts.length !== 3) return null;
  const coordinates = parts.map(Number);
  if (!coordinates.every(Number.isInteger)) return null;
  return coordinates as [number, number, number];
}

export function isBlockType(value: unknown): value is BlockType {
  return BS.isString(value) && (BLOCK_TYPES as readonly string[]).includes(value);
}

export function serializeInventory(inventory: InventoryCounts): string {
  return JSON.stringify(inventory);
}

export function parseInventory(value: string): InventoryCounts {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const inventory: InventoryCounts = {};
    for (const [item, count] of Object.entries(parsed)) {
      if (typeof count === "number" && Number.isInteger(count) && count >= 0) {
        inventory[item as InventoryItem] = count;
      }
    }
    return inventory;
  } catch {
    return {};
  }
}

/** Collapse any legacy duplicate coordinate rows; current server writes upsert each coordinate. */
export function latestWorldEdits(events: WorldEdit[]): WorldEdit[] {
  const latest = new Map<string, WorldEdit>();
  for (const event of events) {
    const previous = latest.get(event.coordKey);
    const eventTime = event.editedAt || event.updatedAt || event.createdAt;
    const previousTime = previous ? previous.editedAt || previous.updatedAt || previous.createdAt : "";
    if (!previous || eventTime > previousTime || (eventTime === previousTime && event.id > previous.id)) {
      latest.set(event.coordKey, event);
    }
  }
  return [...latest.values()];
}

/** Collapse legacy presence duplicates and omit stale/offline players; current server upserts users. */
export function activePlayerPresences(
  events: PlayerPresence[],
  now = Date.now(),
  staleAfterMs = PLAYER_STALE_AFTER_MS
): PlayerPresence[] {
  const orderedDecimal = (value: unknown): number => {
    if (!BS.isString(value) || !/^\d{1,16}$/.test(value)) return Number.NEGATIVE_INFINITY;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : Number.NEGATIVE_INFINITY;
  };
  const latest = new Map<string, PlayerPresence>();
  for (const event of events) {
    const previous = latest.get(event.userId);
    const eventHeartbeat = orderedDecimal(event.heartbeatAt);
    const previousHeartbeat = previous ? orderedDecimal(previous.heartbeatAt) : Number.NEGATIVE_INFINITY;
    const eventSequence = orderedDecimal(event.poseSequence ?? "0");
    const previousSequence = orderedDecimal(previous?.poseSequence ?? "0");
    const equalHeartbeatNewer = Boolean(previous) && eventHeartbeat === previousHeartbeat && (
      event.sessionId === previous?.sessionId && eventSequence !== previousSequence
        ? eventSequence > previousSequence
        : event.updatedAt !== previous?.updatedAt
          ? event.updatedAt > (previous?.updatedAt ?? "")
          : event.id > (previous?.id ?? "")
    );
    if (!previous
      || eventHeartbeat > previousHeartbeat
      || equalHeartbeatNewer) {
      latest.set(event.userId, event);
    }
  }
  return [...latest.values()].filter(
    (player) => {
      const heartbeatAt = orderedDecimal(player.heartbeatAt);
      return player.online && heartbeatAt !== Number.NEGATIVE_INFINITY
        && now >= heartbeatAt && now - heartbeatAt <= staleAfterMs;
    }
  );
}
