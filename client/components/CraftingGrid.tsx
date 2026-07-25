import { ITEMS, type ItemStack } from "../../shared/game";
import type { CraftingGridSize } from "../../shared/craftingGrid";
import { ItemGlyph } from "./ItemGlyph";

export type CraftingGridViewProps = {
  size: CraftingGridSize;
  grid: ReadonlyArray<ItemStack | null>;
  output: ItemStack | null;
  outputLabel?: string;
  outputDisabled?: boolean;
  onLeftClickSlot: (slot: number, shiftQuickMove: boolean) => void;
  onRightClickSlot: (slot: number) => void;
  onTakeOutput: (shiftAll: boolean) => void;
};

export function CraftingGridView({
  size,
  grid,
  output,
  outputLabel,
  outputDisabled = false,
  onLeftClickSlot,
  onRightClickSlot,
  onTakeOutput,
}: CraftingGridViewProps) {
  return (
    <div className="lc-crafting-workspace">
      <div className="lc-crafting-grid" style={{ "--craft-grid-size": size }} role="grid" aria-label={`${size} by ${size} crafting grid`}>
        {grid.map((stack, index) => (
          <button
            aria-label={`Crafting slot ${index + 1}: ${stack ? `${ITEMS[stack.itemId].label}, ${stack.count}` : "Empty"}`}
            className="lc-slot lc-crafting-slot"
            key={index}
            onClick={(event) => onLeftClickSlot(index, event.shiftKey)}
            onContextMenu={(event) => {
              event.preventDefault();
              onRightClickSlot(index);
            }}
            role="gridcell"
            title={stack ? ITEMS[stack.itemId].label : "Crafting slot"}
            type="button"
          >
            <ItemGlyph stack={stack} compact />
          </button>
        ))}
      </div>
      <span className="lc-crafting-arrow" aria-hidden="true">→</span>
      <button
        aria-label={output ? `Craft ${outputLabel ?? ITEMS[output.itemId].label}, ${output.count}` : "No matching recipe"}
        className={`lc-slot lc-crafting-result${output ? " is-ready" : ""}`}
        disabled={!output || outputDisabled}
        onClick={(event) => onTakeOutput(event.shiftKey)}
        onContextMenu={(event) => {
          event.preventDefault();
          if (output && !outputDisabled) onTakeOutput(false);
        }}
        title={output ? `Take ${output.count} ${outputLabel ?? ITEMS[output.itemId].label}` : "Arrange a valid recipe"}
        type="button"
      >
        <ItemGlyph stack={output} compact />
      </button>
    </div>
  );
}
