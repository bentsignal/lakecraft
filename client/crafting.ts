export type CraftingTablePosition = { x: number; y: number; z: number };
export type PlayerPosition = { x: number; y: number; z: number };

/** Slightly exceeds the six-block ray reach so using a table at the edge cannot close it immediately. */
export const CRAFTING_TABLE_USE_REACH = 7;

export function isCraftingTableWithinReach(
  player: PlayerPosition,
  table: CraftingTablePosition,
  reach = CRAFTING_TABLE_USE_REACH,
): boolean {
  const dx = player.x - (table.x + 0.5);
  const dy = player.y - (table.y + 0.5);
  const dz = player.z - (table.z + 0.5);
  return dx * dx + dy * dy + dz * dz <= reach * reach;
}
