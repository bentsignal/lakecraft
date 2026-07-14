export const BLOCK_TYPES = [
  "air",
  "grass",
  "dirt",
  "stone",
  "wood",
  "leaves",
  "planks",
  "crafting_table",
  "torch",
  "chest",
  "door_closed",
  "door_open",
  "bed"
] as const;

export type BlockType = (typeof BLOCK_TYPES)[number];

export type InventoryItem =
  | BlockType
  | "stick"
  | "wooden_pickaxe"
  | "wooden_axe"
  | "stone_pickaxe"
  | "stone_axe";

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
  heartbeatAt: string;
  online: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PersistedInventory = {
  id: string;
  userId: string;
  inventoryJson: string;
  createdAt: string;
  updatedAt: string;
};

export const PLAYER_STALE_AFTER_MS = 15_000;

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
  return typeof value === "string" && (BLOCK_TYPES as readonly string[]).includes(value);
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
  const latest = new Map<string, PlayerPresence>();
  for (const event of events) {
    const previous = latest.get(event.userId);
    if (!previous || event.heartbeatAt > previous.heartbeatAt) latest.set(event.userId, event);
  }
  return [...latest.values()].filter(
    (player) => player.online && now - Number(player.heartbeatAt) <= staleAfterMs
  );
}
