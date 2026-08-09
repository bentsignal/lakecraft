import { ITEMS, type ArmorSlot } from "../../shared/game.ts";
import { PLAYER_ARMOR_BOX_GROUPS, type PlayerArmorAppearance } from "./playerArmorGeometry.ts";
import type { PlayerMovementMode } from "./playerMovement.ts";
import type { PlayerSkinModel } from "./playerSkin.ts";

export type PlayerRigMotion = "idle" | "walk";
export type PlayerRigPart = "head" | "root" | "rightArm" | "leftArm" | "rightLeg" | "leftLeg";

export type PlayerRigInput = Readonly<{
  motion: PlayerRigMotion;
  /** Normalized deterministic cycle; values outside 0..1 wrap. */
  phase: number;
  intensity?: number;
  /** Camera-relative look angles; the torso yaw is applied by the world matrix. */
  headYaw?: number;
  headPitch?: number;
  /** One-shot right-arm animation, normalized from 0 at start to 1 at finish. */
  actionProgress?: number;
  /** Lowers and leans the upper body instead of reusing a walk-only silhouette. */
  crouching?: boolean;
}>;

export type PlayerRigPose = Readonly<{
  headYaw: number;
  headPitch: number;
  rightArmPitch: number;
  rightArmYaw: number;
  leftArmPitch: number;
  rightLegPitch: number;
  leftLegPitch: number;
  bodyPitch: number;
  bodyYOffset: number;
  bodyZOffset: number;
}>;

export type PlayerRigDrawRange = Readonly<{
  part: PlayerRigPart;
  first: number;
  count: number;
}>;

const BOX_VERTICES = 36;

/** Base and outer skin boxes stay together so overlays follow the exact same joint. */
export const PLAYER_RIG_SKIN_DRAWS: readonly PlayerRigDrawRange[] = Object.freeze([
  Object.freeze({ part: "head", first: 0, count: 2 * BOX_VERTICES }),
  Object.freeze({ part: "root", first: 2 * BOX_VERTICES, count: 2 * BOX_VERTICES }),
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
  const headYaw = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, Number.isFinite(input.headYaw) ? input.headYaw! : 0));
  const headPitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, Number.isFinite(input.headPitch) ? input.headPitch! : 0));
  const actionProgress = Number.isFinite(input.actionProgress)
    ? Math.max(0, Math.min(1, input.actionProgress!))
    : -1;
  const actionActive = actionProgress >= 0 && actionProgress < 1;
  // A gameplay swing follows a compact ellipse: the arm reaches down/forward
  // while also travelling out and back. The previous 1.8-radian pitch-only
  // flick looked like the shoulder was dislocating in third person.
  const actionSwing = actionActive ? Math.sin(actionProgress * Math.PI) * 0.92 : 0;
  const actionSweep = actionActive ? Math.sin(actionProgress * Math.PI * 2) * 0.3 : 0;
  const bodyPitch = input.crouching ? 0.5 : 0;
  // Sneaking counterbalances around the feet. The lower body leans backward by
  // the same angle that the torso leans forward, keeping the neck directly
  // above its standing horizontal position instead of moving the whole avatar
  // forward. These offsets are the exact displaced hip coordinates.
  const bodyYOffset = bodyPitch === 0 ? 0 : 0.75 * (Math.cos(bodyPitch) - 1);
  const bodyZOffset = bodyPitch === 0 ? 0 : -0.75 * Math.sin(bodyPitch);
  if (input.motion === "idle") {
    const breath = cycle * 0.018 * intensity;
    return Object.freeze({
      headYaw,
      headPitch,
      rightArmPitch: -0.055 + breath - actionSwing,
      rightArmYaw: actionSweep,
      leftArmPitch: 0.04 - breath,
      rightLegPitch: 0,
      leftLegPitch: 0,
      bodyPitch,
      bodyYOffset,
      bodyZOffset,
    });
  }
  const swing = cycle * 0.78 * intensity;
  return Object.freeze({
    headYaw,
    headPitch,
    rightArmPitch: swing - actionSwing,
    rightArmYaw: actionSweep,
    leftArmPitch: -swing,
    rightLegPitch: -swing,
    leftLegPitch: swing,
    bodyPitch,
    bodyYOffset,
    bodyZOffset,
  });
}

/** Stable time-to-cycle mapping; no renderer-owned timer or random state is required. */
export function playerRigInputForMovement(mode: PlayerMovementMode, timeMs: number, moving = mode !== "idle"): PlayerRigInput {
  const time = Number.isFinite(timeMs) ? Math.max(0, timeMs) : 0;
  const crouching = mode === "sneak";
  if (mode === "idle" || !moving) {
    return Object.freeze({ motion: "idle", phase: time / 2_400, ...(crouching ? { crouching: true } : {}) });
  }
  const cycleMs = mode === "sprint" ? 420 : mode === "sneak" ? 900 : mode === "ladder" ? 720 : 600;
  const intensity = mode === "sprint" ? 1 : mode === "sneak" ? 0.45 : mode === "ladder" ? 0.65 : 0.82;
  return Object.freeze({ motion: "walk", phase: time / cycleMs, intensity, ...(crouching ? { crouching: true } : {}) });
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
  scratch?: Float32Array,
): Float32Array {
  const upperBodyPart = part === "root" || part === "rightArm" || part === "leftArm";
  const needsBodyPose = upperBodyPart
    && (pose.bodyPitch !== 0 || pose.bodyYOffset !== 0 || pose.bodyZOffset !== 0);
  const localOutput = needsBodyPose ? scratch ?? new Float32Array(16) : output;
  if (part === "head") {
    // The head keeps exactly the standing yaw/pitch basis while crouching.
    // Only its neck position follows the torso hinge; multiplying the head's
    // yaw by the body pitch created an unintended sideways roll.
    const yawCosine = Math.cos(pose.headYaw);
    const yawSine = Math.sin(pose.headYaw);
    const pitchCosine = Math.cos(pose.headPitch);
    const pitchSine = Math.sin(pose.headPitch);
    const pivotY = 1.5;
    localOutput.set([
      yawCosine, 0, -yawSine, 0,
      yawSine * pitchSine, pitchCosine, yawCosine * pitchSine, 0,
      yawSine * pitchCosine, -pitchSine, yawCosine * pitchCosine, 0,
      -pivotY * yawSine * pitchSine,
      pivotY * (1 - pitchCosine),
      -pivotY * yawCosine * pitchSine,
      1,
    ]);
    if (pose.bodyPitch !== 0 || pose.bodyYOffset !== 0 || pose.bodyZOffset !== 0) {
      const neckAboveHip = 0.75;
      localOutput[13] += neckAboveHip * (Math.cos(pose.bodyPitch) - 1) + pose.bodyYOffset;
      localOutput[14] += neckAboveHip * Math.sin(pose.bodyPitch) + pose.bodyZOffset;
    }
  } else {
    const pitch = pitchForPart(part, pose);
    const legPart = part === "rightLeg" || part === "leftLeg";
    const basePitch = legPart && pose.bodyPitch !== 0 ? -pose.bodyPitch : pitch;
    const cosine = Math.cos(basePitch);
    const sine = Math.sin(basePitch);
    const armCenter = model === "slim" ? 0.34375 : 0.375;
    const translateX = !remapStandardSkinSides || part === "root" ? 0
      : part === "rightArm" ? -2 * armCenter
        : part === "leftArm" ? 2 * armCenter
          : part === "rightLeg" ? -0.25
            : 0.25;
    const pivotY = part === "rightArm" || part === "leftArm" ? model === "slim" ? 1.46875 : 1.5
      : legPart && pose.bodyPitch === 0 ? 0.75 : 0;
    localOutput.set([
      1, 0, 0, 0,
      0, cosine, sine, 0,
      0, -sine, cosine, 0,
      translateX, pivotY * (1 - cosine), -pivotY * sine, 1,
    ]);
    if (legPart && pose.bodyPitch !== 0 && pitch !== 0) {
      // Crouch-walking articulates around the already displaced hip so each
      // leg stays connected while preserving the shared backward lean.
      const walkCosine = Math.cos(pitch);
      const walkSine = Math.sin(pitch);
      const hipY = 0.75 * Math.cos(pose.bodyPitch);
      const hipZ = -0.75 * Math.sin(pose.bodyPitch);
      const translateY = hipY * (1 - walkCosine) + hipZ * walkSine;
      const translateZ = hipZ * (1 - walkCosine) - hipY * walkSine;
      for (let column = 0; column < 4; column += 1) {
        const offset = column * 4;
        const x = localOutput[offset]; const y = localOutput[offset + 1];
        const z = localOutput[offset + 2]; const w = localOutput[offset + 3];
        localOutput[offset] = x;
        localOutput[offset + 1] = walkCosine * y - walkSine * z + translateY * w;
        localOutput[offset + 2] = walkSine * y + walkCosine * z + translateZ * w;
        localOutput[offset + 3] = w;
      }
    }
    if (part === "rightArm" && pose.rightArmYaw !== 0) {
      // The outward half of the action arc pivots around the anatomical
      // shoulder after standard-skin side remapping, then returns through the
      // resting pose during the second half.
      const yawCosine = Math.cos(pose.rightArmYaw);
      const yawSine = Math.sin(pose.rightArmYaw);
      const shoulderX = -armCenter;
      const translateYawX = shoulderX * (1 - yawCosine);
      const translateYawZ = shoulderX * yawSine;
      for (let column = 0; column < 4; column += 1) {
        const offset = column * 4;
        const x = localOutput[offset]; const y = localOutput[offset + 1];
        const z = localOutput[offset + 2]; const w = localOutput[offset + 3];
        localOutput[offset] = yawCosine * x + yawSine * z + translateYawX * w;
        localOutput[offset + 1] = y;
        localOutput[offset + 2] = -yawSine * x + yawCosine * z + translateYawZ * w;
        localOutput[offset + 3] = w;
      }
    }
  }
  if (needsBodyPose) {
    const cosine = Math.cos(pose.bodyPitch);
    const sine = Math.sin(pose.bodyPitch);
    const pivotY = 0.75;
    const translateY = pivotY * (1 - cosine) + pose.bodyYOffset;
    const translateZ = -pivotY * sine + pose.bodyZOffset;
    for (let column = 0; column < 4; column += 1) {
      const offset = column * 4;
      const x = localOutput[offset]; const y = localOutput[offset + 1];
      const z = localOutput[offset + 2]; const w = localOutput[offset + 3];
      output[offset] = x;
      output[offset + 1] = cosine * y - sine * z + translateY * w;
      output[offset + 2] = sine * y + cosine * z + translateZ * w;
      output[offset + 3] = w;
    }
  }
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
