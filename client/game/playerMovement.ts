/** Pure movement and first-person camera tuning shared by the voxel engine tests. */

import {
  PLAYER_SNEAKING_EYE_HEIGHT,
  PLAYER_STANDING_EYE_HEIGHT,
} from "../../shared/playerPosture.ts";

export type PlayerMovementMode = "idle" | "walk" | "sprint" | "sneak" | "ladder";

export interface PlayerMovementInput {
  /** Local forward input, where positive values move toward the camera facing. */
  forward: number;
  /** Local strafe input, where positive values move to the right. */
  strafe: number;
  sprintHeld: boolean;
  sneakHeld: boolean;
  onLadder: boolean;
  /** True while W/S/Space/Shift is actively moving the player on a ladder. */
  ladderMotion?: boolean;
  hunger: number;
}

export interface NormalizedMovementInput {
  forward: number;
  strafe: number;
  magnitude: number;
}

export interface ResolvedPlayerMovement extends NormalizedMovementInput {
  mode: PlayerMovementMode;
  speed: number;
  activityMultiplier: number;
}

export interface PlayerPostureTargets {
  eyeHeight: number;
  bodyHeight: number;
  fovRadians: number;
}

export interface HeadBobOffsets {
  x: number;
  y: number;
}

export interface HorizontalMovementDelta {
  x: number;
  z: number;
}

export type PlayerEye = [number, number, number];

export const WALK_SPEED = 4.35;
export const SPRINT_SPEED = 5.6;
export const SNEAK_SPEED = 1.3;
export const SPRINT_HUNGER_THRESHOLD = 6;

export const STANDING_EYE_HEIGHT = PLAYER_STANDING_EYE_HEIGHT;
export const SNEAKING_EYE_HEIGHT = PLAYER_SNEAKING_EYE_HEIGHT;
export const STANDING_BODY_HEIGHT = 1.78;
export const SNEAKING_BODY_HEIGHT = 1.5;
export const DEFAULT_FOV_RADIANS = Math.PI / 3;
export const SPRINT_FOV_RADIANS = 66 * Math.PI / 180;

const MOVEMENT_EPSILON = 1e-4;
const FORWARD_SPRINT_THRESHOLD = 0.1;
const DEFAULT_POSTURE_SMOOTHING = 14;
const MAX_SMOOTHING_SECONDS = 0.1;
export const SNEAK_LEDGE_SEARCH_ITERATIONS = 8;

const IDLE_POSTURE: Readonly<PlayerPostureTargets> = Object.freeze({
  eyeHeight: STANDING_EYE_HEIGHT,
  bodyHeight: STANDING_BODY_HEIGHT,
  fovRadians: DEFAULT_FOV_RADIANS,
});

const SPRINT_POSTURE: Readonly<PlayerPostureTargets> = Object.freeze({
  eyeHeight: STANDING_EYE_HEIGHT,
  bodyHeight: STANDING_BODY_HEIGHT,
  fovRadians: SPRINT_FOV_RADIANS,
});

const SNEAK_POSTURE: Readonly<PlayerPostureTargets> = Object.freeze({
  eyeHeight: SNEAKING_EYE_HEIGHT,
  bodyHeight: SNEAKING_BODY_HEIGHT,
  fovRadians: DEFAULT_FOV_RADIANS,
});

function finiteClamp(value: number, minimum: number, maximum: number, fallback = 0): number {
  return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : fallback));
}

/** Sanitizes digital or analog movement input and prevents diagonal speed gain. */
export function normalizeMovementInput(forward: number, strafe: number): NormalizedMovementInput {
  let safeForward = finiteClamp(forward, -1, 1);
  let safeStrafe = finiteClamp(strafe, -1, 1);
  const rawMagnitude = Math.hypot(safeForward, safeStrafe);
  if (rawMagnitude > 1) {
    safeForward /= rawMagnitude;
    safeStrafe /= rawMagnitude;
  }
  const magnitude = Math.min(1, Math.hypot(safeForward, safeStrafe));
  if (magnitude <= MOVEMENT_EPSILON) {
    return { forward: 0, strafe: 0, magnitude: 0 };
  }
  return { forward: safeForward, strafe: safeStrafe, magnitude };
}

export function movementActivityMultiplier(mode: PlayerMovementMode, moving = mode !== "idle"): number {
  if (!moving) return 0.5;
  switch (mode) {
    case "sprint": return 3;
    case "walk": return 2;
    case "ladder": return 2;
    case "sneak": return 1;
    default: return 0.5;
  }
}

export type SprintControlCode = "ControlLeft" | "ControlRight";
export type SprintControlState = Readonly<{ left: boolean; right: boolean }>;

export const RELEASED_SPRINT_CONTROLS: SprintControlState = Object.freeze({ left: false, right: false });

/** Pure physical-key transition; native repeats are idempotent and keyup always releases its side. */
export function updateSprintControl(
  state: SprintControlState,
  code: SprintControlCode,
  pressed: boolean,
): SprintControlState {
  const left = code === "ControlLeft" ? pressed : state.left;
  const right = code === "ControlRight" ? pressed : state.right;
  return left === state.left && right === state.right ? state : { left, right };
}

export function sprintControlHeld(state: SprintControlState): boolean {
  return state.left || state.right;
}

/**
 * Resolves a stable movement mode from controls and survival state. Sneaking has
 * precedence over sprinting, and sprinting requires Ctrl, forward input, and
 * more than six hunger points.
 */
export function resolvePlayerMovement(input: Readonly<PlayerMovementInput>): ResolvedPlayerMovement {
  const normalized = normalizeMovementInput(input.forward, input.strafe);
  let mode: PlayerMovementMode;
  if (input.onLadder) {
    mode = "ladder";
  } else if (input.sneakHeld) {
    mode = "sneak";
  } else if (normalized.magnitude === 0) {
    mode = "idle";
  } else if (
    input.sprintHeld
    && normalized.forward > FORWARD_SPRINT_THRESHOLD
    && Number.isFinite(input.hunger)
    && input.hunger > SPRINT_HUNGER_THRESHOLD
  ) {
    mode = "sprint";
  } else {
    mode = "walk";
  }

  const speed = mode === "sprint" ? SPRINT_SPEED : mode === "sneak" ? SNEAK_SPEED : WALK_SPEED;
  return {
    ...normalized,
    mode,
    speed,
    activityMultiplier: movementActivityMultiplier(
      mode,
      normalized.magnitude > 0 || (mode === "ladder" && input.ladderMotion === true),
    ),
  };
}

/** Lazily probes standing clearance only on the transition out of sneak. */
export function resolveSneakIntent(
  shiftHeld: boolean,
  previousMode: PlayerMovementMode,
  standingCollides: () => boolean,
): boolean {
  return shiftHeld || (previousMode === "sneak" && standingCollides());
}

/** Converts normalized local input into a deterministic world-space physics step. */
export function writeHorizontalMovementDelta(
  yaw: number,
  movement: Pick<ResolvedPlayerMovement, "forward" | "strafe" | "speed">,
  deltaSeconds: number,
  out: HorizontalMovementDelta = { x: 0, z: 0 },
): HorizontalMovementDelta {
  const safeYaw = Number.isFinite(yaw) ? yaw : 0;
  const safeDelta = finiteClamp(deltaSeconds, 0, MAX_SMOOTHING_SECONDS);
  out.x = (Math.sin(safeYaw) * movement.forward + Math.cos(safeYaw) * movement.strafe)
    * movement.speed * safeDelta;
  out.z = (-Math.cos(safeYaw) * movement.forward + Math.sin(safeYaw) * movement.strafe)
    * movement.speed * safeDelta;
  return out;
}

/** Writes the exact first-person origin for either a visual or an interaction ray. */
export function writePlayerEye(
  feetX: number,
  feetY: number,
  feetZ: number,
  yaw: number,
  eyeHeight: number,
  bob: Readonly<HeadBobOffsets>,
  out: PlayerEye = [0, 0, 0],
): PlayerEye {
  const safeYaw = Number.isFinite(yaw) ? yaw : 0;
  out[0] = feetX + Math.cos(safeYaw) * bob.x;
  out[1] = feetY + eyeHeight + bob.y;
  out[2] = feetZ + Math.sin(safeYaw) * bob.x;
  return out;
}

/** Returns immutable camera/collision targets for the resolved posture. */
export function postureTargetsForMovement(mode: PlayerMovementMode): Readonly<PlayerPostureTargets> {
  if (mode === "sneak") return SNEAK_POSTURE;
  if (mode === "sprint") return SPRINT_POSTURE;
  return IDLE_POSTURE;
}

/**
 * Frame-rate-independent exponential smoothing that never overshoots its target.
 * Invalid inputs fail closed to a finite value suitable for a render loop.
 */
export function smoothMovementValue(
  current: number,
  target: number,
  deltaSeconds: number,
  responsiveness = DEFAULT_POSTURE_SMOOTHING,
): number {
  const safeTarget = Number.isFinite(target) ? target : Number.isFinite(current) ? current : 0;
  const safeCurrent = Number.isFinite(current) ? current : safeTarget;
  const safeDelta = finiteClamp(deltaSeconds, 0, MAX_SMOOTHING_SECONDS);
  const safeResponsiveness = finiteClamp(responsiveness, 0, 60, DEFAULT_POSTURE_SMOOTHING);
  const alpha = 1 - Math.exp(-safeResponsiveness * safeDelta);
  const value = safeCurrent + (safeTarget - safeCurrent) * alpha;
  return safeTarget >= safeCurrent
    ? Math.min(safeTarget, Math.max(safeCurrent, value))
    : Math.max(safeTarget, Math.min(safeCurrent, value));
}

/** Smooths all posture channels into a caller-provided object to avoid frame allocations. */
export function smoothPlayerPosture(
  current: Readonly<PlayerPostureTargets>,
  target: Readonly<PlayerPostureTargets>,
  deltaSeconds: number,
  out: PlayerPostureTargets = { ...current },
): PlayerPostureTargets {
  out.eyeHeight = smoothMovementValue(current.eyeHeight, target.eyeHeight, deltaSeconds);
  out.bodyHeight = smoothMovementValue(current.bodyHeight, target.bodyHeight, deltaSeconds);
  out.fovRadians = smoothMovementValue(current.fovRadians, target.fovRadians, deltaSeconds);
  return out;
}

/**
 * Samples a restrained, distance-driven head bob. Distance instead of wall time
 * keeps the phase stable across frame rates, while fixed amplitudes make the
 * returned camera offsets provably bounded.
 */
export function sampleHeadBob(
  mode: PlayerMovementMode,
  distanceTravelled: number,
  grounded: boolean,
  out: HeadBobOffsets = { x: 0, y: 0 },
): HeadBobOffsets {
  if (!grounded || mode === "idle" || !Number.isFinite(distanceTravelled)) {
    out.x = 0;
    out.y = 0;
    return out;
  }

  let horizontalAmplitude = 0.022;
  let verticalAmplitude = 0.035;
  if (mode === "sprint") {
    horizontalAmplitude = 0.032;
    verticalAmplitude = 0.05;
  } else if (mode === "sneak") {
    horizontalAmplitude = 0.009;
    verticalAmplitude = 0.014;
  } else if (mode === "ladder") {
    horizontalAmplitude = 0.012;
    verticalAmplitude = 0.018;
  }
  const phase = distanceTravelled * Math.PI * 2 / 1.2;
  out.x = Math.sin(phase) * horizontalAmplitude;
  out.y = -Math.abs(Math.cos(phase)) * verticalAmplitude;
  return out;
}

/**
 * Finds the furthest supported fraction of one small horizontal physics step.
 * The callback receives an offset from the current axis position, keeping this
 * helper independent of the terrain representation used by the engine.
 */
export function clampSneakAxisMovement(
  requestedAmount: number,
  hasSupportAtOffset: (offset: number) => boolean,
): number {
  if (!Number.isFinite(requestedAmount) || requestedAmount === 0) return 0;
  if (hasSupportAtOffset(requestedAmount)) return requestedAmount;
  let safeAmount = 0;
  let unsupportedAmount = requestedAmount;
  for (let iteration = 0; iteration < SNEAK_LEDGE_SEARCH_ITERATIONS; iteration += 1) {
    const midpoint = (safeAmount + unsupportedAmount) / 2;
    if (hasSupportAtOffset(midpoint)) safeAmount = midpoint;
    else unsupportedAmount = midpoint;
  }
  return safeAmount;
}
