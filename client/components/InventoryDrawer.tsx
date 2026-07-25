import { useEffect, useRef, useState } from "preact/hooks";
import {
  ITEMS,
  RECIPES,
  availableRecipes,
  maxItemDurability,
  remainingItemDurability,
  type ArmorSlot,
  type CraftingContext,
  type Equipment,
  type Inventory,
  type Recipe,
} from "../../shared/game";
import { CRAFTING_GRID_RECIPES, previewCraftingResult, type CraftingGridSize } from "../../shared/craftingGrid";
import {
  createInventoryWorkspace,
  doubleClickGatherToCursor,
  leftClickArmorSlot,
  leftClickInventorySlot,
  leftClickWorkspaceCraftingSlot,
  rightClickArmorSlot,
  rightClickInventorySlot,
  rightClickWorkspaceCraftingSlot,
  shiftClickArmorSlot,
  shiftClickInventorySlot,
  shiftClickWorkspaceCraftingSlot,
  stowInventoryWorkspace,
  takeAllWorkspaceCraftingResultsToInventory,
  takeWorkspaceCraftingResult,
  type InventoryWorkspace,
  type InventoryWorkspaceActionResult,
  type StowedInventorySnapshot,
} from "../../shared/inventoryWorkspace";
import {
  MAX_INVENTORY_ACTION_CRAFTS,
  MAX_INVENTORY_ACTION_RECIPE_BATCHES,
  type InventoryRecipeBatch,
} from "../../shared/inventoryActions";
import { CraftingGridView } from "./CraftingGrid";
import { ItemGlyph } from "./ItemGlyph";

export type InventoryCraftingDrawerProps = {
  open: boolean;
  inventory: Inventory;
  equipment: Equipment;
  authorityEpoch: number;
  craftingContext?: CraftingContext;
  selectedIndex?: number;
  recipes?: readonly Recipe[];
  onClose: () => void;
  onCrafted: (recipe: Recipe, craftedCount: number) => void;
  onWorkspaceChange: (
    snapshot: StowedInventorySnapshot,
    expectedAuthorityEpoch: number,
    recipes: readonly InventoryRecipeBatch[],
  ) => boolean;
  /** Local worlds may retain a crash-safe stowed preview after every valid interaction. */
  onWorkspacePreview?: (snapshot: StowedInventorySnapshot) => void;
};

export function InventoryCraftingDrawer({
  open,
  inventory,
  equipment,
  authorityEpoch,
  craftingContext = "field",
  selectedIndex = 0,
  recipes,
  onClose,
  onCrafted,
  onWorkspaceChange,
  onWorkspacePreview,
}: InventoryCraftingDrawerProps) {
  const size: CraftingGridSize = craftingContext === "crafting_table" ? 3 : 2;
  const [workspace, setWorkspace] = useState<InventoryWorkspace>(() => createInventoryWorkspace(inventory, equipment, size));
  const [pointer, setPointer] = useState({ x: 0, y: 0 });
  const [interactionError, setInteractionError] = useState("");
  const stateRef = useRef(workspace);
  const doubleClickBaseRef = useRef<InventoryWorkspace | null>(null);
  const recipeBatchesRef = useRef<InventoryRecipeBatch[]>([]);
  const authorityEpochRef = useRef(authorityEpoch);
  const wasOpenRef = useRef(open);
  const displayedRecipes = recipes ?? availableRecipes(craftingContext);
  const allowedRecipeIds = new Set(displayedRecipes.map(({ id }) => id));
  const gridRecipes = CRAFTING_GRID_RECIPES.filter(({ id }) => allowedRecipeIds.has(id));

  function replaceWorkspace(next: InventoryWorkspace) {
    stateRef.current = next;
    setWorkspace(next);
  }

  function resetFromAuthority(message = "") {
    replaceWorkspace(createInventoryWorkspace(inventory, equipment, size));
    authorityEpochRef.current = authorityEpoch;
    doubleClickBaseRef.current = null;
    recipeBatchesRef.current = [];
    setInteractionError(message);
  }

  useEffect(() => {
    const openedNow = open && !wasOpenRef.current;
    if (openedNow || authorityEpoch !== authorityEpochRef.current || stateRef.current.gridSize !== size) {
      resetFromAuthority();
    }
    wasOpenRef.current = open;
  }, [open, authorityEpoch, craftingContext]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "KeyE" && event.code !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      closeAndStow();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, authorityEpoch, inventory, equipment, craftingContext]);

  function publish(next: InventoryWorkspace): boolean {
    const stowed = stowInventoryWorkspace(next);
    if (!stowed.ok) {
      setInteractionError("No room for the crafted stack. Clear a slot first.");
      return false;
    }
    setInteractionError("");
    replaceWorkspace(next);
    onWorkspacePreview?.(stowed.snapshot);
    return true;
  }

  function recordRecipeBatch(recipeId: string, crafts: number): boolean {
    const batches = recipeBatchesRef.current;
    const totalCrafts = batches.reduce((total, batch) => total + batch.crafts, 0);
    const last = batches[batches.length - 1];
    const batchCount = last?.recipeId === recipeId ? batches.length : batches.length + 1;
    if (totalCrafts + crafts > MAX_INVENTORY_ACTION_CRAFTS
      || batchCount > MAX_INVENTORY_ACTION_RECIPE_BATCHES) {
      setInteractionError("Close the inventory to save these crafts before making more.");
      return false;
    }
    recipeBatchesRef.current = last?.recipeId === recipeId
      ? [...batches.slice(0, -1), { recipeId, crafts: last.crafts + crafts }]
      : [...batches, { recipeId, crafts }];
    return true;
  }

  function publishCraft(next: InventoryWorkspace, recipeId: string, crafts: number): boolean {
    const previousBatches = recipeBatchesRef.current;
    if (!recordRecipeBatch(recipeId, crafts)) return false;
    if (publish(next)) return true;
    recipeBatchesRef.current = previousBatches;
    return false;
  }

  function apply(result: InventoryWorkspaceActionResult, preserveDoubleClickBase = false) {
    if (!preserveDoubleClickBase) doubleClickBaseRef.current = null;
    if (result.ok) publish(result.state);
  }

  function closeAndStow() {
    const stowed = stowInventoryWorkspace(stateRef.current);
    if (!stowed.ok) {
      setInteractionError("No room to stow the held items. Clear a slot first.");
      return;
    }
    if (!onWorkspaceChange(stowed.snapshot, authorityEpochRef.current, recipeBatchesRef.current)) {
      resetFromAuthority("Your Lakebed inventory changed. The latest pack was reloaded.");
      return;
    }
    recipeBatchesRef.current = [];
    onClose();
  }

  function takeOutput(shiftAll: boolean) {
    if (!shiftAll) {
      const result = takeWorkspaceCraftingResult(stateRef.current);
      if (!result.ok || !publishCraft(result.state, result.recipeId, 1)) return;
      const recipe = displayedRecipes.find(({ id }) => id === result.recipeId)
        ?? RECIPES.find(({ id }) => id === result.recipeId);
      if (recipe) onCrafted(recipe, result.crafted.count);
      return;
    }

    const result = takeAllWorkspaceCraftingResultsToInventory(stateRef.current);
    if (!result.ok || !publishCraft(result.state, result.recipeId, result.crafted.batches)) return;
    const recipe = displayedRecipes.find(({ id }) => id === result.recipeId)
      ?? RECIPES.find(({ id }) => id === result.recipeId);
    if (recipe) onCrafted(recipe, result.crafted.count);
  }

  if (!open) return null;
  const preview = previewCraftingResult(workspace.grid, size, gridRecipes);
  const previewRecipe = preview ? displayedRecipes.find(({ id }) => id === preview.recipeId) : undefined;
  const inventoryOrder = [...workspace.inventory.slice(9).keys()].map((offset) => offset + 9)
    .concat([...workspace.inventory.slice(0, 9).keys()]);

  return (
    <div
      className="lc-drawer-layer"
      role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget) closeAndStow(); }}
      onPointerDown={(event) => setPointer({ x: event.clientX, y: event.clientY })}
      onPointerMove={(event) => setPointer({ x: event.clientX, y: event.clientY })}
    >
      <aside className={`lc-drawer lc-inventory-window${size === 3 ? " is-crafting-table" : ""}`} role="dialog" aria-modal="true" aria-labelledby="lc-inventory-title">
        <div className="lc-inventory-titlebar">
          <h2 id="lc-inventory-title">{craftingContext === "crafting_table" ? "Crafting" : "Inventory"}</h2>
          <button className="lc-close" onClick={closeAndStow} type="button" aria-label="Close inventory"><span>Done</span><kbd>E</kbd></button>
        </div>

        <div className="lc-inventory-upper">
          {size === 2 ? <section className="lc-equipment-panel" aria-label="Player and equipped armor">
            <div className="lc-armor-column">
              {(Object.keys(workspace.equipment) as ArmorSlot[]).map((slot) => {
                const stack = workspace.equipment[slot];
                const itemId = stack?.itemId ?? null;
                const maximumDurability = itemId ? maxItemDurability(itemId) : null;
                const durabilityLabel = stack && maximumDurability ? `${stack.durability}/${maximumDurability} durability` : "";
                return (
                  <button
                    aria-label={itemId ? `${ITEMS[itemId].label}, ${durabilityLabel}; ${slot} slot` : `Empty ${slot} armor slot`}
                    className={`lc-slot lc-armor-slot${itemId ? " is-equipped" : ""}`}
                    key={slot}
                    onClick={(event) => apply(event.shiftKey
                      ? shiftClickArmorSlot(stateRef.current, slot)
                      : leftClickArmorSlot(stateRef.current, slot))}
                    onContextMenu={(event) => { event.preventDefault(); apply(rightClickArmorSlot(stateRef.current, slot)); }}
                    title={itemId ? `${ITEMS[itemId].label} · ${durabilityLabel}` : `${slot} armor slot`}
                    type="button"
                  >
                    <span className="lc-armor-slot__label">{slot.slice(0, 1).toUpperCase()}</span>
                    <ItemGlyph stack={stack ? { ...stack, count: 1 } : null} compact />
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
          </section> : null}

          <section className="lc-crafting-panel" aria-label={size === 3 ? "Crafting grid" : undefined} aria-labelledby={size === 2 ? "lc-crafting-title" : undefined}>
            {size === 2 ? <h3 id="lc-crafting-title">Crafting</h3> : null}
            <CraftingGridView
              grid={workspace.grid}
              onLeftClickSlot={(slot, shiftQuickMove) => apply(shiftQuickMove
                ? shiftClickWorkspaceCraftingSlot(stateRef.current, slot)
                : leftClickWorkspaceCraftingSlot(stateRef.current, slot))}
              onRightClickSlot={(slot) => apply(rightClickWorkspaceCraftingSlot(stateRef.current, slot))}
              onTakeOutput={takeOutput}
              output={preview?.output ?? null}
              outputLabel={previewRecipe?.label}
              size={size}
            />
          </section>
        </div>

        <section className="lc-pack-panel" aria-labelledby="lc-pack-title">
          <h3 id="lc-pack-title">Inventory</h3>
          <div className="lc-inventory-grid" role="grid" aria-label="Inventory slots">
            {inventoryOrder.map((index, displayIndex) => {
              const stack = workspace.inventory[index];
              const isHotbar = displayIndex >= workspace.inventory.length - 9;
              const maximumDurability = stack ? maxItemDurability(stack.itemId) : null;
              const durability = stack ? remainingItemDurability(stack) : null;
              const durabilityLabel = maximumDurability && durability !== null ? ` · ${durability}/${maximumDurability} durability` : "";
              return (
                <button
                  aria-label={`${index + 1}: ${stack ? `${ITEMS[stack.itemId].label}, ${stack.count}${durabilityLabel}` : "Empty"}`}
                  className={`lc-slot lc-inventory-grid__slot${index === selectedIndex ? " is-selected" : ""}${isHotbar ? " is-hotbar" : ""}`}
                  key={index}
                  onClick={(event) => {
                    if (event.shiftKey) apply(shiftClickInventorySlot(stateRef.current, index));
                    else if (event.detail >= 2) {
                      let base = doubleClickBaseRef.current ?? stateRef.current;
                      if (!base.cursor) {
                        const pickedUp = leftClickInventorySlot(base, index);
                        if (pickedUp.ok) base = pickedUp.state;
                      }
                      apply(doubleClickGatherToCursor(base));
                      doubleClickBaseRef.current = null;
                    } else {
                      doubleClickBaseRef.current = stateRef.current;
                      apply(leftClickInventorySlot(stateRef.current, index), true);
                    }
                  }}
                  onContextMenu={(event) => { event.preventDefault(); apply(rightClickInventorySlot(stateRef.current, index)); }}
                  role="gridcell"
                  title={stack ? `${ITEMS[stack.itemId].description}${durabilityLabel}` : "Empty slot"}
                  type="button"
                >
                  <ItemGlyph stack={stack} compact />
                </button>
              );
            })}
          </div>
        </section>
        {interactionError ? <span className="lc-inventory-error" role="status">{interactionError}</span> : null}
      </aside>
      {workspace.cursor ? (
        <span className="lc-cursor-stack" style={{ left: pointer.x + 8, top: pointer.y + 8 }} aria-live="polite">
          <ItemGlyph stack={workspace.cursor} compact />
        </span>
      ) : null}
    </div>
  );
}
