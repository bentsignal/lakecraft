import { ITEMS, type ItemId } from "./game.ts";

export type VisualModelFamily = "block" | "sprite" | "entity";
export type ItemDisplayContext =
  | "gui"
  | "firstPersonRight"
  | "thirdPersonRight"
  | "ground"
  | "fixed";

export type VisualTransform = Readonly<{
  translation: readonly [number, number, number];
  rotationDegrees: readonly [number, number, number];
  scale: readonly [number, number, number];
  /** Optional model-space pivot; sprite X/Y values use the 16px artwork canvas. */
  pivot?: readonly [number, number, number];
}>;

export type ItemVisualDefinition = Readonly<{
  id: ItemId;
  family: Exclude<VisualModelFamily, "entity">;
  /** Shared model whose transforms and geometry rules are inherited. */
  parent: "block" | "generated" | "handheld" | "bow";
  /** Original Lakecraft artwork key. Inventory and 3D item views share it. */
  artwork: ItemId;
  /** Ordered visual states, used for a drawn bow without inventing another model. */
  variants: readonly string[];
  display: Readonly<Record<ItemDisplayContext, VisualTransform>>;
}>;

function transform(
  rotationDegrees: readonly [number, number, number],
  translation: readonly [number, number, number],
  scale: readonly [number, number, number],
  pivot?: readonly [number, number, number],
): VisualTransform {
  return Object.freeze({ rotationDegrees, translation, scale, ...(pivot ? { pivot } : {}) });
}

/**
 * Coordinate conventions deliberately follow the familiar 16-unit item model
 * space. These are functional transforms, not copied texture/model assets.
 */
const BLOCK_DISPLAY: Readonly<Record<ItemDisplayContext, VisualTransform>> = Object.freeze({
  gui: transform([30, 225, 0], [0, 0, 0], [0.625, 0.625, 0.625]),
  firstPersonRight: transform([0, 45, 0], [0, 0, 0], [0.4, 0.4, 0.4]),
  thirdPersonRight: transform([75, 45, 0], [0, 2.5, 0], [0.375, 0.375, 0.375]),
  ground: transform([0, 0, 0], [0, 3, 0], [0.25, 0.25, 0.25]),
  fixed: transform([0, 0, 0], [0, 0, 0], [0.5, 0.5, 0.5]),
});

const GENERATED_DISPLAY: Readonly<Record<ItemDisplayContext, VisualTransform>> = Object.freeze({
  gui: transform([0, 0, 0], [0, 0, 0], [1, 1, 1]),
  firstPersonRight: transform([0, -90, 25], [1.13, 3.2, 1.13], [0.68, 0.68, 0.68]),
  thirdPersonRight: transform([0, 0, 0], [0, 3, 1], [0.55, 0.55, 0.55]),
  ground: transform([0, 0, 0], [0, 2, 0], [0.5, 0.5, 0.5]),
  fixed: transform([0, 0, 0], [0, 0, 0], [1, 1, 1]),
});

const HANDHELD_DISPLAY: Readonly<Record<ItemDisplayContext, VisualTransform>> = Object.freeze({
  ...GENERATED_DISPLAY,
  firstPersonRight: transform([0, -90, 25], [1.13, 3.2, 1.13], [0.68, 0.68, 0.68]),
  thirdPersonRight: transform([0, -90, 55], [0, 4, 0.5], [0.85, 0.85, 0.85], [4.5, 12.5, 0]),
});

const BOW_DISPLAY: Readonly<Record<ItemDisplayContext, VisualTransform>> = Object.freeze({
  ...GENERATED_DISPLAY,
  firstPersonRight: transform([0, -90, 25], [1.13, 3.2, 1.13], [0.68, 0.68, 0.68]),
  thirdPersonRight: transform([-80, 260, -40], [-1, -2, 2.5], [0.9, 0.9, 0.9], [5, 8, 0]),
});

function parentForItem(itemId: ItemId): ItemVisualDefinition["parent"] {
  const item = ITEMS[itemId];
  if (item.category === "block") return "block";
  if (itemId === "bow") return "bow";
  if (item.tool || item.utility) return "handheld";
  return "generated";
}

function displayForParent(
  parent: ItemVisualDefinition["parent"],
): Readonly<Record<ItemDisplayContext, VisualTransform>> {
  if (parent === "block") return BLOCK_DISPLAY;
  if (parent === "handheld") return HANDHELD_DISPLAY;
  if (parent === "bow") return BOW_DISPLAY;
  return GENERATED_DISPLAY;
}

function variantsForItem(itemId: ItemId): readonly string[] {
  if (itemId === "bow") return Object.freeze(["idle", "drawing-0", "drawing-1", "drawing-2"]);
  if (itemId === "door" || itemId === "oak_fence_gate") return Object.freeze(["closed", "open"]);
  if (itemId === "bed") return Object.freeze(["north", "east"]);
  return Object.freeze(["default"]);
}

function defineItemVisual(itemId: ItemId): ItemVisualDefinition {
  const parent = parentForItem(itemId);
  return Object.freeze({
    id: itemId,
    family: parent === "block" ? "block" : "sprite",
    parent,
    artwork: itemId,
    variants: variantsForItem(itemId),
    display: displayForParent(parent),
  });
}

export const ITEM_VISUALS: Readonly<Record<ItemId, ItemVisualDefinition>> = Object.freeze(
  Object.fromEntries(
    (Object.keys(ITEMS) as ItemId[]).map((itemId) => [itemId, defineItemVisual(itemId)]),
  ) as Record<ItemId, ItemVisualDefinition>,
);

export function itemVisual(itemId: ItemId): ItemVisualDefinition {
  return ITEM_VISUALS[itemId];
}

export function itemVisualIds(): readonly ItemId[] {
  return Object.keys(ITEM_VISUALS) as ItemId[];
}
