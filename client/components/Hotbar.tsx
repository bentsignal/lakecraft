import { HOTBAR_SIZE, ITEMS, type Inventory } from "../../shared/game";
import { ItemGlyph } from "./ItemGlyph";

export type HotbarProps = {
  inventory: Inventory;
  selectedIndex: number;
  onSelect: (index: number) => void;
  disabled?: boolean;
};

export function Hotbar({ inventory, selectedIndex, onSelect, disabled = false }: HotbarProps) {
  return (
    <section className="lc-hotbar" role="toolbar" aria-label="Hotbar">
      {Array.from({ length: HOTBAR_SIZE }, (_, index) => {
        const stack = inventory[index] ?? null;
        const item = stack ? ITEMS[stack.itemId] : null;
        const selected = index === selectedIndex;
        return (
          <button
            aria-label={`${index + 1}: ${item?.label ?? "Empty"}${selected ? ", selected" : ""}`}
            aria-pressed={selected}
            className={`lc-slot lc-hotbar__slot${selected ? " is-selected" : ""}`}
            disabled={disabled}
            key={index}
            onClick={() => onSelect(index)}
            title={item?.label ?? "Empty slot"}
            type="button"
          >
            <ItemGlyph stack={stack} compact />
          </button>
        );
      })}
    </section>
  );
}
