export const HOTBAR_SIZE = 9;
export const INVENTORY_SIZE = 27;

export type BlockId = "grass" | "dirt" | "stone" | "log" | "leaves" | "planks" | "crafting_table";
export type ToolId =
  | "wooden_pickaxe"
  | "wooden_axe"
  | "wooden_shovel"
  | "wooden_sword"
  | "stone_pickaxe"
  | "stone_axe"
  | "stone_shovel"
  | "stone_sword";
export type ArmorId = "leather_helmet" | "leather_chestplate" | "leather_leggings" | "leather_boots";
export type ItemId = BlockId | "stick" | "leather" | ToolId | ArmorId;
export type ToolKind = "hand" | "pickaxe" | "axe" | "shovel" | "sword";
export type ToolTier = "none" | "wood" | "stone";
export type ArmorSlot = "head" | "chest" | "legs" | "feet";
export type Equipment = Record<ArmorSlot, ArmorId | null>;

export type BlockDefinition = {
  id: BlockId;
  label: string;
  description: string;
  color: string;
  accent: string;
  hardness: number;
  preferredTool: ToolKind;
  drop: ItemId | null;
};

export type ItemDefinition = {
  id: ItemId;
  label: string;
  shortLabel: string;
  description: string;
  category: "block" | "material" | "tool" | "armor";
  maxStack: number;
  glyph: string;
  color: string;
  placesBlock?: BlockId;
  tool?: { kind: Exclude<ToolKind, "hand">; tier: Exclude<ToolTier, "none">; attackDamage: number };
  armor?: { slot: ArmorSlot; protection: number };
};

export type ItemStack = { itemId: ItemId; count: number };
export type Inventory = Array<ItemStack | null>;
export type ItemQuantity = { itemId: ItemId; count: number };

export type Recipe = {
  id: string;
  label: string;
  note: string;
  ingredients: ItemQuantity[];
  output: ItemQuantity;
};

export type CraftResult =
  | { ok: true; inventory: Inventory; crafted: ItemQuantity }
  | { ok: false; inventory: Inventory; reason: "missing_ingredients" | "inventory_full" | "unknown_recipe" };

export type SerializablePlayerState = {
  inventory: Inventory;
  selectedHotbar: number;
  equipment: Equipment;
};

export type EquipResult =
  | { ok: true; inventory: Inventory; equipment: Equipment }
  | { ok: false; inventory: Inventory; equipment: Equipment; reason: "not_armor" | "empty_slot" | "inventory_full" };

export const BLOCKS: Record<BlockId, BlockDefinition> = {
  grass: { id: "grass", label: "Grass", description: "A living cap over packed earth.", color: "#718447", accent: "#a7b76a", hardness: 0.75, preferredTool: "shovel", drop: "dirt" },
  dirt: { id: "dirt", label: "Dirt", description: "Soft earth for quick shelter walls.", color: "#7f5638", accent: "#ad7951", hardness: 0.65, preferredTool: "shovel", drop: "dirt" },
  stone: { id: "stone", label: "Stone", description: "Dense fieldstone. A pickaxe works best.", color: "#6d7069", accent: "#9a9c91", hardness: 2.5, preferredTool: "pickaxe", drop: "stone" },
  log: { id: "log", label: "Oak Log", description: "Fresh timber. An axe speeds the work.", color: "#76502f", accent: "#bd8a50", hardness: 1.6, preferredTool: "axe", drop: "log" },
  leaves: { id: "leaves", label: "Oak Leaves", description: "A loose, mossy canopy block.", color: "#4e6f3d", accent: "#7c9953", hardness: 0.3, preferredTool: "hand", drop: null },
  planks: { id: "planks", label: "Oak Planks", description: "Squared boards for building and tools.", color: "#a87841", accent: "#d0a45e", hardness: 1.1, preferredTool: "axe", drop: "planks" },
  crafting_table: { id: "crafting_table", label: "Crafting Table", description: "A sturdy workbench for more involved recipes.", color: "#8a5b32", accent: "#d39a54", hardness: 1.4, preferredTool: "axe", drop: "crafting_table" },
};

export const ITEMS: Record<ItemId, ItemDefinition> = {
  grass: blockItem("grass", "GRS", "▨"),
  dirt: blockItem("dirt", "DRT", "▦"),
  stone: blockItem("stone", "STN", "◆"),
  log: blockItem("log", "LOG", "▥"),
  leaves: blockItem("leaves", "LEF", "✤"),
  planks: blockItem("planks", "PLK", "▤"),
  crafting_table: blockItem("crafting_table", "CRF", "▧"),
  stick: { id: "stick", label: "Stick", shortLabel: "STK", description: "A straight handle for simple tools.", category: "material", maxStack: 64, glyph: "╱", color: "#c09557" },
  leather: { id: "leather", label: "Leather", shortLabel: "LTH", description: "Tough hide used for lightweight armor.", category: "material", maxStack: 64, glyph: "◩", color: "#8d552f" },
  wooden_pickaxe: toolItem("wooden_pickaxe", "Wood Pickaxe", "W·PX", "pickaxe", "wood", "A light pick for fieldstone.", "⌁", "#b7874d"),
  wooden_axe: toolItem("wooden_axe", "Wood Axe", "W·AX", "axe", "wood", "A rough axe for timber.", "◒", "#b7874d"),
  wooden_shovel: toolItem("wooden_shovel", "Wood Shovel", "W·SH", "shovel", "wood", "A broad wooden spade for earth.", "♠", "#b7874d"),
  wooden_sword: toolItem("wooden_sword", "Wood Sword", "W·SW", "sword", "wood", "A simple wooden blade for defense.", "†", "#b7874d"),
  stone_pickaxe: toolItem("stone_pickaxe", "Stone Pickaxe", "S·PX", "pickaxe", "stone", "A sturdy pick for quick quarrying.", "⌁", "#a3a69e"),
  stone_axe: toolItem("stone_axe", "Stone Axe", "S·AX", "axe", "stone", "A weighty axe for felling trees.", "◒", "#a3a69e"),
  stone_shovel: toolItem("stone_shovel", "Stone Shovel", "S·SH", "shovel", "stone", "A stone-edged spade that clears earth quickly.", "♠", "#a3a69e"),
  stone_sword: toolItem("stone_sword", "Stone Sword", "S·SW", "sword", "stone", "A dependable stone blade.", "†", "#a3a69e"),
  leather_helmet: armorItem("leather_helmet", "Leather Cap", "L·HD", "head", 1, "A light cap of hardened hide.", "⌒"),
  leather_chestplate: armorItem("leather_chestplate", "Leather Tunic", "L·CH", "chest", 3, "A flexible hide tunic.", "▣"),
  leather_leggings: armorItem("leather_leggings", "Leather Pants", "L·LG", "legs", 2, "Tough hide protection for the legs.", "⋒"),
  leather_boots: armorItem("leather_boots", "Leather Boots", "L·FT", "feet", 1, "Soft boots for rough terrain.", "∪"),
};

function blockItem(id: BlockId, shortLabel: string, glyph: string): ItemDefinition {
  const block = BLOCKS[id];
  return { id, label: block.label, shortLabel, description: block.description, category: "block", maxStack: 64, glyph, color: block.color, placesBlock: id };
}

function toolItem(id: ToolId, label: string, shortLabel: string, kind: Exclude<ToolKind, "hand">, tier: Exclude<ToolTier, "none">, description: string, glyph: string, color: string): ItemDefinition {
  const tierBonus = tier === "stone" ? 1 : 0;
  const attackDamage = ({ pickaxe: 2, axe: 3, shovel: 1, sword: 4 } as const)[kind] + tierBonus;
  return { id, label, shortLabel, description, category: "tool", maxStack: 1, glyph, color, tool: { kind, tier, attackDamage } };
}

function armorItem(id: ArmorId, label: string, shortLabel: string, slot: ArmorSlot, protection: number, description: string, glyph: string): ItemDefinition {
  return { id, label, shortLabel, description, category: "armor", maxStack: 1, glyph, color: "#9b6339", armor: { slot, protection } };
}

export const RECIPES: readonly Recipe[] = [
  { id: "planks_from_log", label: "Saw planks", note: "Split one log into four boards.", ingredients: [{ itemId: "log", count: 1 }], output: { itemId: "planks", count: 4 } },
  { id: "sticks_from_planks", label: "Whittle sticks", note: "Two boards make four handles.", ingredients: [{ itemId: "planks", count: 2 }], output: { itemId: "stick", count: 4 } },
  { id: "crafting_table", label: "Crafting table", note: "Four boards make a proper workbench.", ingredients: [{ itemId: "planks", count: 4 }], output: { itemId: "crafting_table", count: 1 } },
  { id: "wooden_pickaxe", label: "Wood pickaxe", note: "A starter quarrying tool.", ingredients: [{ itemId: "planks", count: 3 }, { itemId: "stick", count: 2 }], output: { itemId: "wooden_pickaxe", count: 1 } },
  { id: "wooden_axe", label: "Wood axe", note: "Fells logs faster.", ingredients: [{ itemId: "planks", count: 3 }, { itemId: "stick", count: 2 }], output: { itemId: "wooden_axe", count: 1 } },
  { id: "wooden_shovel", label: "Wood shovel", note: "Clears dirt and grass faster.", ingredients: [{ itemId: "planks", count: 1 }, { itemId: "stick", count: 2 }], output: { itemId: "wooden_shovel", count: 1 } },
  { id: "wooden_sword", label: "Wood sword", note: "Basic protection after dark.", ingredients: [{ itemId: "planks", count: 2 }, { itemId: "stick", count: 1 }], output: { itemId: "wooden_sword", count: 1 } },
  { id: "stone_pickaxe", label: "Stone pickaxe", note: "A faster, sturdier pick.", ingredients: [{ itemId: "stone", count: 3 }, { itemId: "stick", count: 2 }], output: { itemId: "stone_pickaxe", count: 1 } },
  { id: "stone_axe", label: "Stone axe", note: "A proper timber tool.", ingredients: [{ itemId: "stone", count: 3 }, { itemId: "stick", count: 2 }], output: { itemId: "stone_axe", count: 1 } },
  { id: "stone_shovel", label: "Stone shovel", note: "Moves soil in a hurry.", ingredients: [{ itemId: "stone", count: 1 }, { itemId: "stick", count: 2 }], output: { itemId: "stone_shovel", count: 1 } },
  { id: "stone_sword", label: "Stone sword", note: "A sharper answer to hostile creatures.", ingredients: [{ itemId: "stone", count: 2 }, { itemId: "stick", count: 1 }], output: { itemId: "stone_sword", count: 1 } },
  { id: "leather_helmet", label: "Leather cap", note: "Light protection for the head.", ingredients: [{ itemId: "leather", count: 5 }], output: { itemId: "leather_helmet", count: 1 } },
  { id: "leather_chestplate", label: "Leather tunic", note: "A hide layer for the torso.", ingredients: [{ itemId: "leather", count: 8 }], output: { itemId: "leather_chestplate", count: 1 } },
  { id: "leather_leggings", label: "Leather pants", note: "Flexible leg protection.", ingredients: [{ itemId: "leather", count: 7 }], output: { itemId: "leather_leggings", count: 1 } },
  { id: "leather_boots", label: "Leather boots", note: "A little protection underfoot.", ingredients: [{ itemId: "leather", count: 4 }], output: { itemId: "leather_boots", count: 1 } },
] as const;

export function createEmptyInventory(size = INVENTORY_SIZE): Inventory {
  return Array.from({ length: Math.max(HOTBAR_SIZE, Math.floor(size)) }, () => null);
}

export function createEmptyEquipment(): Equipment {
  return { head: null, chest: null, legs: null, feet: null };
}

export function normalizeEquipment(value: unknown): Equipment {
  const equipment = createEmptyEquipment();
  if (!value || typeof value !== "object") return equipment;
  for (const slot of Object.keys(equipment) as ArmorSlot[]) {
    const itemId = (value as Partial<Record<ArmorSlot, unknown>>)[slot];
    if (typeof itemId === "string" && itemId in ITEMS && ITEMS[itemId as ItemId].armor?.slot === slot) {
      equipment[slot] = itemId as ArmorId;
    }
  }
  return equipment;
}

export function createStarterInventory(): Inventory {
  const inventory = createEmptyInventory();
  inventory[0] = { itemId: "wooden_pickaxe", count: 1 };
  inventory[1] = { itemId: "wooden_axe", count: 1 };
  inventory[2] = { itemId: "dirt", count: 16 };
  inventory[3] = { itemId: "planks", count: 8 };
  return inventory;
}

export function cloneInventory(inventory: readonly (ItemStack | null)[]): Inventory {
  return inventory.map((stack) => stack ? { itemId: stack.itemId, count: stack.count } : null);
}

export function normalizeInventory(value: unknown, size = INVENTORY_SIZE): Inventory {
  const output = createEmptyInventory(size);
  if (!Array.isArray(value)) return output;
  for (let index = 0; index < Math.min(output.length, value.length); index += 1) {
    const candidate = value[index] as { itemId?: unknown; count?: unknown } | null;
    if (!candidate || typeof candidate.itemId !== "string" || !(candidate.itemId in ITEMS) || typeof candidate.count !== "number" || !Number.isFinite(candidate.count)) continue;
    const itemId = candidate.itemId as ItemId;
    const count = Math.min(ITEMS[itemId].maxStack, Math.max(0, Math.floor(candidate.count)));
    if (count > 0) output[index] = { itemId, count };
  }
  return output;
}

export function countItem(inventory: readonly (ItemStack | null)[], itemId: ItemId): number {
  return inventory.reduce((total, stack) => total + (stack?.itemId === itemId ? stack.count : 0), 0);
}

export function hasItems(inventory: readonly (ItemStack | null)[], quantities: readonly ItemQuantity[]): boolean {
  const needed: Partial<Record<ItemId, number>> = {};
  for (const { itemId, count } of quantities) {
    if (count <= 0 || !Number.isFinite(count)) return false;
    needed[itemId] = (needed[itemId] ?? 0) + Math.floor(count);
  }
  return (Object.entries(needed) as Array<[ItemId, number]>).every(([itemId, count]) => countItem(inventory, itemId) >= count);
}

export function addItem(inventory: readonly (ItemStack | null)[], itemId: ItemId, count = 1): { inventory: Inventory; remainder: number } {
  const next = cloneInventory(inventory);
  let remainder = Math.max(0, Math.floor(count));
  const maxStack = ITEMS[itemId].maxStack;
  for (const stack of next) {
    if (remainder <= 0) break;
    if (stack?.itemId !== itemId || stack.count >= maxStack) continue;
    const added = Math.min(maxStack - stack.count, remainder);
    stack.count += added;
    remainder -= added;
  }
  for (let index = 0; index < next.length && remainder > 0; index += 1) {
    if (next[index]) continue;
    const added = Math.min(maxStack, remainder);
    next[index] = { itemId, count: added };
    remainder -= added;
  }
  return { inventory: next, remainder };
}

export function removeItem(inventory: readonly (ItemStack | null)[], itemId: ItemId, count = 1): { inventory: Inventory; remainder: number } {
  const next = cloneInventory(inventory);
  let remainder = Math.max(0, Math.floor(count));
  for (let index = next.length - 1; index >= 0 && remainder > 0; index -= 1) {
    const stack = next[index];
    if (stack?.itemId !== itemId) continue;
    const removed = Math.min(stack.count, remainder);
    stack.count -= removed;
    remainder -= removed;
    if (stack.count <= 0) next[index] = null;
  }
  return { inventory: next, remainder };
}

export function canCraft(inventory: readonly (ItemStack | null)[], recipe: Recipe): boolean {
  if (!hasItems(inventory, recipe.ingredients)) return false;
  let next = cloneInventory(inventory);
  for (const ingredient of recipe.ingredients) next = removeItem(next, ingredient.itemId, ingredient.count).inventory;
  return addItem(next, recipe.output.itemId, recipe.output.count).remainder === 0;
}

export function craftRecipe(inventory: readonly (ItemStack | null)[], recipeOrId: Recipe | string): CraftResult {
  const recipe = typeof recipeOrId === "string" ? RECIPES.find(({ id }) => id === recipeOrId) : recipeOrId;
  const original = cloneInventory(inventory);
  if (!recipe) return { ok: false, inventory: original, reason: "unknown_recipe" };
  if (!hasItems(original, recipe.ingredients)) return { ok: false, inventory: original, reason: "missing_ingredients" };
  let next = original;
  for (const ingredient of recipe.ingredients) next = removeItem(next, ingredient.itemId, ingredient.count).inventory;
  const added = addItem(next, recipe.output.itemId, recipe.output.count);
  if (added.remainder > 0) return { ok: false, inventory: cloneInventory(inventory), reason: "inventory_full" };
  return { ok: true, inventory: added.inventory, crafted: { ...recipe.output } };
}

export function getMiningDrop(blockId: BlockId): ItemQuantity | null {
  const drop = BLOCKS[blockId].drop;
  return drop ? { itemId: drop, count: 1 } : null;
}

export function selectedItem(inventory: readonly (ItemStack | null)[], selectedHotbar: number): ItemStack | null {
  return inventory[clampHotbarIndex(selectedHotbar)] ?? null;
}

export function clampHotbarIndex(value: number): number {
  return Math.max(0, Math.min(HOTBAR_SIZE - 1, Math.floor(Number.isFinite(value) ? value : 0)));
}

export function toolEffectiveness(blockId: BlockId, itemId?: ItemId | null): number {
  const block = BLOCKS[blockId];
  if (!itemId) return block.preferredTool === "hand" ? 1 : 0.35;
  const tool = ITEMS[itemId].tool;
  if (!tool) return block.preferredTool === "hand" ? 1 : 0.35;
  if (tool.kind !== block.preferredTool) return 0.5;
  return tool.tier === "stone" ? 4 : 2.5;
}

export function toolEffectivenessLabel(blockId: BlockId, itemId?: ItemId | null): "ideal" | "workable" | "poor" {
  const multiplier = toolEffectiveness(blockId, itemId);
  return multiplier >= 2.5 ? "ideal" : multiplier >= 1 ? "workable" : "poor";
}

export function miningSeconds(blockId: BlockId, itemId?: ItemId | null): number {
  return Math.max(0.12, BLOCKS[blockId].hardness / toolEffectiveness(blockId, itemId));
}

export function attackDamage(itemId?: ItemId | null): number {
  return itemId ? ITEMS[itemId].tool?.attackDamage ?? 1 : 1;
}

export function armorProtection(itemId?: ItemId | null): number {
  return itemId ? ITEMS[itemId].armor?.protection ?? 0 : 0;
}

export function equippedArmorProtection(equipment: Equipment): number {
  return (Object.values(equipment) as Array<ArmorId | null>).reduce((total, itemId) => total + armorProtection(itemId), 0);
}

export function equipArmorFromInventory(inventory: readonly (ItemStack | null)[], equipment: Equipment, inventoryIndex: number): EquipResult {
  const nextInventory = cloneInventory(inventory);
  const nextEquipment = normalizeEquipment(equipment);
  const stack = nextInventory[inventoryIndex];
  const armor = stack ? ITEMS[stack.itemId].armor : undefined;
  if (!stack) return { ok: false, inventory: nextInventory, equipment: nextEquipment, reason: "empty_slot" };
  if (!armor) return { ok: false, inventory: nextInventory, equipment: nextEquipment, reason: "not_armor" };
  const previous = nextEquipment[armor.slot];
  nextEquipment[armor.slot] = stack.itemId as ArmorId;
  nextInventory[inventoryIndex] = previous ? { itemId: previous, count: 1 } : null;
  return { ok: true, inventory: nextInventory, equipment: nextEquipment };
}

export function unequipArmor(inventory: readonly (ItemStack | null)[], equipment: Equipment, slot: ArmorSlot): EquipResult {
  const nextEquipment = normalizeEquipment(equipment);
  const itemId = nextEquipment[slot];
  if (!itemId) return { ok: false, inventory: cloneInventory(inventory), equipment: nextEquipment, reason: "empty_slot" };
  const added = addItem(inventory, itemId, 1);
  if (added.remainder) return { ok: false, inventory: cloneInventory(inventory), equipment: nextEquipment, reason: "inventory_full" };
  nextEquipment[slot] = null;
  return { ok: true, inventory: added.inventory, equipment: nextEquipment };
}

export function createSerializablePlayerState(
  inventory: readonly (ItemStack | null)[] = createStarterInventory(),
  selectedHotbar = 0,
  equipment: Equipment = createEmptyEquipment()
): SerializablePlayerState {
  return { inventory: normalizeInventory(inventory), selectedHotbar: clampHotbarIndex(selectedHotbar), equipment: normalizeEquipment(equipment) };
}
