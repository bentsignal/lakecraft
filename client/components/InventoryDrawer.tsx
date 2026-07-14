import { ITEMS, RECIPES, canCraft, countItem, equippedArmorProtection, type ArmorSlot, type Equipment, type Inventory, type Recipe } from "../../shared/game";
import { IngredientGlyph, ItemGlyph } from "./ItemGlyph";

export type InventoryCraftingDrawerProps = {
  open: boolean;
  inventory: Inventory;
  equipment: Equipment;
  selectedIndex?: number;
  recipes?: readonly Recipe[];
  onClose: () => void;
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
  selectedIndex = 0,
  recipes = RECIPES,
  onClose,
  onCraft,
  onEquipArmor,
  onSelectSlot,
  onUnequipArmor,
  onUseItem,
}: InventoryCraftingDrawerProps) {
  if (!open) return null;
  return (
    <div className="lc-drawer-layer" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <aside className="lc-drawer" role="dialog" aria-modal="true" aria-labelledby="lc-inventory-title">
        <div className="lc-drawer__heading">
          <div><span className="lc-kicker">field kit / contents</span><h2 id="lc-inventory-title">Pack & workbench</h2></div>
          <button className="lc-close" onClick={onClose} type="button" aria-label="Close inventory"><span>close</span><kbd>E</kbd></button>
        </div>
        <div className="lc-drawer__body">
          <section className="lc-inventory-panel" aria-labelledby="lc-pack-title">
            <div className="lc-section-rule"><h3 id="lc-pack-title">Rucksack</h3><small>27 pockets</small></div>
            <div className="lc-inventory-grid">
              {inventory.map((stack, index) => (
                <button
                  aria-label={`${index + 1}: ${stack ? ITEMS[stack.itemId].label + `, ${stack.count}` : "Empty"}`}
                  className={`lc-slot lc-inventory-grid__slot${index === selectedIndex ? " is-selected" : ""}`}
                  key={index}
                  onClick={() => stack && ITEMS[stack.itemId].armor ? onEquipArmor(index) : index < 9 ? onSelectSlot?.(index) : undefined}
                  onDblClick={() => stack && ITEMS[stack.itemId].food ? onUseItem?.(index) : undefined}
                  title={stack ? ITEMS[stack.itemId].description : "Empty pocket"}
                  type="button"
                >
                  <span className="lc-slot__index">{String(index + 1).padStart(2, "0")}</span>
                  <ItemGlyph stack={stack} />
                </button>
              ))}
            </div>
            <div className="lc-armor-rack" aria-label="Equipped armor">
              <div><strong>Worn armor</strong><small>{equippedArmorProtection(equipment)} protection</small></div>
              {(Object.keys(equipment) as ArmorSlot[]).map((slot) => {
                const itemId = equipment[slot];
                return (
                  <button className={`lc-armor-slot${itemId ? " is-equipped" : ""}`} disabled={!itemId} key={slot} onClick={() => onUnequipArmor(slot)} title={itemId ? `Remove ${ITEMS[itemId].label}` : `${slot} armor slot`} type="button">
                    <span>{slot}</span><ItemGlyph stack={itemId ? { itemId, count: 1 } : null} />
                  </button>
                );
              })}
            </div>
            <p className="lc-pencil-note">Hotbar occupies pockets 01—09. Double-click food to eat, or ready it and use right-click.</p>
          </section>
          <section className="lc-crafting-panel" aria-labelledby="lc-recipes-title">
            <div className="lc-section-rule"><h3 id="lc-recipes-title">Field recipes</h3><small>{recipes.length} known</small></div>
            <div className="lc-recipe-list">
              {recipes.map((recipe, index) => {
                const craftable = canCraft(inventory, recipe);
                const output = ITEMS[recipe.output.itemId];
                return (
                  <button className={`lc-recipe${craftable ? " is-ready" : ""}`} disabled={!craftable} key={recipe.id} onClick={() => onCraft(recipe)} type="button">
                    <span className="lc-recipe__number">R{String(index + 1).padStart(2, "0")}</span>
                    <span className="lc-recipe__output" style={{ "--item-color": output.color }}><b>{output.glyph}</b><span><strong>{recipe.label}</strong><small>{recipe.note}</small></span></span>
                    <span className="lc-recipe__ingredients">
                      {recipe.ingredients.map((ingredient) => <IngredientGlyph available={countItem(inventory, ingredient.itemId)} count={ingredient.count} itemId={ingredient.itemId} key={ingredient.itemId} />)}
                      <span className="lc-recipe__arrow">→</span><span>{recipe.output.count}</span>
                    </span>
                    <span className="lc-recipe__action">{craftable ? "MAKE" : "NEED"}</span>
                  </button>
                );
              })}
            </div>
          </section>
        </div>
      </aside>
    </div>
  );
}
