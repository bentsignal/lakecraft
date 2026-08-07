import { ITEMS, type ArmorSlot } from "../../shared/game.ts";
import { PLAYER_ARMOR_BOX_GROUPS, type PlayerArmorAppearance } from "./playerArmorGeometry.ts";
import type { PlayerMovementMode } from "./playerMovement.ts";
import type { PlayerSkinModel } from "./playerSkin.ts";

export type PlayerRigMotion = "idle" | "walk";
export type PlayerRigPart = "root" | "rightArm" | "leftArm" | "rightLeg" | "leftLeg";

export type PlayerRigInput = Readonly<{
  motion: PlayerRigMotion;
  /** Normalized deterministic cycle; values outside 0..1 wrap. */
  phase: number;
  intensity?: number;
}>;

export type PlayerRigPose = Readonly<{
  rightArmPitch: number;
  leftArmPitch: number;
  rightLegPitch: number;
  leftLegPitch: number;
}>;

export type PlayerRigDrawRange = Readonly<{
  part: PlayerRigPart;
  first: number;
  count: number;
}>;

const BOX_VERTICES = 36;

/** Base and outer skin boxes stay together so overlays follow the exact same joint. */
export const PLAYER_RIG_SKIN_DRAWS: readonly PlayerRigDrawRange[] = Object.freeze([
  Object.freeze({ part: "root", first: 0, count: 4 * BOX_VERTICES }),
  Object.freeze({ part: "rightArm", first: 4 * BOX_VERTICES, count: 2 * BOX_VERTICES }),
  Object.freeze({ part: "leftArm", first: 6 * BOX_VERTICES, count: 2 * BOX_VERTICES }),
  Object.freeze({ part: "rightLeg", first: 8 * BOX_VERTICES, count: 2 * BOX_VERTICES }),
  Object.freeze({ part: "leftLeg", first: 10 * BOX_VERTICES, count: 2 * BOX_VERTICES }),
]);

function normalizedPhase(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return ((value % 1) + 1) % 1;
}

/** Pure pose sampling shared by live third-person rendering and deterministic Visual Lab scrubbing. */
export function resolvePlayerRigPose(input: PlayerRigInput): PlayerRigPose {
  const cycle = Math.sin(normalizedPhase(input.phase) * Math.PI * 2);
  const intensity = Math.max(0, Math.min(1, Number.isFinite(input.intensity) ? input.intensity! : 1));
  if (input.motion === "idle") {
    const breath = cycle * 0.018 * intensity;
    return Object.freeze({
      rightArmPitch: -0.055 + breath,
      leftArmPitch: 0.04 - breath,
      rightLegPitch: 0,
      leftLegPitch: 0,
    });
  }
  const swing = cycle * 0.78 * intensity;
  return Object.freeze({
    rightArmPitch: swing,
    leftArmPitch: -swing,
    rightLegPitch: -swing,
    leftLegPitch: swing,
  });
}

/** Stable time-to-cycle mapping; no renderer-owned timer or random state is required. */
export function playerRigInputForMovement(mode: PlayerMovementMode, timeMs: number): PlayerRigInput {
  const time = Number.isFinite(timeMs) ? Math.max(0, timeMs) : 0;
  if (mode === "idle") return Object.freeze({ motion: "idle", phase: time / 2_400 });
  const cycleMs = mode === "sprint" ? 420 : mode === "sneak" ? 900 : mode === "ladder" ? 720 : 600;
  const intensity = mode === "sprint" ? 1 : mode === "sneak" ? 0.45 : mode === "ladder" ? 0.65 : 0.82;
  return Object.freeze({ motion: "walk", phase: time / cycleMs, intensity });
}

function pitchForPart(part: PlayerRigPart, pose: PlayerRigPose): number {
  if (part === "rightArm") return pose.rightArmPitch;
  if (part === "leftArm") return pose.leftArmPitch;
  if (part === "rightLeg") return pose.rightLegPitch;
  if (part === "leftLeg") return pose.leftLegPitch;
  return 0;
}

/**
 * Writes one local joint matrix. Standard skin UV ownership historically puts
 * right limbs on +X; `remapStandardSkinSides` moves them to anatomical -X
 * without swapping UVs or mutating the shared geometry.
 */
export function writePlayerRigPartMatrix(
  output: Float32Array,
  part: PlayerRigPart,
  pose: PlayerRigPose,
  model: PlayerSkinModel,
  remapStandardSkinSides: boolean,
): Float32Array {
  const pitch = pitchForPart(part, pose);
  const cosine = Math.cos(pitch);
  const sine = Math.sin(pitch);
  const armCenter = model === "slim" ? 0.34375 : 0.375;
  const translateX = !remapStandardSkinSides || part === "root" ? 0
    : part === "rightArm" ? -2 * armCenter
      : part === "leftArm" ? 2 * armCenter
        : part === "rightLeg" ? -0.25
          : 0.25;
  const pivotY = part === "rightArm" || part === "leftArm" ? model === "slim" ? 1.46875 : 1.5
    : part === "rightLeg" || part === "leftLeg" ? 0.75 : 0;
  output.set([
    1, 0, 0, 0,
    0, cosine, sine, 0,
    0, -sine, cosine, 0,
    translateX, pivotY * (1 - cosine), -pivotY * sine, 1,
  ]);
  return output;
}

function validArmor(appearance: PlayerArmorAppearance, slot: ArmorSlot): boolean {
  const itemId = appearance[slot];
  return itemId !== null && itemId !== undefined && ITEMS[itemId].armor?.slot === slot;
}

/** Draw ranges mirror buildPlayerArmorGeometry box order while assigning anatomical joints. */
export function playerArmorRigDraws(appearance: PlayerArmorAppearance): readonly PlayerRigDrawRange[] {
  const draws: PlayerRigDrawRange[] = [];
  let box = 0;
  const append = (part: PlayerRigPart, count = 1) => {
    draws.push(Object.freeze({ part, first: box * BOX_VERTICES, count: count * BOX_VERTICES }));
    box += count;
  };
  for (const slot of ["head", "chest", "legs", "feet"] as const) {
    if (validArmor(appearance, slot)) for (const [part, count] of PLAYER_ARMOR_BOX_GROUPS[slot]) append(part, count);
  }
  return Object.freeze(draws);
}
