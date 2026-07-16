import type { DroppedItemRenderItem } from "../game/droppedItemRenderer.ts";
import type { LocalMobDeathDropEvent } from "../game/mobs.ts";
import { DROPPED_ITEM_PICKUP_RADIUS } from "../../shared/droppedItems.ts";
import { addItemStack, type Inventory } from "../../shared/game.ts";

export type AppendLocalMobDropsResult =
  | { ok: true; drops: DroppedItemRenderItem[]; added: number; replayed: boolean }
  | { ok: false; reason: "drop_capacity" | "drop_id_collision" };

export interface LocalDropCollectionResult {
  inventory: Inventory;
  drops: DroppedItemRenderItem[];
  changed: boolean;
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
  current: readonly DroppedItemRenderItem[],
  event: Readonly<LocalMobDeathDropEvent>,
  droppedAt: number,
  maximumDrops: number,
): AppendLocalMobDropsResult {
  const maximum = Number.isSafeInteger(maximumDrops) ? Math.max(0, maximumDrops) : 0;
  const byId = new Map(current.map((drop) => [drop.dropId, drop] as const));
  const additions: DroppedItemRenderItem[] = [];
  let replayed = event.drops.length > 0;
  const phase = hashText(event.eventId) / 0xffff_ffff * Math.PI * 2;

  for (let index = 0; index < event.drops.length; index += 1) {
    const reward = event.drops[index];
    const dropId = dropIdForEvent(event.eventId, index);
    const angle = phase + index * 2.399963229728653;
    const candidate: DroppedItemRenderItem = {
      dropId,
      item: { itemId: reward.itemId, count: reward.count },
      x: event.x + Math.cos(angle) * 0.22,
      y: event.y + 0.35,
      z: event.z + Math.sin(angle) * 0.22,
      droppedAt,
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
  drops: readonly DroppedItemRenderItem[],
  pose: Readonly<{ x: number; y: number; z: number }>,
  pickupRadius = DROPPED_ITEM_PICKUP_RADIUS,
): LocalDropCollectionResult {
  let nextInventory = inventory;
  let changed = false;
  const remaining: DroppedItemRenderItem[] = [];
  const radiusSquared = Math.max(0, pickupRadius) ** 2;
  for (const drop of drops) {
    const distanceSquared = (pose.x - drop.x) ** 2 + (pose.y - drop.y) ** 2 + (pose.z - drop.z) ** 2;
    if (distanceSquared > radiusSquared) {
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
    if (added.remainder > 0) remaining.push({ ...drop, item: { ...drop.item, count: added.remainder } });
  }
  return { inventory: nextInventory, drops: remaining, changed };
}
