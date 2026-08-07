import { ITEMS, type ArmorId, type ArmorSlot } from "../../shared/game.ts";
import { BOX_FACE_SHADES, BOX_VERTEX_COORDINATES } from "./generated/renderGeometry.ts";
import type { PlayerSkinModel } from "./playerSkin.ts";

export const PLAYER_ARMOR_VERTEX_STRIDE = 6;
export type PlayerArmorJoint = "root" | "rightArm" | "leftArm" | "rightLeg" | "leftLeg";
export const PLAYER_ARMOR_BOX_GROUPS: Readonly<Record<ArmorSlot, readonly (readonly [PlayerArmorJoint, number])[]>> = Object.freeze({
  head: Object.freeze([["root", 4]]),
  chest: Object.freeze([["root", 4], ["rightArm", 2], ["leftArm", 2]]),
  legs: Object.freeze([["root", 2], ["rightLeg", 1], ["leftLeg", 1]]),
  feet: Object.freeze([["rightLeg", 2], ["leftLeg", 2]]),
});
export const PLAYER_ARMOR_MAX_BOXES = Object.values(PLAYER_ARMOR_BOX_GROUPS)
  .flat().reduce((total, [, count]) => total + count, 0);
export const PLAYER_ARMOR_MAX_VERTICES = PLAYER_ARMOR_MAX_BOXES * 36;

export type PlayerArmorAppearance = Readonly<Partial<Record<ArmorSlot, ArmorId | null>>>;
export type PlayerArmorMaterial = "leather" | "iron" | "golden" | "diamond";

type Vec3 = readonly [number, number, number];
type ArmorPalette = Readonly<{ base: Vec3; highlight: Vec3; shadow: Vec3; deep: Vec3 }>;

const ARM_OUTER_NEGATIVE = -9;
const ARM_OUTER_POSITIVE = 9;
const ARMOR_BOX_STRIDE = 7;
const ARMOR_BOX_DATA = Object.freeze([
  // head: crown, brow, and temple guards
  -0.29, 1.91, -0.29, 0.29, 2.055, 0.29, 0,
  -0.29, 1.81, 0.255, 0.29, 1.94, 0.315, 1,
  -0.305, 1.55, -0.27, -0.255, 1.92, 0.29, 2,
  0.255, 1.55, -0.27, 0.305, 1.92, 0.29, 0,
  // chest: breastplates, hem, shoulder caps, and bracers
  -0.275, 0.79, -0.15, 0.275, 1.18, 0.17, 0,
  -0.28, 1.16, -0.15, -0.07, 1.43, 0.17, 2,
  0.07, 1.16, -0.15, 0.28, 1.43, 0.17, 1,
  -0.29, 0.73, -0.16, 0.29, 0.84, 0.18, 3,
  ARM_OUTER_NEGATIVE, 1.27, -0.165, -0.235, 1.53, 0.175, 0,
  ARM_OUTER_NEGATIVE, 0.77, -0.16, -0.24, 1.04, 0.17, 2,
  0.235, 1.27, -0.165, ARM_OUTER_POSITIVE, 1.53, 0.175, 1,
  0.24, 0.77, -0.16, ARM_OUTER_POSITIVE, 1.04, 0.17, 0,
  // legs: belt, buckle, and separate leggings
  -0.29, 0.67, -0.155, 0.29, 0.82, 0.17, 2,
  -0.07, 0.68, 0.17, 0.07, 0.8, 0.195, 1,
  -0.265, 0.27, -0.15, -0.005, 0.7, 0.16, 3,
  0.005, 0.27, -0.15, 0.265, 0.7, 0.16, 0,
  // feet: cuffs and projecting toes
  -0.27, 0.2, -0.16, -0.005, 0.34, 0.17, 0,
  -0.275, -0.02, -0.175, -0.005, 0.23, 0.205, 3,
  0.005, 0.2, -0.16, 0.27, 0.34, 0.17, 1,
  0.005, -0.02, -0.175, 0.275, 0.23, 0.205, 2,
] as const);
const ARMOR_BOX_RANGES = Object.freeze({ head: [0, 4], chest: [4, 12], legs: [12, 16], feet: [16, 20] } as const);

function parseColor(value: string): Vec3 {
  if (!/^#[0-9a-f]{6}$/i.test(value)) return [0.55, 0.55, 0.55];
  return [
    Number.parseInt(value.slice(1, 3), 16) / 255,
    Number.parseInt(value.slice(3, 5), 16) / 255,
    Number.parseInt(value.slice(5, 7), 16) / 255,
  ];
}

function mixColor(color: Vec3, target: Vec3, amount: number): Vec3 {
  return [
    color[0] + (target[0] - color[0]) * amount,
    color[1] + (target[1] - color[1]) * amount,
    color[2] + (target[2] - color[2]) * amount,
  ];
}

function armorPalette(itemId: ArmorId): ArmorPalette {
  const base = parseColor(ITEMS[itemId].color);
  return Object.freeze({
    base,
    highlight: mixColor(base, [1, 1, 1], 0.3),
    shadow: mixColor(base, [0, 0, 0], 0.34),
    deep: mixColor(base, [0, 0, 0], 0.52),
  });
}

function appendBox(output: number[], min: Vec3, max: Vec3, color: Vec3): void {
  let point = 0;
  for (const shade of BOX_FACE_SHADES) for (let vertex = 0; vertex < 6; vertex += 1) {
    output.push(
      min[0] + BOX_VERTEX_COORDINATES[point++] * (max[0] - min[0]),
      min[1] + BOX_VERTEX_COORDINATES[point++] * (max[1] - min[1]),
      min[2] + BOX_VERTEX_COORDINATES[point++] * (max[2] - min[2]),
      color[0] * shade,
      color[1] * shade,
      color[2] * shade,
    );
  }
}

function appendArmorBoxes(
  output: number[],
  slot: ArmorSlot,
  palette: ArmorPalette,
  model: PlayerSkinModel,
): void {
  const colors = [palette.base, palette.highlight, palette.shadow, palette.deep] as const;
  const armOuter = model === "slim" ? 0.47 : 0.51;
  const [first, end] = ARMOR_BOX_RANGES[slot];
  for (let box = first; box < end; box += 1) {
    const offset = box * ARMOR_BOX_STRIDE;
    const coordinate = (index: number): number => {
      const value = ARMOR_BOX_DATA[offset + index];
      return value === ARM_OUTER_NEGATIVE ? -armOuter : value === ARM_OUTER_POSITIVE ? armOuter : value;
    };
    appendBox(output, [coordinate(0), coordinate(1), coordinate(2)],
      [coordinate(3), coordinate(4), coordinate(5)], colors[ARMOR_BOX_DATA[offset + 6]]);
  }
}

function validSlotItem(appearance: PlayerArmorAppearance, slot: ArmorSlot): ArmorId | null {
  const itemId = appearance[slot] ?? null;
  return itemId && ITEMS[itemId].armor?.slot === slot ? itemId : null;
}

/** Original bounded plate armor fitted outside the standard 64×64 articulated skin rig. */
export function buildPlayerArmorGeometry(
  appearance: PlayerArmorAppearance,
  model: PlayerSkinModel = "wide",
): Float32Array {
  const output: number[] = [];
  const head = validSlotItem(appearance, "head");
  if (head) appendArmorBoxes(output, "head", armorPalette(head), model);
  const chest = validSlotItem(appearance, "chest");
  if (chest) appendArmorBoxes(output, "chest", armorPalette(chest), model);
  const legs = validSlotItem(appearance, "legs");
  if (legs) appendArmorBoxes(output, "legs", armorPalette(legs), model);
  const feet = validSlotItem(appearance, "feet");
  if (feet) appendArmorBoxes(output, "feet", armorPalette(feet), model);
  return new Float32Array(output);
}

export function fullPlayerArmorAppearance(material: PlayerArmorMaterial): PlayerArmorAppearance {
  return Object.freeze({
    head: `${material}_helmet` as ArmorId,
    chest: `${material}_chestplate` as ArmorId,
    legs: `${material}_leggings` as ArmorId,
    feet: `${material}_boots` as ArmorId,
  });
}
