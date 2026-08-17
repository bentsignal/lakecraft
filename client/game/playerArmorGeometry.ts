import { ITEMS, type ArmorId, type ArmorSlot } from "../../shared/game.ts";
import {
  buildPlayerSkinPartGeometry,
  PLAYER_SKIN_BOX_FLOATS,
  PLAYER_SKIN_VERTEX_STRIDE,
  type PlayerSkinPart,
} from "./playerSkinGeometry.ts";
import type { PlayerSkinModel } from "./playerSkin.ts";

export const PLAYER_ARMOR_VERTEX_STRIDE = PLAYER_SKIN_VERTEX_STRIDE;
export type PlayerArmorJoint = "head" | "root" | "rightArm" | "leftArm" | "rightLeg" | "leftLeg";
export const PLAYER_ARMOR_BOX_GROUPS: Readonly<Record<ArmorSlot, readonly (readonly [PlayerArmorJoint, number])[]>> = Object.freeze({
  head: Object.freeze([["head", 1]]),
  chest: Object.freeze([["root", 1], ["rightArm", 1], ["leftArm", 1]]),
  legs: Object.freeze([["root", 1], ["rightLeg", 1], ["leftLeg", 1]]),
  feet: Object.freeze([["rightLeg", 1], ["leftLeg", 1]]),
});
export const PLAYER_ARMOR_MAX_BOXES = 9;
export const PLAYER_ARMOR_MAX_VERTICES = PLAYER_ARMOR_MAX_BOXES * 36;
export type PlayerArmorAppearance = Readonly<Partial<Record<ArmorSlot, ArmorId | null>>>;
export type PlayerArmorMaterial = "leather" | "iron" | "golden" | "diamond";

const SLOT_PARTS: Readonly<Record<ArmorSlot, readonly PlayerSkinPart[]>> = Object.freeze({
  head: Object.freeze(["head"]), chest: Object.freeze(["body", "rightArm", "leftArm"]),
  legs: Object.freeze(["body", "rightLeg", "leftLeg"]), feet: Object.freeze(["rightLeg", "leftLeg"]),
});
const MATERIALS = ["leather", "iron", "golden", "diamond"] as const;

function validSlotItem(appearance: PlayerArmorAppearance, slot: ArmorSlot): ArmorId | null {
  const itemId = appearance[slot] ?? null;
  return itemId && ITEMS[itemId].armor?.slot === slot ? itemId : null;
}

function materialIndex(itemId: ArmorId): number {
  const material = itemId.startsWith("golden_") ? "golden" : itemId.slice(0, itemId.indexOf("_"));
  return MATERIALS.indexOf(material as PlayerArmorMaterial);
}

/**
 * One standard Minecraft armor cuboid. Positions follow our articulated skin
 * rig; UVs come from the matching legacy humanoid limb in the exact installed
 * 64x32 equipment texture and are remapped into the 64x256 material atlas.
 */
function appendPart(output: number[], part: PlayerSkinPart, model: PlayerSkinModel, row: number, inflate: number): void {
  const positionGeometry = buildPlayerSkinPartGeometry(part, model).subarray(0, PLAYER_SKIN_BOX_FLOATS);
  const uvPart = part === "leftArm" ? "rightArm" : part === "leftLeg" ? "rightLeg" : part;
  const uvGeometry = buildPlayerSkinPartGeometry(uvPart, model).subarray(0, PLAYER_SKIN_BOX_FLOATS);
  const bounds = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let offset = 0; offset < positionGeometry.length; offset += PLAYER_SKIN_VERTEX_STRIDE) {
    for (let axis = 0; axis < 3; axis += 1) {
      bounds[axis] = Math.min(bounds[axis], positionGeometry[offset + axis]);
      bounds[axis + 3] = Math.max(bounds[axis + 3], positionGeometry[offset + axis]);
    }
  }
  for (let offset = 0; offset < positionGeometry.length; offset += PLAYER_SKIN_VERTEX_STRIDE) {
    for (let axis = 0; axis < 3; axis += 1) {
      const center = (bounds[axis] + bounds[axis + 3]) / 2;
      output.push(positionGeometry[offset + axis] + Math.sign(positionGeometry[offset + axis] - center) * inflate);
    }
    output.push(uvGeometry[offset + 3], (row * 32 + uvGeometry[offset + 4] * 64) / 256, uvGeometry[offset + 5]);
  }
}

/** Exact Minecraft 26.2 humanoid armor texture geometry fitted to the shared player rig. */
export function buildPlayerArmorGeometry(appearance: PlayerArmorAppearance, model: PlayerSkinModel = "wide"): Float32Array {
  const output: number[] = [];
  for (const slot of ["head", "chest", "legs", "feet"] as const) {
    const itemId = validSlotItem(appearance, slot); if (!itemId) continue;
    const row = materialIndex(itemId) * 2 + Number(slot === "legs");
    const inflate = slot === "legs" ? 0.5 / 16 : 1 / 16;
    for (const part of SLOT_PARTS[slot]) appendPart(output, part, model, row, inflate);
  }
  return new Float32Array(output);
}

export function fullPlayerArmorAppearance(material: PlayerArmorMaterial): PlayerArmorAppearance {
  return Object.freeze({
    head: `${material}_helmet` as ArmorId, chest: `${material}_chestplate` as ArmorId,
    legs: `${material}_leggings` as ArmorId, feet: `${material}_boots` as ArmorId,
  });
}
