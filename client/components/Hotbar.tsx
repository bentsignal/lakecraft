import { HOTBAR_SIZE, ITEMS, type Inventory } from "../../shared/game";
import { ItemGlyph } from "./ItemGlyph";

export type HotbarProps = {
  inventory: Inventory;
  selectedIndex: number;
  onSelect: (index: number) => void;
  disabled?: boolean;
};

export function Hotbar({ inventory, selectedIndex, onSelect, disabled = false }: HotbarProps) {
  const selected = inventory[selectedIndex];
  return (
    <section className="lc-hotbar-wrap" aria-label="Hotbar">
      <p className="lc-hotbar-label">
        <span>belt inventory</span>
        <strong>{selected ? ITEMS[selected.itemId].label : "Empty hand"}</strong>
      </p>
      <div className="lc-hotbar" role="toolbar" aria-label="Select held item" style={`--selected:${selectedIndex}`}>
        {Array.from({ length: HOTBAR_SIZE }, (_, index) => {
          const stack = inventory[index] ?? null;
          const item = stack ? ITEMS[stack.itemId] : null;
          return (
            <button
              aria-label={`${index + 1}: ${item?.label ?? "Empty"}${index === selectedIndex ? ", selected" : ""}`}
              aria-pressed={index === selectedIndex}
              className={`lc-slot lc-hotbar__slot${index === selectedIndex ? " is-selected" : ""}`}
              disabled={disabled}
              key={index}
              onClick={() => onSelect(index)}
              title={item?.description ?? "Empty slot"}
              type="button"
            >
              <span className="lc-slot__key">{index + 1}</span>
              <ItemGlyph stack={stack} compact />
            </button>
          );
        })}
      </div>
    </section>
  );
}
