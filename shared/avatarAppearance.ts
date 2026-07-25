import { ITEMS, type ArmorSlot, type ItemId } from "./game.ts";

export const MAX_AVATAR_APPEARANCE_ITEM_LENGTH = 64;

export type AvatarAppearance = {
  heldItem: string;
  armorHead: string;
  armorChest: string;
  armorLegs: string;
  armorFeet: string;
};

function normalizedItemId(value: unknown): ItemId | null {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  if (!candidate || candidate.length > MAX_AVATAR_APPEARANCE_ITEM_LENGTH) return null;
  return Object.prototype.hasOwnProperty.call(ITEMS, candidate) ? candidate as ItemId : null;
}

/** Returns an exact shared item ID or the empty wire sentinel. */
export function normalizeHeldAppearanceItem(value: unknown): string {
  return normalizedItemId(value) ?? "";
}

/** Armor is accepted only when its shared definition belongs in the requested slot. */
export function normalizeArmorAppearanceItem(value: unknown, slot: ArmorSlot): string {
  const itemId = normalizedItemId(value);
  return itemId && ITEMS[itemId].armor?.slot === slot ? itemId : "";
}

/** Canonicalizes the five bounded fields stored on sparse multiplayer presence rows. */
export function normalizeAvatarAppearance(
  rawHeldItem: unknown,
  rawArmorHead: unknown,
  rawArmorChest: unknown,
  rawArmorLegs: unknown,
  rawArmorFeet: unknown,
): AvatarAppearance {
  return {
    heldItem: normalizeHeldAppearanceItem(rawHeldItem),
    armorHead: normalizeArmorAppearanceItem(rawArmorHead, "head"),
    armorChest: normalizeArmorAppearanceItem(rawArmorChest, "chest"),
    armorLegs: normalizeArmorAppearanceItem(rawArmorLegs, "legs"),
    armorFeet: normalizeArmorAppearanceItem(rawArmorFeet, "feet"),
  };
}
