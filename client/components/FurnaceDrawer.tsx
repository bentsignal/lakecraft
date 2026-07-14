import { ITEMS, SMELTING_RECIPES, countItem, type Inventory, type SmeltingRecipe } from "../../shared/game";
import { ItemGlyph } from "./ItemGlyph";

export type FurnaceDrawerProps = {
  open: boolean;
  inventory: Inventory;
  status?: string;
  error?: string;
  onClose: () => void;
  onSmelt: (recipe: SmeltingRecipe) => void;
};

function FurnaceSlot({ itemId, label, count = 1 }: { itemId: SmeltingRecipe["input"] | SmeltingRecipe["output"] | "coal"; label: string; count?: number }) {
  return (
    <span className="lc-furnace-slot" aria-label={`${label}: ${count} ${ITEMS[itemId].label}`}>
      <small>{label}</small>
      <ItemGlyph stack={{ itemId, count }} />
    </span>
  );
}

export function FurnaceDrawer({ open, inventory, status, error, onClose, onSmelt }: FurnaceDrawerProps) {
  if (!open) return null;
  const fuelCount = countItem(inventory, "coal");
  return (
    <div className="lc-furnace-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="lc-furnace" role="dialog" aria-modal="true" aria-labelledby="lc-furnace-title">
        <header className="lc-furnace__header">
          <div><span>kiln station / solid fuel</span><h2 id="lc-furnace-title">Furnace</h2></div>
          <button onClick={onClose} type="button">Close · E</button>
        </header>
        <div className="lc-furnace__body">
          <div className="lc-furnace__face" aria-hidden="true">
            <span className="lc-furnace__vent" />
            <span className="lc-furnace__mouth"><i /><i /><i /></span>
            <small>{fuelCount} coal in pack</small>
          </div>
          <section className="lc-furnace__recipes" aria-labelledby="lc-smelting-recipes-title">
            <div className="lc-section-rule"><h3 id="lc-smelting-recipes-title">Smelting ledger</h3><small>one coal per firing</small></div>
            {SMELTING_RECIPES.map((recipe) => {
              const inputCount = countItem(inventory, recipe.input);
              const hasInput = inputCount > 0;
              const hasFuel = fuelCount > 0;
              const ready = hasInput && hasFuel;
              const batchCount = Math.min(8, inputCount);
              const action = ready ? "FIRE" : hasInput ? "NEED COAL" : "NEED INPUT";
              return (
                <button className={`lc-furnace-recipe${ready ? " is-ready" : ""}`} disabled={!ready} key={recipe.id} onClick={() => onSmelt(recipe)} type="button">
                  <span className="lc-furnace-recipe__name"><strong>{recipe.label}</strong><small>{inputCount} raw · {fuelCount} fuel</small></span>
                  <span className="lc-furnace-recipe__flow">
                    <FurnaceSlot count={Math.max(1, batchCount)} itemId={recipe.input} label="input" />
                    <FurnaceSlot itemId="coal" label="fuel" />
                    <span className="lc-furnace-flame" title="Furnace heat">♨</span>
                    <FurnaceSlot count={Math.max(1, batchCount)} itemId={recipe.output} label="output" />
                  </span>
                  <span className="lc-furnace-recipe__action">{action}</span>
                </button>
              );
            })}
            <p className={`lc-furnace__status${error ? " is-error" : ""}`} role={error ? "alert" : "status"}>{error || status || "Choose a firing. Finished material returns directly to your pack."}</p>
          </section>
        </div>
      </section>
    </div>
  );
}
