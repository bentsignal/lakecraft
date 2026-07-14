export const HOTBAR_SIZE = 9;
export const INVENTORY_SIZE = 27;
export const MAX_HUNGER = 20;
export const MAX_HEALTH = 20;
export const HUNGER_POINT_INTERVAL_SECONDS = 45;
export const HEALTH_RECOVERY_INTERVAL_SECONDS = 4;
export const STARVATION_DAMAGE_INTERVAL_SECONDS = 4;
export const MAX_SURVIVAL_STEP_SECONDS = 5;
export const STARVATION_MIN_HEALTH = 1;

export type BlockId = "grass" | "dirt" | "stone" | "log" | "leaves" | "planks" | "crafting_table" | "torch" | "chest" | "door" | "bed";
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
export type ItemId = BlockId | "stick" | "leather" | "wool" | "pork" | "beef" | "mutton" | "rotten_flesh" | ToolId | ArmorId;
export type ToolKind = "hand" | "pickaxe" | "axe" | "shovel" | "sword";
export type ToolTier = "none" | "wood" | "stone";
export type CraftingContext = "field" | "crafting_table";
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
  requiredDropTool?: { kind: Exclude<ToolKind, "hand">; minimumTier: Exclude<ToolTier, "none"> };
  drop: ItemId | null;
};

export type ItemDefinition = {
  id: ItemId;
  label: string;
  shortLabel: string;
  description: string;
  category: "block" | "material" | "tool" | "armor" | "food";
  maxStack: number;
  glyph: string;
  color: string;
  placesBlock?: BlockId;
  tool?: { kind: Exclude<ToolKind, "hand">; tier: Exclude<ToolTier, "none">; attackDamage: number };
  armor?: { slot: ArmorSlot; protection: number };
  food?: { hunger: number };
};

export type ItemStack = { itemId: ItemId; count: number };
export type Inventory = Array<ItemStack | null>;
export type ItemQuantity = { itemId: ItemId; count: number };

export type FoodConsumptionResult =
  | { ok: true; inventory: Inventory; hunger: number; consumed: ItemId; restored: number }
  | { ok: false; inventory: Inventory; hunger: number; reason: "invalid_slot" | "empty_slot" | "not_food" | "hunger_full" };

/**
 * Transient client-side timing state for the survival loop. Only `hunger` is
 * persisted; the progress fields deliberately reset when a play session starts.
 */
export type SurvivalTickState = {
  hunger: number;
  health: number;
  hungerProgressSeconds: number;
  recoveryProgressSeconds: number;
  starvationProgressSeconds: number;
};

export type SurvivalTickResult = {
  state: SurvivalTickState;
  hungerLost: number;
  healthRecovered: number;
  starvationDamage: number;
};

export type Recipe = {
  id: string;
  label: string;
  note: string;
  craftingContext: CraftingContext;
  ingredients: ItemQuantity[];
  output: ItemQuantity;
};

export type CraftResult =
  | { ok: true; inventory: Inventory; crafted: ItemQuantity }
  | { ok: false; inventory: Inventory; reason: "missing_ingredients" | "inventory_full" | "unknown_recipe" | "requires_crafting_table" };

export type SerializablePlayerState = {
  inventory: Inventory;
  selectedHotbar: number;
  equipment: Equipment;
  respawnPoint: PlayerRespawnPoint | null;
  hunger: number;
};

export type PlayerRespawnPoint = {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
};

export type EquipResult =
  | { ok: true; inventory: Inventory; equipment: Equipment }
  | { ok: false; inventory: Inventory; equipment: Equipment; reason: "not_armor" | "empty_slot" | "inventory_full" };

export const BLOCKS: Record<BlockId, BlockDefinition> = {
  grass: { id: "grass", label: "Grass", description: "A living cap over packed earth.", color: "#718447", accent: "#a7b76a", hardness: 0.75, preferredTool: "shovel", drop: "dirt" },
  dirt: { id: "dirt", label: "Dirt", description: "Soft earth for quick shelter walls.", color: "#7f5638", accent: "#ad7951", hardness: 0.65, preferredTool: "shovel", drop: "dirt" },
  stone: { id: "stone", label: "Stone", description: "Dense fieldstone. A pickaxe is required to recover it.", color: "#6d7069", accent: "#9a9c91", hardness: 2.5, preferredTool: "pickaxe", requiredDropTool: { kind: "pickaxe", minimumTier: "wood" }, drop: "stone" },
  log: { id: "log", label: "Oak Log", description: "Fresh timber. An axe speeds the work.", color: "#76502f", accent: "#bd8a50", hardness: 1.6, preferredTool: "axe", drop: "log" },
  leaves: { id: "leaves", label: "Oak Leaves", description: "A loose, mossy canopy block.", color: "#4e6f3d", accent: "#7c9953", hardness: 0.3, preferredTool: "hand", drop: "leaves" },
  planks: { id: "planks", label: "Oak Planks", description: "Squared boards for building and tools.", color: "#a87841", accent: "#d0a45e", hardness: 1.1, preferredTool: "axe", drop: "planks" },
  crafting_table: { id: "crafting_table", label: "Crafting Table", description: "A sturdy workbench for more involved recipes.", color: "#8a5b32", accent: "#d39a54", hardness: 1.4, preferredTool: "axe", drop: "crafting_table" },
  torch: { id: "torch", label: "Torch", description: "A warm light for shelters and night trails.", color: "#d99a3d", accent: "#ffd36a", hardness: 0.1, preferredTool: "hand", drop: "torch" },
  chest: { id: "chest", label: "Chest", description: "A shared wooden container for supplies.", color: "#8b5728", accent: "#dca14d", hardness: 1.8, preferredTool: "axe", drop: "chest" },
  door: { id: "door", label: "Oak Door", description: "A hinged wooden door for a shelter entrance.", color: "#9a6832", accent: "#d7a35c", hardness: 1.4, preferredTool: "axe", drop: "door" },
  bed: { id: "bed", label: "Bed", description: "A wool bed that can vote to skip the night.", color: "#b85045", accent: "#eee2c4", hardness: 0.5, preferredTool: "hand", drop: "bed" },
};

export const ITEMS: Record<ItemId, ItemDefinition> = {
  grass: blockItem("grass", "GRS", "▨"),
  dirt: blockItem("dirt", "DRT", "▦"),
  stone: blockItem("stone", "STN", "◆"),
  log: blockItem("log", "LOG", "▥"),
  leaves: blockItem("leaves", "LEF", "✤"),
  planks: blockItem("planks", "PLK", "▤"),
  crafting_table: blockItem("crafting_table", "CRF", "▧"),
  torch: blockItem("torch", "TCH", "♨"),
  chest: blockItem("chest", "CHT", "▣"),
  door: blockItem("door", "DOR", "▥"),
  bed: blockItem("bed", "BED", "▰"),
  stick: { id: "stick", label: "Stick", shortLabel: "STK", description: "A straight handle for simple tools.", category: "material", maxStack: 64, glyph: "╱", color: "#c09557" },
  leather: { id: "leather", label: "Leather", shortLabel: "LTH", description: "Tough hide used for lightweight armor.", category: "material", maxStack: 64, glyph: "◩", color: "#8d552f" },
  wool: { id: "wool", label: "Wool", shortLabel: "WOL", description: "Soft sheep wool for beds and future textiles.", category: "material", maxStack: 64, glyph: "◌", color: "#ddd8c8" },
  pork: foodItem("pork", "Raw Pork", "PRK", 3, "Raw pork from a pig.", "◒", "#d98e8b"),
  beef: foodItem("beef", "Raw Beef", "BEF", 4, "Raw beef from a cow.", "◆", "#a9544d"),
  mutton: foodItem("mutton", "Raw Mutton", "MTN", 3, "Raw mutton from a sheep.", "◇", "#b66b63"),
  rotten_flesh: foodItem("rotten_flesh", "Rotten Flesh", "ROT", 1, "Unpleasant, but technically edible.", "✦", "#756d3e"),
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

function foodItem(id: "pork" | "beef" | "mutton" | "rotten_flesh", label: string, shortLabel: string, hunger: number, description: string, glyph: string, color: string): ItemDefinition {
  return { id, label, shortLabel, description, category: "food", maxStack: 64, glyph, color, food: { hunger } };
}

export const RECIPES: readonly Recipe[] = [
  { id: "planks_from_log", label: "Saw planks", note: "Split one log into four boards.", craftingContext: "field", ingredients: [{ itemId: "log", count: 1 }], output: { itemId: "planks", count: 4 } },
  { id: "sticks_from_planks", label: "Whittle sticks", note: "Two boards make four handles.", craftingContext: "field", ingredients: [{ itemId: "planks", count: 2 }], output: { itemId: "stick", count: 4 } },
  { id: "crafting_table", label: "Crafting table", note: "Four boards make a proper workbench.", craftingContext: "field", ingredients: [{ itemId: "planks", count: 4 }], output: { itemId: "crafting_table", count: 1 } },
  { id: "torch", label: "Torches", note: "A stick and board make four crude lights.", craftingContext: "field", ingredients: [{ itemId: "stick", count: 1 }, { itemId: "planks", count: 1 }], output: { itemId: "torch", count: 4 } },
  { id: "chest", label: "Chest", note: "Eight boards make shared storage.", craftingContext: "crafting_table", ingredients: [{ itemId: "planks", count: 8 }], output: { itemId: "chest", count: 1 } },
  { id: "door", label: "Oak door", note: "Six boards make a shelter door.", craftingContext: "crafting_table", ingredients: [{ itemId: "planks", count: 6 }], output: { itemId: "door", count: 1 } },
  { id: "bed", label: "Bed", note: "Three wool and three boards make a bed.", craftingContext: "crafting_table", ingredients: [{ itemId: "wool", count: 3 }, { itemId: "planks", count: 3 }], output: { itemId: "bed", count: 1 } },
  { id: "wooden_pickaxe", label: "Wood pickaxe", note: "A starter quarrying tool.", craftingContext: "crafting_table", ingredients: [{ itemId: "planks", count: 3 }, { itemId: "stick", count: 2 }], output: { itemId: "wooden_pickaxe", count: 1 } },
  { id: "wooden_axe", label: "Wood axe", note: "Fells logs faster.", craftingContext: "crafting_table", ingredients: [{ itemId: "planks", count: 3 }, { itemId: "stick", count: 2 }], output: { itemId: "wooden_axe", count: 1 } },
  { id: "wooden_shovel", label: "Wood shovel", note: "Clears dirt and grass faster.", craftingContext: "crafting_table", ingredients: [{ itemId: "planks", count: 1 }, { itemId: "stick", count: 2 }], output: { itemId: "wooden_shovel", count: 1 } },
  { id: "wooden_sword", label: "Wood sword", note: "Basic protection after dark.", craftingContext: "crafting_table", ingredients: [{ itemId: "planks", count: 2 }, { itemId: "stick", count: 1 }], output: { itemId: "wooden_sword", count: 1 } },
  { id: "stone_pickaxe", label: "Stone pickaxe", note: "A faster, sturdier pick.", craftingContext: "crafting_table", ingredients: [{ itemId: "stone", count: 3 }, { itemId: "stick", count: 2 }], output: { itemId: "stone_pickaxe", count: 1 } },
  { id: "stone_axe", label: "Stone axe", note: "A proper timber tool.", craftingContext: "crafting_table", ingredients: [{ itemId: "stone", count: 3 }, { itemId: "stick", count: 2 }], output: { itemId: "stone_axe", count: 1 } },
  { id: "stone_shovel", label: "Stone shovel", note: "Moves soil in a hurry.", craftingContext: "crafting_table", ingredients: [{ itemId: "stone", count: 1 }, { itemId: "stick", count: 2 }], output: { itemId: "stone_shovel", count: 1 } },
  { id: "stone_sword", label: "Stone sword", note: "A sharper answer to hostile creatures.", craftingContext: "crafting_table", ingredients: [{ itemId: "stone", count: 2 }, { itemId: "stick", count: 1 }], output: { itemId: "stone_sword", count: 1 } },
  { id: "leather_helmet", label: "Leather cap", note: "Light protection for the head.", craftingContext: "crafting_table", ingredients: [{ itemId: "leather", count: 5 }], output: { itemId: "leather_helmet", count: 1 } },
  { id: "leather_chestplate", label: "Leather tunic", note: "A hide layer for the torso.", craftingContext: "crafting_table", ingredients: [{ itemId: "leather", count: 8 }], output: { itemId: "leather_chestplate", count: 1 } },
  { id: "leather_leggings", label: "Leather pants", note: "Flexible leg protection.", craftingContext: "crafting_table", ingredients: [{ itemId: "leather", count: 7 }], output: { itemId: "leather_leggings", count: 1 } },
  { id: "leather_boots", label: "Leather boots", note: "A little protection underfoot.", craftingContext: "crafting_table", ingredients: [{ itemId: "leather", count: 4 }], output: { itemId: "leather_boots", count: 1 } },
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

export function normalizeHunger(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(MAX_HUNGER, Math.floor(value)))
    : MAX_HUNGER;
}

function normalizeHealth(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(MAX_HEALTH, value))
    : MAX_HEALTH;
}

function normalizeTimer(value: unknown, intervalSeconds: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(intervalSeconds, value))
    : 0;
}

/** Consumes exactly one food item from `inventoryIndex` when hunger is not full. */
export function consumeFood(
  inventory: readonly (ItemStack | null)[],
  inventoryIndex: number,
  hunger: number,
): FoodConsumptionResult {
  const next = cloneInventory(inventory);
  const currentHunger = normalizeHunger(hunger);
  if (!Number.isInteger(inventoryIndex) || inventoryIndex < 0 || inventoryIndex >= next.length) {
    return { ok: false, inventory: next, hunger: currentHunger, reason: "invalid_slot" };
  }
  const stack = next[inventoryIndex];
  if (!stack) return { ok: false, inventory: next, hunger: currentHunger, reason: "empty_slot" };
  const food = ITEMS[stack.itemId].food;
  if (!food) return { ok: false, inventory: next, hunger: currentHunger, reason: "not_food" };
  if (currentHunger >= MAX_HUNGER) return { ok: false, inventory: next, hunger: currentHunger, reason: "hunger_full" };

  const nextHunger = Math.min(MAX_HUNGER, currentHunger + food.hunger);
  if (stack.count === 1) next[inventoryIndex] = null;
  else stack.count -= 1;
  return {
    ok: true,
    inventory: next,
    hunger: nextHunger,
    consumed: stack.itemId,
    restored: nextHunger - currentHunger,
  };
}

export function createSurvivalTickState(hunger = MAX_HUNGER, health = MAX_HEALTH): SurvivalTickState {
  return {
    hunger: normalizeHunger(hunger),
    health: normalizeHealth(health),
    hungerProgressSeconds: 0,
    recoveryProgressSeconds: 0,
    starvationProgressSeconds: 0,
  };
}

/**
 * Advances hunger and health without accessing clocks or browser state.
 *
 * `activityMultiplier` is capped to 0..4 so callers may distinguish resting,
 * walking, and sprinting without allowing a delayed frame to drain the player
 * unboundedly. Elapsed time is likewise capped per call. Well-fed players heal
 * one point every four seconds at the cost of one hunger point; starving players
 * lose health at the same cadence but never below one health from starvation.
 */
export function tickSurvival(
  input: Readonly<SurvivalTickState>,
  elapsedSeconds: number,
  activityMultiplier = 1,
): SurvivalTickResult {
  const elapsed = Number.isFinite(elapsedSeconds)
    ? Math.max(0, Math.min(MAX_SURVIVAL_STEP_SECONDS, elapsedSeconds))
    : 0;
  const activity = Number.isFinite(activityMultiplier)
    ? Math.max(0, Math.min(4, activityMultiplier))
    : 1;
  let hunger = normalizeHunger(input.hunger);
  let health = normalizeHealth(input.health);
  let hungerProgressSeconds = normalizeTimer(input.hungerProgressSeconds, HUNGER_POINT_INTERVAL_SECONDS)
    + elapsed * activity;
  let recoveryProgressSeconds = normalizeTimer(input.recoveryProgressSeconds, HEALTH_RECOVERY_INTERVAL_SECONDS);
  let starvationProgressSeconds = normalizeTimer(input.starvationProgressSeconds, STARVATION_DAMAGE_INTERVAL_SECONDS);
  let hungerLost = 0;
  let healthRecovered = 0;
  let starvationDamage = 0;

  const passiveHungerLoss = Math.min(hunger, Math.floor(hungerProgressSeconds / HUNGER_POINT_INTERVAL_SECONDS));
  hunger -= passiveHungerLoss;
  hungerLost += passiveHungerLoss;
  hungerProgressSeconds -= passiveHungerLoss * HUNGER_POINT_INTERVAL_SECONDS;
  if (hunger === 0) hungerProgressSeconds = 0;

  if (hunger >= 18 && health < MAX_HEALTH) {
    recoveryProgressSeconds += elapsed;
    const recoveryEvents = Math.min(
      Math.floor(recoveryProgressSeconds / HEALTH_RECOVERY_INTERVAL_SECONDS),
      Math.ceil(MAX_HEALTH - health),
      hunger - 17,
    );
    healthRecovered = Math.min(recoveryEvents, MAX_HEALTH - health);
    health += healthRecovered;
    hunger -= recoveryEvents;
    hungerLost += recoveryEvents;
    recoveryProgressSeconds -= recoveryEvents * HEALTH_RECOVERY_INTERVAL_SECONDS;
    if (hunger < 18 || health >= MAX_HEALTH) recoveryProgressSeconds = 0;
  } else {
    recoveryProgressSeconds = 0;
  }

  if (hunger === 0 && health > STARVATION_MIN_HEALTH) {
    starvationProgressSeconds += elapsed;
    const starvationEvents = Math.min(
      Math.floor(starvationProgressSeconds / STARVATION_DAMAGE_INTERVAL_SECONDS),
      Math.ceil(health - STARVATION_MIN_HEALTH),
    );
    starvationDamage = Math.min(starvationEvents, health - STARVATION_MIN_HEALTH);
    health -= starvationDamage;
    starvationProgressSeconds -= starvationEvents * STARVATION_DAMAGE_INTERVAL_SECONDS;
    if (health <= STARVATION_MIN_HEALTH) starvationProgressSeconds = 0;
  } else {
    starvationProgressSeconds = 0;
  }

  return {
    state: { hunger, health, hungerProgressSeconds, recoveryProgressSeconds, starvationProgressSeconds },
    hungerLost,
    healthRecovered,
    starvationDamage,
  };
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

export function recipeCraftingContext(recipeOrId: Recipe | string): CraftingContext | null {
  const recipe = typeof recipeOrId === "string" ? RECIPES.find(({ id }) => id === recipeOrId) : recipeOrId;
  return recipe?.craftingContext ?? null;
}

/** A crafting table includes the player's 2x2 field grid, so it can make either recipe class. */
export function isRecipeAvailableInContext(recipeOrId: Recipe | string, context: CraftingContext): boolean {
  const requiredContext = recipeCraftingContext(recipeOrId);
  return requiredContext === "field" || (requiredContext === "crafting_table" && context === "crafting_table");
}

export function availableRecipes(context: CraftingContext): readonly Recipe[] {
  return RECIPES.filter((recipe) => isRecipeAvailableInContext(recipe, context));
}

export function canCraft(
  inventory: readonly (ItemStack | null)[],
  recipe: Recipe,
  context: CraftingContext = "crafting_table",
): boolean {
  if (!isRecipeAvailableInContext(recipe, context)) return false;
  if (!hasItems(inventory, recipe.ingredients)) return false;
  let next = cloneInventory(inventory);
  for (const ingredient of recipe.ingredients) next = removeItem(next, ingredient.itemId, ingredient.count).inventory;
  return addItem(next, recipe.output.itemId, recipe.output.count).remainder === 0;
}

export function craftRecipe(
  inventory: readonly (ItemStack | null)[],
  recipeOrId: Recipe | string,
  context: CraftingContext = "crafting_table",
): CraftResult {
  const recipe = typeof recipeOrId === "string" ? RECIPES.find(({ id }) => id === recipeOrId) : recipeOrId;
  const original = cloneInventory(inventory);
  if (!recipe) return { ok: false, inventory: original, reason: "unknown_recipe" };
  if (!isRecipeAvailableInContext(recipe, context)) return { ok: false, inventory: original, reason: "requires_crafting_table" };
  if (!hasItems(original, recipe.ingredients)) return { ok: false, inventory: original, reason: "missing_ingredients" };
  let next = original;
  for (const ingredient of recipe.ingredients) next = removeItem(next, ingredient.itemId, ingredient.count).inventory;
  const added = addItem(next, recipe.output.itemId, recipe.output.count);
  if (added.remainder > 0) return { ok: false, inventory: cloneInventory(inventory), reason: "inventory_full" };
  return { ok: true, inventory: added.inventory, crafted: { ...recipe.output } };
}

export function canHarvestBlock(blockId: BlockId, itemId?: ItemId | null): boolean {
  const requirement = BLOCKS[blockId].requiredDropTool;
  if (!requirement) return true;
  if (!itemId) return false;
  const tool = ITEMS[itemId].tool;
  if (!tool || tool.kind !== requirement.kind) return false;
  const tierRank: Record<Exclude<ToolTier, "none">, number> = { wood: 1, stone: 2 };
  return tierRank[tool.tier] >= tierRank[requirement.minimumTier];
}

export function getMiningDrop(blockId: BlockId, itemId?: ItemId | null): ItemQuantity | null {
  if (!canHarvestBlock(blockId, itemId)) return null;
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

export function normalizeRespawnPoint(value: unknown): PlayerRespawnPoint | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<Record<keyof PlayerRespawnPoint, unknown>>;
  const { x, y, z, yaw, pitch } = candidate;
  if (typeof x !== "number" || !Number.isFinite(x) || x < -64 || x > 64
    || typeof y !== "number" || !Number.isFinite(y) || y < -4 || y > 96
    || typeof z !== "number" || !Number.isFinite(z) || z < -64 || z > 64
    || typeof yaw !== "number" || !Number.isFinite(yaw) || yaw < -100_000 || yaw > 100_000
    || typeof pitch !== "number" || !Number.isFinite(pitch) || pitch < -1.52 || pitch > 1.52) {
    return null;
  }
  return { x, y, z, yaw, pitch };
}

export function createSerializablePlayerState(
  inventory: readonly (ItemStack | null)[] = createStarterInventory(),
  selectedHotbar = 0,
  equipment: Equipment = createEmptyEquipment(),
  respawnPoint: PlayerRespawnPoint | null = null,
  hunger = MAX_HUNGER,
): SerializablePlayerState {
  return {
    inventory: normalizeInventory(inventory),
    selectedHotbar: clampHotbarIndex(selectedHotbar),
    equipment: normalizeEquipment(equipment),
    respawnPoint: normalizeRespawnPoint(respawnPoint),
    hunger: normalizeHunger(hunger),
  };
}

export function normalizeSerializablePlayerState(value: unknown): SerializablePlayerState {
  if (Array.isArray(value)) return createSerializablePlayerState(value);
  if (!value || typeof value !== "object") return createSerializablePlayerState();
  const candidate = value as {
    inventory?: unknown;
    selectedHotbar?: unknown;
    equipment?: unknown;
    respawnPoint?: unknown;
    hunger?: unknown;
  };
  return createSerializablePlayerState(
    Array.isArray(candidate.inventory) ? candidate.inventory as Array<ItemStack | null> : createStarterInventory(),
    typeof candidate.selectedHotbar === "number" ? candidate.selectedHotbar : 0,
    normalizeEquipment(candidate.equipment),
    normalizeRespawnPoint(candidate.respawnPoint),
    normalizeHunger(candidate.hunger),
  );
}

export function parseSerializablePlayerStateJson(rawJson: string): SerializablePlayerState | null {
  try {
    const parsed = JSON.parse(rawJson) as unknown;
    if (!parsed || (typeof parsed !== "object" && !Array.isArray(parsed))) return null;
    return normalizeSerializablePlayerState(parsed);
  } catch {
    return null;
  }
}
