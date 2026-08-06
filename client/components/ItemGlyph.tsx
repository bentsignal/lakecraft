import { ITEMS, maxItemDurability, remainingItemDurability, type ItemId, type ItemStack } from "../../shared/game";
import { atlasBlockItemGuiIcon, type AtlasBlockGuiIcon } from "./atlasBlockItemIcon.ts";
import { ITEM_ICON_SIZE, getItemIconArt } from "./itemIconArt";

export type ItemGlyphProps = {
  stack: ItemStack | null;
  compact?: boolean;
  muted?: boolean;
};

const paintedBlockCanvases = new WeakMap<HTMLCanvasElement, AtlasBlockGuiIcon>();

function paintAtlasBlockIcon(canvas: HTMLCanvasElement | null, icon: AtlasBlockGuiIcon): void {
  if (!canvas || paintedBlockCanvases.get(canvas) === icon) return;
  const context = canvas.getContext("2d");
  if (!context) return;
  const image = context.createImageData(icon.size, icon.size);
  image.data.set(icon.rgba);
  context.putImageData(image, 0, 0);
  paintedBlockCanvases.set(canvas, icon);
}

export function ItemIcon({ stack, compact = false, muted = false }: ItemGlyphProps) {
  if (!stack) return <span className="lc-item-glyph lc-item-glyph--empty" aria-hidden="true" />;
  const item = ITEMS[stack.itemId];
  const art = getItemIconArt(stack.itemId);
  const guiBlock = atlasBlockItemGuiIcon(stack.itemId);
  const maximumDurability = maxItemDurability(stack.itemId);
  const durability = remainingItemDurability(stack);
  const durabilityPercent = maximumDurability && durability !== null
    ? Math.max(0, Math.min(100, durability / maximumDurability * 100))
    : null;
  return (
    <span
      className={`lc-item-glyph lc-item-icon lc-item-glyph--${item.category}${compact ? " is-compact" : ""}${muted ? " is-muted" : ""}`}
      data-icon-family={art.family}
      data-icon-variant={art.variant}
      aria-hidden="true"
    >
      {guiBlock ? (
        <canvas
          className="lc-item-icon__svg"
          data-source-resolution={guiBlock.size}
          height={guiBlock.size}
          ref={(canvas) => paintAtlasBlockIcon(canvas, guiBlock)}
          width={guiBlock.size}
        />
      ) : (
        <svg className="lc-item-icon__svg" viewBox={`0 0 ${ITEM_ICON_SIZE} ${ITEM_ICON_SIZE}`} shape-rendering="crispEdges" focusable="false">
          {art.runs.map((run, index) => (
            <rect fill={run.color} height="1" key={`${run.x}:${run.y}:${index}`} width={run.width} x={run.x} y={run.y} />
          ))}
        </svg>
      )}
      {stack.count > 1 ? <span className="lc-item-glyph__count">{stack.count}</span> : null}
      {durabilityPercent !== null && durabilityPercent < 100 ? (
        <span className="lc-durability" data-remaining={durability} data-maximum={maximumDurability}>
          <span style={{ background: `hsl(${durabilityPercent * 1.2} 88% 48%)`, width: `${durabilityPercent}%` }} />
        </span>
      ) : null}
    </span>
  );
}

/** Existing call sites keep this name while new UI can use ItemIcon directly. */
export const ItemGlyph = ItemIcon;

export function IngredientGlyph({ itemId, count, available }: { itemId: ItemId; count: number; available: number }) {
  const item = ITEMS[itemId];
  const enough = available >= count;
  return (
    <span className={`lc-ingredient${enough ? "" : " is-short"}`} title={`${item.label}: ${available} held, ${count} needed`}>
      <span className="lc-ingredient__icon"><ItemIcon stack={{ itemId, count: 1 }} compact /></span>
      <span>{count}</span>
    </span>
  );
}
