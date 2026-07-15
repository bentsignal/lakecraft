import { BLOCKS, ITEMS, maxItemDurability, remainingItemDurability, type BlockId, type ItemId, type ItemStack } from "../../shared/game";
import { ITEM_ICON_SIZE, getItemIconArt } from "./itemIconArt";

export type ItemGlyphProps = {
  stack: ItemStack | null;
  compact?: boolean;
  muted?: boolean;
};

const HELD_SPRITE_BLOCKS = new Set<BlockId>([
  "torch", "door", "bed", "ladder", "sapling", "oak_fence", "oak_fence_gate", "stone_brick_slab",
]);

/** Thin or non-cubic placeables keep their authored item silhouette when held. */
export function isHeldVoxelBlock(itemId: ItemId): itemId is BlockId {
  return ITEMS[itemId].category === "block" && !HELD_SPRITE_BLOCKS.has(itemId as BlockId);
}

function mixHex(from: string, to: string, amount: number): string {
  const channel = (value: string, offset: number) => Number.parseInt(value.slice(offset, offset + 2), 16);
  const mixed = (offset: number) => Math.round(channel(from, offset) + (channel(to, offset) - channel(from, offset)) * amount)
    .toString(16)
    .padStart(2, "0");
  return `#${mixed(1)}${mixed(3)}${mixed(5)}`;
}

/**
 * A fixed-cost, genuinely three-face held block. World textures stay in WebGL;
 * this compact CSS palette keeps the first-person object material-specific.
 */
export function HeldBlockVoxel({ blockId }: { blockId: BlockId }) {
  const block = BLOCKS[blockId];
  const side = blockId === "grass" ? BLOCKS.dirt.color : block.color;
  const top = blockId === "grass" ? block.color : mixHex(block.color, "#ffffff", blockId === "glass" ? 0.36 : 0.2);
  const style = {
    "--lc-voxel-top": top,
    "--lc-voxel-front": mixHex(side, "#ffffff", 0.04),
    "--lc-voxel-right": mixHex(side, "#000000", 0.24),
    "--lc-voxel-accent": block.accent,
    "--lc-voxel-dark": mixHex(block.accent, "#000000", 0.42),
    "--lc-voxel-edge": mixHex(side, "#000000", blockId === "glass" ? 0.32 : 0.54),
  } as Record<string, string>;

  return (
    <span aria-hidden="true" className="lc-held-voxel" data-block={blockId} style={style}>
      <span className="lc-held-voxel__cube">
        <i className="lc-held-voxel__face lc-held-voxel__face--front" />
        <i className="lc-held-voxel__face lc-held-voxel__face--right" />
        <i className="lc-held-voxel__face lc-held-voxel__face--top" />
      </span>
    </span>
  );
}

export function ItemIcon({ stack, compact = false, muted = false }: ItemGlyphProps) {
  if (!stack) return <span className="lc-item-glyph lc-item-glyph--empty" aria-hidden="true" />;
  const item = ITEMS[stack.itemId];
  const art = getItemIconArt(stack.itemId);
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
      <svg className="lc-item-icon__svg" viewBox={`0 0 ${ITEM_ICON_SIZE} ${ITEM_ICON_SIZE}`} shape-rendering="crispEdges" focusable="false">
        {art.runs.map((run, index) => (
          <rect fill={run.color} height="1" key={`${run.x}:${run.y}:${index}`} width={run.width} x={run.x} y={run.y} />
        ))}
      </svg>
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
