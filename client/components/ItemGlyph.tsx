import { ITEMS, type ItemId, type ItemStack } from "../../shared/game";

export type ItemGlyphProps = {
  stack: ItemStack | null;
  compact?: boolean;
  muted?: boolean;
};

export function ItemGlyph({ stack, compact = false, muted = false }: ItemGlyphProps) {
  if (!stack) return <span className="lc-item-glyph lc-item-glyph--empty" aria-hidden="true" />;
  const item = ITEMS[stack.itemId];
  return (
    <span
      className={`lc-item-glyph lc-item-glyph--${item.category}${muted ? " is-muted" : ""}`}
      style={{ "--item-color": item.color }}
      aria-hidden="true"
    >
      <span className="lc-item-glyph__mark">{item.glyph}</span>
      {!compact ? <span className="lc-item-glyph__code">{item.shortLabel}</span> : null}
      {stack.count > 1 ? <span className="lc-item-glyph__count">{stack.count}</span> : null}
    </span>
  );
}

export function IngredientGlyph({ itemId, count, available }: { itemId: ItemId; count: number; available: number }) {
  const item = ITEMS[itemId];
  const enough = available >= count;
  return (
    <span className={`lc-ingredient${enough ? "" : " is-short"}`} title={`${item.label}: ${available} held, ${count} needed`}>
      <span className="lc-ingredient__mark" style={{ color: item.color }}>{item.glyph}</span>
      <span>{count}</span>
    </span>
  );
}
