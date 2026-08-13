import {
  consumeSelectedPlacementStack as consumeSharedPlacementStack,
  type Inventory,
  type ItemId,
} from "../../shared/game.ts";

export type SelectedPlacementConsumption =
  | { ok: true; inventory: Inventory; depleted: boolean }
  | { ok: false; inventory: Inventory; depleted: false };

export function consumeSelectedPlacementStack(
  inventory: readonly Inventory[number][],
  selectedSlot: number,
  expectedItemId: ItemId,
): SelectedPlacementConsumption {
  const selectedCount = inventory[selectedSlot]?.count ?? 0;
  const result = consumeSharedPlacementStack(inventory, selectedSlot, expectedItemId);
  return result.ok
    ? { ...result, depleted: selectedCount === 1 }
    : { ...result, depleted: false };
}
