import {
  INVENTORY_SIZE,
  ITEMS,
  createEmptyEquipment,
  createEmptyInventory,
  maxItemDurability,
  type ArmorId,
  type ArmorSlot,
  type Equipment,
  type Inventory,
  type ItemId,
  type ItemStack,
} from "./game.ts";
import * as BS from "./bundleStrings.ts";

/** A canonical player can carry at most 36 inventory rows plus four armor rows. */
export const DEATH_DROP_MAX_ROWS = 48;
export const DEATH_DROP_MAX_STACK = 64;
export const DEATH_DROP_MAX_HORIZONTAL_OFFSET = 0.54;

const ARMOR_SLOTS = ["head", "chest", "legs", "feet"] as const satisfies readonly ArmorSlot[];
const MIN_WORLD_XZ = -1_000_000;
const MAX_WORLD_XZ = 1_000_000;
const MIN_WORLD_Y = -64;
const MAX_WORLD_Y = 512;
const GRID_WIDTH = 7;
const GRID_CELL_COUNT = GRID_WIDTH * GRID_WIDTH;
const GRID_STEP = 0.18;
const GRID_STEPS_COPRIME_TO_49 = [
  1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13,
  15, 16, 17, 18, 19, 20, 22, 23, 24,
] as const;

export type DeathEventIdentity = {
  eventId: string;
  userId: string;
};

export type DeathPose = {
  x: number;
  y: number;
  z: number;
};

export type DeathDropOffset = DeathPose;

export type PlannedDeathDrop = {
  ordinal: number;
  /** Stable operation key for exactly-once dropped-item insertion. */
  operationId: string;
  stack: ItemStack;
  offset: DeathDropOffset;
  position: DeathPose;
};

export type EmptyCarriedState = {
  inventory: Inventory;
  equipment: Equipment;
};

export type DeathDropPlan =
  | {
      ok: true;
      settlementId: string;
      identity: DeathEventIdentity;
      deathPose: DeathPose;
      drops: PlannedDeathDrop[];
      carriedState: EmptyCarriedState;
      conservationFingerprint: string;
    }
  | {
      ok: false;
      reason:
        | "invalid_event_identity"
        | "invalid_death_pose"
        | "invalid_inventory"
        | "invalid_equipment"
        | "row_cap_exceeded"
        | "conservation_failure";
    };

export type DeathDropConservationValidation =
  | { ok: true; fingerprint: string }
  | { ok: false; reason: "invalid_source" | "invalid_drops" | "quantity_mismatch" };

function hasExactKeys(record: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = Object.keys(record);
  return keys.length === allowed.length && keys.every((key) => allowed.includes(key));
}

function validIdentityPart(value: unknown): value is string {
  return typeof value === "string"
    && value.length >= 1
    && value.length <= 128
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function canonicalIdentity(value: DeathEventIdentity): DeathEventIdentity | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as unknown as Record<string, unknown>;
  if (!hasExactKeys(record, ["eventId", "userId"])
    || !validIdentityPart(record.eventId) || !validIdentityPart(record.userId)) return null;
  return { eventId: record.eventId, userId: record.userId };
}

function canonicalPose(value: DeathPose): DeathPose | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as unknown as Record<string, unknown>;
  if (!hasExactKeys(record, ["x", "y", "z"])) return null;
  const { x, y, z } = record;
  if (typeof x !== "number" || !Number.isFinite(x) || x < MIN_WORLD_XZ || x > MAX_WORLD_XZ
    || typeof y !== "number" || !Number.isFinite(y) || y < MIN_WORLD_Y || y > MAX_WORLD_Y
    || typeof z !== "number" || !Number.isFinite(z) || z < MIN_WORLD_XZ || z > MAX_WORLD_XZ) return null;
  return { x, y, z };
}

function canonicalStack(value: unknown): ItemStack | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!hasExactKeys(record, record.durability === undefined
    ? ["itemId", "count"]
    : ["itemId", "count", BS.durability])) return null;
  if (typeof record.itemId !== "string" || !Object.prototype.hasOwnProperty.call(ITEMS, record.itemId)) return null;
  const itemId = record.itemId as ItemId;
  const maximum = maxItemDurability(itemId);
  if (typeof record.count !== "number" || !Number.isInteger(record.count)
    || record.count < 1 || record.count > Math.min(DEATH_DROP_MAX_STACK, ITEMS[itemId].maxStack)) return null;
  if (maximum === null) {
    if (record.durability !== undefined) return null;
    return { itemId, count: record.count };
  }
  if (record.count !== 1 || typeof record.durability !== "number"
    || !Number.isInteger(record.durability) || record.durability < 1 || record.durability > maximum) return null;
  return { itemId, count: 1, durability: record.durability };
}

function canonicalInventory(value: readonly (ItemStack | null)[]): Inventory | null {
  if (!Array.isArray(value) || value.length !== INVENTORY_SIZE) return null;
  const inventory: Inventory = [];
  for (let index = 0; index < INVENTORY_SIZE; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) return null;
    const candidate = value[index];
    if (candidate === null) {
      inventory.push(null);
      continue;
    }
    const stack = canonicalStack(candidate);
    if (!stack) return null;
    inventory.push(stack);
  }
  return inventory;
}

function canonicalEquipment(value: Equipment): Equipment | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as unknown as Record<string, unknown>;
  if (!hasExactKeys(record, ARMOR_SLOTS)) return null;
  const equipment = createEmptyEquipment();
  for (const slot of ARMOR_SLOTS) {
    const candidate = record[slot];
    if (candidate === null) continue;
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
    const armor = candidate as Record<string, unknown>;
    if (!hasExactKeys(armor, ["itemId", BS.durability])
      || typeof armor.itemId !== "string" || !Object.prototype.hasOwnProperty.call(ITEMS, armor.itemId)) return null;
    const definition = ITEMS[armor.itemId as ItemId].armor;
    if (!definition || definition.slot !== slot || typeof armor.durability !== "number"
      || !Number.isInteger(armor.durability) || armor.durability < 1
      || armor.durability > definition.maxDurability) return null;
    equipment[slot] = { itemId: armor.itemId as ArmorId, durability: armor.durability };
  }
  return equipment;
}

function stackIdentity(stack: ItemStack): string {
  return stack.durability === undefined
    ? stack.itemId
    : `${stack.itemId}@${stack.durability}`;
}

function ledgerFingerprint(stacks: readonly ItemStack[]): string {
  const quantities = new Map<string, number>();
  for (const stack of stacks) {
    const key = stackIdentity(stack);
    quantities.set(key, (quantities.get(key) ?? 0) + stack.count);
  }
  return JSON.stringify([...quantities.entries()].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
}

function carriedStacks(inventory: readonly (ItemStack | null)[], equipment: Equipment): ItemStack[] {
  const stacks = inventory.flatMap((stack) => stack ? [{ ...stack }] : []);
  for (const slot of ARMOR_SLOTS) {
    const armor = equipment[slot];
    if (armor) stacks.push({ itemId: armor.itemId, count: 1, durability: armor.durability });
  }
  return stacks;
}

/** Strict equality by item, quantity, and remaining durability. */
export function validateDeathDropConservation(
  inventory: readonly (ItemStack | null)[],
  equipment: Equipment,
  drops: readonly ItemStack[],
): DeathDropConservationValidation {
  const canonicalSourceInventory = canonicalInventory(inventory);
  const canonicalSourceEquipment = canonicalEquipment(equipment);
  if (!canonicalSourceInventory || !canonicalSourceEquipment) return { ok: false, reason: "invalid_source" };
  const canonicalDrops: ItemStack[] = [];
  for (const candidate of drops) {
    const stack = canonicalStack(candidate);
    if (!stack) return { ok: false, reason: "invalid_drops" };
    canonicalDrops.push(stack);
  }
  const sourceFingerprint = ledgerFingerprint(carriedStacks(canonicalSourceInventory, canonicalSourceEquipment));
  const dropFingerprint = ledgerFingerprint(canonicalDrops);
  return sourceFingerprint === dropFingerprint
    ? { ok: true, fingerprint: sourceFingerprint }
    : { ok: false, reason: "quantity_mismatch" };
}

function coalesceStacks(stacks: readonly ItemStack[]): ItemStack[] {
  const stackableTotals = new Map<ItemId, number>();
  const durable: ItemStack[] = [];
  for (const stack of stacks) {
    if (maxItemDurability(stack.itemId) !== null) {
      // Durable identities are rows, not quantities. Even identical wear values
      // remain separate so neither instance can disappear during settlement.
      durable.push({ ...stack });
    } else {
      stackableTotals.set(stack.itemId, (stackableTotals.get(stack.itemId) ?? 0) + stack.count);
    }
  }
  const output: ItemStack[] = [];
  for (const itemId of [...stackableTotals.keys()].sort()) {
    const total = stackableTotals.get(itemId) ?? 0;
    const maximum = Math.min(DEATH_DROP_MAX_STACK, ITEMS[itemId].maxStack);
    const rowCount = Math.ceil(total / maximum);
    for (let row = 0; row < rowCount; row += 1) {
      const count = Math.min(maximum, total - row * maximum);
      output.push({ itemId, count });
    }
  }
  durable.sort((left, right) => (left.itemId < right.itemId ? -1 : left.itemId > right.itemId ? 1 : 0)
    || (left.durability ?? 0) - (right.durability ?? 0));
  output.push(...durable);
  return output;
}

function hash32(input: string, seed = 0x811c9dc5): number {
  let hash = seed >>> 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = Math.imul(hash ^ input.charCodeAt(index), 0x01000193) >>> 0;
  }
  return hash;
}

function compactHash(input: string): string {
  const left = hash32(input);
  const right = hash32(input, 0x9e3779b9);
  return `${left.toString(36).padStart(7, "0")}${right.toString(36).padStart(7, "0")}`;
}

function roundMilliblock(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function plannedPosition(identityKey: string, pose: DeathPose, ordinal: number): {
  offset: DeathDropOffset;
  position: DeathPose;
} {
  const hash = hash32(identityKey);
  const start = hash % GRID_CELL_COUNT;
  const step = GRID_STEPS_COPRIME_TO_49[(hash >>> 8) % GRID_STEPS_COPRIME_TO_49.length];
  const cell = (start + ordinal * step) % GRID_CELL_COUNT;
  const gridX = cell % GRID_WIDTH;
  const gridZ = Math.floor(cell / GRID_WIDTH);
  const intendedOffset = {
    x: roundMilliblock((gridX - 3) * GRID_STEP),
    y: roundMilliblock(0.18 + ((hash32(`${identityKey}:${ordinal}:y`) % 5) * 0.03)),
    z: roundMilliblock((gridZ - 3) * GRID_STEP),
  };
  const position = {
    x: roundMilliblock(clamp(pose.x + intendedOffset.x, MIN_WORLD_XZ, MAX_WORLD_XZ)),
    y: roundMilliblock(clamp(pose.y + intendedOffset.y, MIN_WORLD_Y, MAX_WORLD_Y)),
    z: roundMilliblock(clamp(pose.z + intendedOffset.z, MIN_WORLD_XZ, MAX_WORLD_XZ)),
  };
  return {
    offset: {
      x: roundMilliblock(position.x - pose.x),
      y: roundMilliblock(position.y - pose.y),
      z: roundMilliblock(position.z - pose.z),
    },
    position,
  };
}

/**
 * Pure, fail-closed death settlement. The stable operation ids let Lakebed
 * insert every row exactly once without any timer or background write loop.
 */
export function planDeathDrops(input: {
  identity: DeathEventIdentity;
  inventory: readonly (ItemStack | null)[];
  equipment: Equipment;
  deathPose: DeathPose;
}): DeathDropPlan {
  const identity = canonicalIdentity(input.identity);
  if (!identity) return { ok: false, reason: "invalid_event_identity" };
  const deathPose = canonicalPose(input.deathPose);
  if (!deathPose) return { ok: false, reason: "invalid_death_pose" };
  const inventory = canonicalInventory(input.inventory);
  if (!inventory) return { ok: false, reason: BS.invalidInventory };
  const equipment = canonicalEquipment(input.equipment);
  if (!equipment) return { ok: false, reason: "invalid_equipment" };

  const stacks = coalesceStacks(carriedStacks(inventory, equipment));
  if (stacks.length > DEATH_DROP_MAX_ROWS) return { ok: false, reason: "row_cap_exceeded" };
  const conservation = validateDeathDropConservation(inventory, equipment, stacks);
  if (!conservation.ok) return { ok: false, reason: BS.conservationFailure };

  const identityKey = JSON.stringify([identity.userId, identity.eventId]);
  const settlementId = `death_${compactHash(identityKey)}`;
  const drops = stacks.map((stack, ordinal): PlannedDeathDrop => {
    const placement = plannedPosition(identityKey, deathPose, ordinal);
    return {
      ordinal,
      operationId: `${settlementId}_${ordinal.toString(36).padStart(2, "0")}`,
      stack: { ...stack },
      ...placement,
    };
  });
  return {
    ok: true,
    settlementId,
    identity,
    deathPose,
    drops,
    carriedState: {
      inventory: createEmptyInventory(),
      equipment: createEmptyEquipment(),
    },
    conservationFingerprint: conservation.fingerprint,
  };
}
