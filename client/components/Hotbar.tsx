import { HOTBAR_SIZE, ITEMS, maxItemDurability, remainingItemDurability, type Inventory } from "../../shared/game";
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
        const maximumDurability = stack ? maxItemDurability(stack.itemId) : null;
        const durability = stack ? remainingItemDurability(stack) : null;
        const durabilityLabel = maximumDurability && durability !== null ? `, durability ${durability} of ${maximumDurability}` : "";
        const selected = index === selectedIndex;
        return (
          <button
            aria-label={`${index + 1}: ${item?.label ?? "Empty"}${durabilityLabel}${selected ? ", selected" : ""}`}
            aria-pressed={selected}
            className={`lc-slot lc-hotbar__slot${selected ? " is-selected" : ""}`}
            disabled={disabled}
            key={index}
            onClick={() => onSelect(index)}
            title={item ? `${item.label}${durabilityLabel}` : "Empty slot"}
            type="button"
          >
            <ItemGlyph stack={stack} compact />
          </button>
        );
      })}
    </section>
  );
}
