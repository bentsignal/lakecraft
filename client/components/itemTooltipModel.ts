import {
  ITEMS,
  maxItemDurability,
  remainingItemDurability,
  type ItemStack,
} from "../../shared/game";

const TOOLTIP_GAP = 10;
const VIEWPORT_MARGIN = 8;

export type ItemTooltipAttributes = {
  "data-tip"?: string;
};

export type ItemTooltipRect = {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
};

export type ItemTooltipPoint = { x: number; y: number };

export type ItemTooltipSources<T> = {
  pointer: T | null;
  focus: T | null;
};

export function activeItemTooltipTarget<T>(sources: ItemTooltipSources<T>, suspended = false): T | null {
  return suspended ? null : sources.pointer ?? sources.focus;
}

export function setItemTooltipSource<T>(
  sources: ItemTooltipSources<T>,
  source: keyof ItemTooltipSources<T>,
  target: T | null,
): boolean {
  if (sources[source] === target) return false;
  sources[source] = target;
  return true;
}

export function reconcileItemTooltipSources<T>(
  sources: ItemTooltipSources<T>,
  resumed: boolean,
  suspended: boolean,
  hovered: T | null,
  focused: T | null,
  connected: (target: T) => boolean,
  populated: (target: T) => boolean,
): void {
  if (resumed) {
    sources.pointer = hovered;
    sources.focus = focused;
  }
  for (const source of ["pointer", "focus"] as const) {
    const target = sources[source];
    if (target && (!connected(target) || (!suspended && !populated(target)))) sources[source] = null;
  }
}

export function itemTooltipDescribedBy(value: string | null, tooltipId: string): string {
  return [...new Set([...(value?.match(/\S+/g) ?? []), tooltipId])].join(" ");
}

export function itemTooltipAnchorVisible(
  anchor: ItemTooltipRect,
  viewport: { width: number; height: number },
): boolean {
  return anchor.width > 0 && anchor.height > 0 && anchor.right > 0 && anchor.bottom > 0
    && anchor.left < viewport.width && anchor.top < viewport.height;
}

function titleCase(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

export function itemTooltipContent(stack: ItemStack | null): string | null {
  if (!stack) return null;
  const item = ITEMS[stack.itemId];
  const role = item.tool
    ? `${titleCase(item.tool.tier)} ${item.tool.kind} · ${item.tool.attackDamage} attack`
    : item.armor
      ? `${titleCase(item.armor.slot)} armor · ${item.armor.protection} protection`
      : item.ranged
        ? "Ranged weapon"
        : item.utility
          ? "Utility tool"
          : item.food
            ? `Food · +${item.food.hunger} hunger`
            : item.placesBlock ? "Building block" : "Material";
  let metadata = `Count ${stack.count}\n${role}`;
  const maximum = maxItemDurability(stack.itemId);
  const remaining = remainingItemDurability(stack);
  if (maximum !== null && remaining !== null) metadata += `\nDurability ${remaining} / ${maximum}`;
  return `${item.label}\n${metadata}`;
}

export function itemTooltipAttributes(stack: ItemStack | null): ItemTooltipAttributes {
  const content = itemTooltipContent(stack);
  return content ? {
    "data-tip": content,
  } : {};
}

export function positionItemTooltip(
  anchor: ItemTooltipRect,
  tooltip: { width: number; height: number },
  viewport: { width: number; height: number },
): ItemTooltipPoint | null {
  if (!itemTooltipAnchorVisible(anchor, viewport)) return null;
  const maximumY = Math.max(VIEWPORT_MARGIN, viewport.height - tooltip.height - VIEWPORT_MARGIN);
  const clamp = (value: number, maximum: number) => Math.max(VIEWPORT_MARGIN, Math.min(maximum, value));
  const x = clamp(
    anchor.left + (anchor.width - tooltip.width) / 2,
    Math.max(VIEWPORT_MARGIN, viewport.width - tooltip.width - VIEWPORT_MARGIN),
  );
  const above = anchor.top - tooltip.height - TOOLTIP_GAP;
  return {
    x,
    y: above >= VIEWPORT_MARGIN
      ? above
      : clamp(anchor.bottom + TOOLTIP_GAP, maximumY),
  };
}
