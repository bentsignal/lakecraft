import { useEffect, useRef, useState } from "preact/hooks";
import {
  ITEMS,
  RECIPES,
  availableRecipes,
  canCraft,
  craftRecipe,
  equippedArmorProtection,
  removeItem,
  type ArmorSlot,
  type CraftingContext,
  type Equipment,
  type Inventory,
  type ItemId,
  type ItemStack,
  type Recipe,
} from "../../shared/game";
import {
  CRAFTING_GRID_RECIPES,
  createCraftingGrid,
  leftClickCraftingSlot,
  matchCraftingGrid,
  previewCraftingResult,
  rightClickCraftingSlot,
  takeCraftingResult,
  type CraftingGridRecipe,
  type CraftingGridSize,
  type CraftingGridState,
} from "../../shared/craftingGrid";
import { CraftingGridView } from "./CraftingGrid";
import { ItemGlyph } from "./ItemGlyph";

export type InventoryCraftingDrawerProps = {
  open: boolean;
  inventory: Inventory;
  equipment: Equipment;
  craftingContext?: CraftingContext;
  selectedIndex?: number;
  recipes?: readonly Recipe[];
  onClose: () => void;
  /**
   * The root owns the persisted inventory. The drawer passes an exact recipe
   * reconstructed from the occupied grid; the existing root craft transaction
   * atomically removes those ingredients and adds the result.
   */
  onCraft: (recipe: Recipe) => void;
  onEquipArmor: (inventoryIndex: number) => void;
  onUseItem?: (inventoryIndex: number) => void;
  onUnequipArmor: (slot: ArmorSlot) => void;
  onSelectSlot?: (index: number) => void;
};

export function InventoryCraftingDrawer({
  open,
  inventory,
  equipment,
  craftingContext = "field",
  selectedIndex = 0,
  recipes,
  onClose,
  onCraft,
  onEquipArmor,
  onSelectSlot,
  onUnequipArmor,
  onUseItem,
}: InventoryCraftingDrawerProps) {
  const size: CraftingGridSize = craftingContext === "crafting_table" ? 3 : 2;
  const [craftingState, setCraftingState] = useState<CraftingGridState>(() => emptyCraftingState(2));
  const [pointer, setPointer] = useState({ x: 0, y: 0 });
  const stateRef = useRef(craftingState);
  const pendingCraftRef = useRef(false);
  const previousModeRef = useRef(`${open}:${craftingContext}`);
  const displayedRecipes = recipes ?? availableRecipes(craftingContext);
  const allowedRecipeIds = new Set(displayedRecipes.map(({ id }) => id));
  const gridRecipes = CRAFTING_GRID_RECIPES.filter(({ id }) => allowedRecipeIds.has(id));

  useEffect(() => {
    const mode = `${open}:${craftingContext}`;
    if (!open || mode !== previousModeRef.current) replaceCraftingState(emptyCraftingState(size));
    previousModeRef.current = mode;
  }, [open, craftingContext, size]);

  useEffect(() => {
    pendingCraftRef.current = false;
    if (!reservationsFitInventory(inventory, stateRef.current)) replaceCraftingState(emptyCraftingState(size));
  }, [inventory, size]);

  function replaceCraftingState(next: CraftingGridState) {
    stateRef.current = next;
    setCraftingState(next);
  }

  function closeAndReturnItems() {
    // Grid and cursor are reservations over the authoritative inventory, not
    // copies. Clearing them returns every item without a persistence mutation.
    replaceCraftingState(emptyCraftingState(size));
    onClose();
  }

  function leftClickGrid(slot: number) {
    const result = leftClickCraftingSlot(stateRef.current, slot, size);
    if (result.ok) replaceCraftingState(result.state);
  }

  function rightClickGrid(slot: number) {
    const result = rightClickCraftingSlot(stateRef.current, slot, size);
    if (result.ok) replaceCraftingState(result.state);
  }

  const visibleInventory = inventoryWithoutReservations(inventory, craftingState);
  const preview = previewCraftingResult(craftingState.grid, size, gridRecipes);
  const previewRecipe = preview ? displayedRecipes.find(({ id }) => id === preview.recipeId) : undefined;

  function leftClickInventory(index: number) {
    const available = visibleInventory[index];
    const cursor = stateRef.current.cursor;
    if (!cursor) {
      if (available) replaceCraftingState({ ...stateRef.current, cursor: { ...available } });
      else if (index < 9) onSelectSlot?.(index);
      return;
    }
    // Returning the current reservation and taking the clicked available stack
    // is an atomic swap over the unchanged authoritative inventory.
    replaceCraftingState({ ...stateRef.current, cursor: available ? { ...available } : null });
  }

  function rightClickInventory(index: number) {
    const available = visibleInventory[index];
    const cursor = stateRef.current.cursor;
    if (!cursor) {
      if (available) replaceCraftingState({ ...stateRef.current, cursor: { ...available, count: Math.ceil(available.count / 2) } });
      return;
    }
    replaceCraftingState({
      ...stateRef.current,
      cursor: cursor.count > 1 ? { ...cursor, count: cursor.count - 1 } : null,
    });
  }

  function takeOutput(shiftAll: boolean) {
    if (pendingCraftRef.current) return;
    let current = stateRef.current;
    if (shiftAll && current.cursor) return;
    let shadowInventory = inventory.map((stack) => stack ? { ...stack } : null);
    let craftedAny = false;

    for (let attempt = 0; attempt < (shiftAll ? 64 : 1); attempt += 1) {
      const match = matchCraftingGrid(current.grid, size, gridRecipes);
      if (!match) break;
      const base = displayedRecipes.find(({ id }) => id === match.recipe.id) ?? RECIPES.find(({ id }) => id === match.recipe.id);
      if (!base) break;
      const exactRecipe = recipeFromMatch(base, match.recipe, match.consumedSlots, current.grid);
      const taken = takeCraftingResult(current, size, gridRecipes);
      if (!taken.ok || !canCraft(shadowInventory, exactRecipe, craftingContext)) break;
      const shadowResult = craftRecipe(shadowInventory, exactRecipe, craftingContext);
      if (!shadowResult.ok) break;

      craftedAny = true;
      shadowInventory = shadowResult.inventory;
      // Root's existing handler updates its inventory ref synchronously before
      // this local result reservation is rendered.
      onCraft(exactRecipe);
      current = shiftAll ? { grid: taken.state.grid, cursor: null } : taken.state;
    }
    if (!craftedAny) return;
    pendingCraftRef.current = true;
    replaceCraftingState(current);
  }

  if (!open) return null;
  const inventoryOrder = [...inventory.slice(9).keys()].map((offset) => offset + 9).concat([...inventory.slice(0, 9).keys()]);
  return (
    <div
      className="lc-drawer-layer"
      role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget) closeAndReturnItems(); }}
      onPointerMove={(event) => setPointer({ x: event.clientX, y: event.clientY })}
    >
      <aside className="lc-drawer lc-inventory-window" role="dialog" aria-modal="true" aria-labelledby="lc-inventory-title">
        <div className="lc-inventory-titlebar">
          <h2 id="lc-inventory-title">{craftingContext === "crafting_table" ? "Crafting" : "Inventory"}</h2>
          <button className="lc-close" onClick={closeAndReturnItems} type="button" aria-label="Close inventory"><span>Done</span><kbd>E</kbd></button>
        </div>

        <div className="lc-inventory-upper">
          <section className="lc-equipment-panel" aria-label="Player and equipped armor">
            <div className="lc-armor-column">
              {(Object.keys(equipment) as ArmorSlot[]).map((slot) => {
                const itemId = equipment[slot];
                return (
                  <button className={`lc-slot lc-armor-slot${itemId ? " is-equipped" : ""}`} disabled={!itemId} key={slot} onClick={() => onUnequipArmor(slot)} title={itemId ? `Remove ${ITEMS[itemId].label}` : `${slot} armor slot`} type="button">
                    <span className="lc-armor-slot__label">{slot.slice(0, 1).toUpperCase()}</span>
                    <ItemGlyph stack={itemId ? { itemId, count: 1 } : null} compact />
                  </button>
                );
              })}
            </div>
            <div className="lc-player-preview" aria-hidden="true">
              <span className="lc-player-preview__head" />
              <span className="lc-player-preview__body" />
              <span className="lc-player-preview__arm lc-player-preview__arm--left" />
              <span className="lc-player-preview__arm lc-player-preview__arm--right" />
              <span className="lc-player-preview__leg lc-player-preview__leg--left" />
              <span className="lc-player-preview__leg lc-player-preview__leg--right" />
            </div>
            <span className="lc-armor-score">Armor {equippedArmorProtection(equipment)}</span>
          </section>

          <section className="lc-crafting-panel" aria-labelledby="lc-crafting-title">
            <h3 id="lc-crafting-title">Crafting</h3>
            <CraftingGridView
              grid={craftingState.grid}
              onLeftClickSlot={leftClickGrid}
              onRightClickSlot={rightClickGrid}
              onTakeOutput={takeOutput}
              output={preview?.output ?? null}
              outputDisabled={pendingCraftRef.current}
              outputLabel={previewRecipe?.label}
              size={size}
            />
            <p>{size === 2 ? "Use a crafting table for 3×3 recipes." : "Arrange materials to match the recipe shape."}</p>
          </section>
        </div>

        <section className="lc-pack-panel" aria-labelledby="lc-pack-title">
          <h3 id="lc-pack-title">Inventory</h3>
          <div className="lc-inventory-grid" role="grid" aria-label="Inventory slots">
            {inventoryOrder.map((index, displayIndex) => {
              const stack = visibleInventory[index];
              const isHotbar = displayIndex >= inventory.length - 9;
              return (
                <button
                  aria-label={`${index + 1}: ${stack ? `${ITEMS[stack.itemId].label}, ${stack.count}` : "Empty"}`}
                  className={`lc-slot lc-inventory-grid__slot${index === selectedIndex ? " is-selected" : ""}${isHotbar ? " is-hotbar" : ""}`}
                  key={index}
                  onClick={(event) => {
                    if (event.shiftKey && stack && ITEMS[stack.itemId].armor) onEquipArmor(index);
                    else leftClickInventory(index);
                  }}
                  onContextMenu={(event) => { event.preventDefault(); rightClickInventory(index); }}
                  onDblClick={() => stack && ITEMS[stack.itemId].food ? onUseItem?.(index) : undefined}
                  role="gridcell"
                  title={stack ? `${ITEMS[stack.itemId].description}${ITEMS[stack.itemId].armor ? " · Shift-click to equip" : ""}` : "Empty slot"}
                  type="button"
                >
                  <ItemGlyph stack={stack} compact />
                </button>
              );
            })}
          </div>
        </section>
        <span className="lc-inventory-help">Left-click moves a stack · Right-click splits or places one · Shift-click armor to equip</span>
      </aside>
      {craftingState.cursor ? (
        <span className="lc-cursor-stack" style={{ left: pointer.x + 8, top: pointer.y + 8 }} aria-live="polite">
          <ItemGlyph stack={craftingState.cursor} compact />
        </span>
      ) : null}
    </div>
  );
}

function emptyCraftingState(size: CraftingGridSize): CraftingGridState {
  return { grid: createCraftingGrid(size), cursor: null };
}

function inventoryWithoutReservations(inventory: Inventory, state: CraftingGridState): Inventory {
  let next = inventory.map((stack) => stack ? { ...stack } : null);
  for (const stack of [...state.grid, state.cursor]) {
    if (!stack) continue;
    next = removeItem(next, stack.itemId, stack.count).inventory;
  }
  return next;
}

function reservationsFitInventory(inventory: Inventory, state: CraftingGridState): boolean {
  let next = inventory.map((stack) => stack ? { ...stack } : null);
  for (const stack of [...state.grid, state.cursor]) {
    if (!stack) continue;
    const removed = removeItem(next, stack.itemId, stack.count);
    if (removed.remainder > 0) return false;
    next = removed.inventory;
  }
  return true;
}

function recipeFromMatch(
  base: Recipe,
  gridRecipe: CraftingGridRecipe,
  consumedSlots: readonly number[],
  grid: ReadonlyArray<ItemStack | null>,
): Recipe {
  const ingredientCounts = new Map<ItemId, number>();
  for (const slot of consumedSlots) {
    const stack = grid[slot];
    if (stack) ingredientCounts.set(stack.itemId, (ingredientCounts.get(stack.itemId) ?? 0) + 1);
  }
  return {
    ...base,
    ingredients: [...ingredientCounts].map(([itemId, count]) => ({ itemId, count })),
    output: { ...gridRecipe.output },
  };
}
