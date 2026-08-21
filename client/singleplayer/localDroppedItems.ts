import type { LocalMobDeathDropEvent } from "../game/mobs.ts";
import {
  DROPPED_ITEM_ATTRACTION_MS,
  DROPPED_ITEM_PICKUP_DELAY_MS,
  DROPPED_ITEM_PICKUP_RADIUS,
  DROPPED_ITEM_TTL_MS,
} from "../../shared/droppedItems.ts";
import { addItemStack, type Inventory } from "../../shared/game.ts";
import type { LocalDroppedItem } from "./localDropGravity.ts";

export type AppendLocalMobDropsResult =
  | { ok: true; drops: LocalDroppedItem[]; added: number; replayed: boolean }
  | { ok: false; reason: "drop_capacity" | "drop_id_collision" };

export interface LocalDropCollectionResult {
  inventory: Inventory;
  drops: LocalDroppedItem[];
  changed: boolean;
}

export type LocalDropAttractionTimes = Map<string, number>;

function attractionComplete(
  dropId: string,
  now: number,
  attractionTimes?: LocalDropAttractionTimes,
): boolean {
  if (!attractionTimes) return true;
  const startedAt = attractionTimes.get(dropId);
  if (startedAt === undefined) {
    attractionTimes.set(dropId, now);
    return false;
  }
  return now - startedAt >= DROPPED_ITEM_ATTRACTION_MS;
}

/**
 * Removes local world drops at the same exact TTL boundary as multiplayer.
 * Survivors retain their original order and object identity; when nothing has
 * expired, the original array is returned without allocating or mutating it.
 */
export function pruneExpiredLocalDroppedItems<T extends LocalDroppedItem>(
  drops: T[],
  now: number,
): { drops: T[]; removed: number } {
  let survivors: T[] | null = null;
  let removed = 0;
  for (let index = 0; index < drops.length; index += 1) {
    const drop = drops[index];
    if (now >= drop.droppedAt + DROPPED_ITEM_TTL_MS) {
      if (!survivors) survivors = drops.slice(0, index);
      removed += 1;
    } else if (survivors) {
      survivors.push(drop);
    }
  }
  return { drops: survivors ?? drops, removed };
}

function hashText(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function dropIdForEvent(eventId: string, index: number): string {
  const token = eventId.replace(/[^A-Za-z0-9_.:\-]/g, "_").slice(0, 52) || "mob";
  return `local_mob_${token}_${hashText(eventId).toString(36)}_${index}`.slice(0, 96);
}

/**
 * Atomically appends every deterministic reward stack from one local mob death.
 * Stable IDs make an accidental replay harmless; capacity/collision rejection
 * returns the original array untouched so the engine can preserve the mob.
 */
export function appendLocalMobDeathDrops(
  current: readonly LocalDroppedItem[],
  event: Readonly<LocalMobDeathDropEvent>,
  droppedAt: number,
  maximumDrops: number,
): AppendLocalMobDropsResult {
  const maximum = Number.isSafeInteger(maximumDrops) ? Math.max(0, maximumDrops) : 0;
  const byId = new Map(current.map((drop) => [drop.dropId, drop] as const));
  const additions: LocalDroppedItem[] = [];
  let replayed = event.drops.length > 0;
  const phase = hashText(event.eventId) / 0xffff_ffff * Math.PI * 2;

  for (let index = 0; index < event.drops.length; index += 1) {
    const reward = event.drops[index];
    const dropId = dropIdForEvent(event.eventId, index);
    const angle = phase + index * 2.399963229728653;
    const candidate: LocalDroppedItem = {
      dropId,
      item: { itemId: reward.itemId, count: reward.count },
      x: event.x + Math.cos(angle) * 0.22,
      y: event.y + 0.35,
      z: event.z + Math.sin(angle) * 0.22,
      droppedAt,
      velocityY: 0,
      settled: false,
    };
    const existing = byId.get(dropId);
    if (existing) {
      if (existing.item.itemId !== candidate.item.itemId || existing.item.count !== candidate.item.count) {
        return { ok: false, reason: "drop_id_collision" };
      }
      continue;
    }
    replayed = false;
    additions.push(candidate);
  }

  if (current.length + additions.length > maximum) return { ok: false, reason: "drop_capacity" };
  return {
    ok: true,
    drops: additions.length ? [...current, ...additions] : current.slice(),
    added: additions.length,
    replayed,
  };
}

/** Capacity-safe pickup shared by mined, manually dropped, death, and mob loot. */
export function collectLocalDroppedItems(
  inventory: Inventory,
  drops: readonly LocalDroppedItem[],
  pose: Readonly<{ x: number; y: number; z: number }>,
  pickupRadius = DROPPED_ITEM_PICKUP_RADIUS,
  now = Date.now(),
  attractionTimes?: LocalDropAttractionTimes,
): LocalDropCollectionResult {
  let nextInventory = inventory;
  let changed = false;
  const remaining: LocalDroppedItem[] = [];
  const radiusSquared = Math.max(0, pickupRadius) ** 2;
  for (const drop of drops) {
    if (now < drop.droppedAt + DROPPED_ITEM_PICKUP_DELAY_MS) {
      remaining.push(drop);
      continue;
    }
    const distanceSquared = (pose.x - drop.x) ** 2 + (pose.y - drop.y) ** 2 + (pose.z - drop.z) ** 2;
    if (distanceSquared > radiusSquared) {
      attractionTimes?.delete(drop.dropId);
      remaining.push(drop);
      continue;
    }
    if (!attractionComplete(drop.dropId, now, attractionTimes)) {
      remaining.push(drop);
      continue;
    }
    const added = addItemStack(nextInventory, drop.item);
    const picked = drop.item.count - added.remainder;
    if (picked <= 0) {
      remaining.push(drop);
      continue;
    }
    nextInventory = added.inventory;
    changed = true;
    attractionTimes?.delete(drop.dropId);
    if (added.remainder > 0) remaining.push({ ...drop, item: { ...drop.item, count: added.remainder } });
  }
  return { inventory: nextInventory, drops: remaining, changed };
}

/**
 * Gravity-tick pickup for a stationary player. Only indices that moved during
 * the fixed step are distance/capacity checked; the full array is copied only
 * after at least one stack is actually collected.
 */
export function collectMovedLocalDroppedItems(
  inventory: Inventory,
  drops: LocalDroppedItem[],
  movedIndices: ReadonlySet<number>,
  pose: Readonly<{ x: number; y: number; z: number }>,
  pickupRadius = DROPPED_ITEM_PICKUP_RADIUS,
  now = Date.now(),
  attractionTimes?: LocalDropAttractionTimes,
): LocalDropCollectionResult {
  let nextInventory = inventory;
  const changes: Array<{ index: number; remainder: number }> = [];
  const radiusSquared = Math.max(0, pickupRadius) ** 2;
  for (const index of movedIndices) {
    const drop = drops[index];
    if (!drop) continue;
    if (now < drop.droppedAt + DROPPED_ITEM_PICKUP_DELAY_MS) continue;
    const distanceSquared = (pose.x - drop.x) ** 2 + (pose.y - drop.y) ** 2 + (pose.z - drop.z) ** 2;
    if (distanceSquared > radiusSquared) {
      attractionTimes?.delete(drop.dropId);
      continue;
    }
    if (!attractionComplete(drop.dropId, now, attractionTimes)) continue;
    const added = addItemStack(nextInventory, drop.item);
    const picked = drop.item.count - added.remainder;
    if (picked <= 0) continue;
    nextInventory = added.inventory;
    attractionTimes?.delete(drop.dropId);
    changes.push({ index, remainder: added.remainder });
  }
  if (changes.length === 0) return { inventory, drops, changed: false };
  const nextDrops = drops.slice();
  changes.sort((left, right) => right.index - left.index);
  for (const { index, remainder } of changes) {
    if (remainder > 0) {
      const drop = nextDrops[index];
      nextDrops[index] = { ...drop, item: { ...drop.item, count: remainder } };
    } else {
      nextDrops.splice(index, 1);
    }
  }
  return { inventory: nextInventory, drops: nextDrops, changed: true };
}
