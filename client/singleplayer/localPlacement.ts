import { cloneInventory, type Inventory, type ItemId } from "../../shared/game.ts";

export type SelectedPlacementConsumption =
  | { ok: true; inventory: Inventory; depleted: boolean }
  | { ok: false; inventory: Inventory; depleted: false };

/** Consumes one block from exactly the selected slot; duplicate stacks elsewhere are untouched. */
export function consumeSelectedPlacementStack(
  inventory: readonly Inventory[number][],
  selectedSlot: number,
  expectedItemId: ItemId,
): SelectedPlacementConsumption {
  const next = cloneInventory(inventory);
  if (!Number.isInteger(selectedSlot) || selectedSlot < 0 || selectedSlot >= next.length) {
    return { ok: false, inventory: next, depleted: false };
  }
  const selected = next[selectedSlot];
  if (!selected || selected.itemId !== expectedItemId || selected.count < 1) {
    return { ok: false, inventory: next, depleted: false };
  }
  if (selected.count === 1) next[selectedSlot] = null;
  else next[selectedSlot] = { ...selected, count: selected.count - 1 };
  return { ok: true, inventory: next, depleted: selected.count === 1 };
}
