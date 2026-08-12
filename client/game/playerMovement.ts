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

export interface HeadBobState extends HeadBobOffsets {
  phase: number;
  envelope: number;
  horizontalAmplitude: number;
  verticalAmplitude: number;
}

export interface HeadBobProfile {
  /** Ground distance covered by one complete left/right gait cycle. */
  strideLength: number;
  horizontalAmplitude: number;
  verticalAmplitude: number;
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
export const CREATIVE_FLIGHT_SPEED = 7;
/** Ctrl-flight is deliberately faster than ordinary flight without becoming teleport-like. */
export const CREATIVE_FLIGHT_SPRINT_RATIO = 1.6;
export const CREATIVE_FLIGHT_SPRINT_SPEED = CREATIVE_FLIGHT_SPEED * CREATIVE_FLIGHT_SPRINT_RATIO;
export const CREATIVE_FLIGHT_DOUBLE_TAP_MS = 300;
export const FORWARD_SPRINT_DOUBLE_TAP_MS = 100;

export interface CreativeFlightTapState {
  flying: boolean;
  lastSpaceTapAt: number;
}

export interface ForwardSprintTapState {
  /** Release time of the first W tap; -Infinity means no tap is armed. */
  armedAt: number;
  /** True from the second W press until that press is released. */
  active: boolean;
}

export function createForwardSprintTapState(): ForwardSprintTapState {
  return { armedAt: Number.NEGATIVE_INFINITY, active: false };
}

/**
 * Implements Minecraft-style press/release/press W sprinting. The first W
 * release arms a short window, the second non-repeat press starts sprinting,
 * and releasing that second press stops it without arming an accidental third
 * press.
 */
export function transitionForwardSprintTap(
  state: Readonly<ForwardSprintTapState>,
  now: number,
  pressed: boolean,
  repeat = false,
): ForwardSprintTapState {
  if (repeat || !Number.isFinite(now)) return state as ForwardSprintTapState;
  if (pressed) {
    const elapsed = now - state.armedAt;
    if (!state.active && elapsed >= 0 && elapsed <= FORWARD_SPRINT_DOUBLE_TAP_MS) {
      return { armedAt: Number.NEGATIVE_INFINITY, active: true };
    }
    return state.active || state.armedAt === Number.NEGATIVE_INFINITY
      ? state as ForwardSprintTapState
      : { armedAt: Number.NEGATIVE_INFINITY, active: false };
  }
  return state.active
    ? createForwardSprintTapState()
    : { armedAt: now, active: false };
}

export function createCreativeFlightTapState(): CreativeFlightTapState {
  return { flying: false, lastSpaceTapAt: -Infinity };
}

/** Pointer-lock/modal guards live at the caller; this resolves one physical Space press. */
export function transitionCreativeFlightTap(
  state: Readonly<CreativeFlightTapState>,
  now: number,
  allowed: boolean,
  repeat = false,
): CreativeFlightTapState {
  if (!allowed) return createCreativeFlightTapState();
  if (repeat || !Number.isFinite(now)) return { ...state };
  const elapsed = now - state.lastSpaceTapAt;
  return elapsed >= 0 && elapsed <= CREATIVE_FLIGHT_DOUBLE_TAP_MS
    ? { flying: !state.flying, lastSpaceTapAt: -Infinity }
    : { flying: state.flying, lastSpaceTapAt: now };
}

/** Space and Shift cancel one another and never compound vertical speed. */
export function creativeFlightVerticalVelocity(ascend: boolean, descend: boolean): number {
  if (ascend === descend) return 0;
  return ascend ? CREATIVE_FLIGHT_SPEED : -CREATIVE_FLIGHT_SPEED;
}

/** Resolves normalized horizontal Creative flight; every non-zero direction may accelerate. */
export function resolveCreativeFlightMovement(
  forward: number,
  strafe: number,
  sprintHeld: boolean,
): ResolvedPlayerMovement {
  const normalized = normalizeMovementInput(forward, strafe);
  const accelerated = sprintHeld && normalized.magnitude > 0;
  const mode: PlayerMovementMode = normalized.magnitude === 0 ? "idle" : accelerated ? "sprint" : "walk";
  return {
    ...normalized,
    mode,
    speed: accelerated ? CREATIVE_FLIGHT_SPRINT_SPEED : CREATIVE_FLIGHT_SPEED,
    activityMultiplier: movementActivityMultiplier(mode, normalized.magnitude > 0),
  };
}

export const STANDING_EYE_HEIGHT = PLAYER_STANDING_EYE_HEIGHT;
export const SNEAKING_EYE_HEIGHT = PLAYER_SNEAKING_EYE_HEIGHT;
export const STANDING_BODY_HEIGHT = 1.78;
export const SNEAKING_BODY_HEIGHT = 1.5;
export const DEFAULT_FOV_RADIANS = 90 * Math.PI / 180;
export const SPRINT_FOV_RADIANS = 99 * Math.PI / 180;
const MIN_FOV_RADIANS = 30 * Math.PI / 180;
const MAX_FOV_RADIANS = 110 * Math.PI / 180;

const MOVEMENT_EPSILON = 1e-4;
const FORWARD_SPRINT_THRESHOLD = 0.1;
const DEFAULT_POSTURE_SMOOTHING = 14;
const MAX_SMOOTHING_SECONDS = 0.1;
const HEAD_BOB_SMOOTHING = 10;
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

const WALK_HEAD_BOB: Readonly<HeadBobProfile> = Object.freeze({
  strideLength: 2.7,
  horizontalAmplitude: 0.012,
  verticalAmplitude: 0.02,
});

const SPRINT_HEAD_BOB: Readonly<HeadBobProfile> = Object.freeze({
  strideLength: 3.1,
  horizontalAmplitude: 0.016,
  verticalAmplitude: 0.026,
});

const SNEAK_HEAD_BOB: Readonly<HeadBobProfile> = Object.freeze({
  strideLength: 2.4,
  horizontalAmplitude: 0.005,
  verticalAmplitude: 0.008,
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
  const magnitude = rawMagnitude > 1 ? 1 : rawMagnitude;
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

/** Applies the existing ten-percent sprint widening to any configured base FOV. */
export function movementFovRadians(mode: PlayerMovementMode, baseFovRadians = DEFAULT_FOV_RADIANS): number {
  const base = finiteClamp(baseFovRadians, MIN_FOV_RADIANS, MAX_FOV_RADIANS, DEFAULT_FOV_RADIANS);
  return mode === "sprint" ? base * SPRINT_FOV_RADIANS / DEFAULT_FOV_RADIANS : base;
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

/** Returns the independently tuned ground gait, or null when bob is forbidden. */
export function headBobProfileForMovement(mode: PlayerMovementMode): Readonly<HeadBobProfile> | null {
  if (mode === "sprint") return SPRINT_HEAD_BOB;
  if (mode === "sneak") return SNEAK_HEAD_BOB;
  if (mode === "walk") return WALK_HEAD_BOB;
  return null;
}

export function createHeadBobState(): HeadBobState {
  return {
    x: 0,
    y: 0,
    phase: 0,
    envelope: 0,
    horizontalAmplitude: 0,
    verticalAmplitude: 0,
  };
}

export function resetHeadBob(state: HeadBobState): HeadBobState {
  state.x = 0;
  state.y = 0;
  state.phase = 0;
  state.envelope = 0;
  state.horizontalAmplitude = 0;
  state.verticalAmplitude = 0;
  return state;
}

/**
 * Advances one allocation-free, distance-driven gait sample. Only accepted
 * grounded displacement advances phase. Exponential profile/envelope smoothing
 * keeps start, stop, and posture changes continuous and frame-rate independent.
 */
export function advanceHeadBob(
  state: Readonly<HeadBobState>,
  mode: PlayerMovementMode,
  horizontalDistance: number,
  grounded: boolean,
  deltaSeconds: number,
  motionAllowed = true,
  out: HeadBobState = createHeadBobState(),
): HeadBobState {
  const profile = headBobProfileForMovement(mode);
  const targetProfile = motionAllowed ? profile : null;
  const distance = finiteClamp(horizontalDistance, 0, SPRINT_SPEED * MAX_SMOOTHING_SECONDS);
  const active = motionAllowed && grounded && profile !== null && distance > MOVEMENT_EPSILON;
  let phase = Number.isFinite(state.phase) ? state.phase : 0;
  if (active && profile) {
    phase = (phase + distance * Math.PI * 2 / profile.strideLength) % (Math.PI * 2);
  }
  const envelope = smoothMovementValue(state.envelope, active ? 1 : 0, deltaSeconds, HEAD_BOB_SMOOTHING);
  const horizontalAmplitude = smoothMovementValue(
    state.horizontalAmplitude,
    targetProfile?.horizontalAmplitude ?? 0,
    deltaSeconds,
    HEAD_BOB_SMOOTHING,
  );
  const verticalAmplitude = smoothMovementValue(
    state.verticalAmplitude,
    targetProfile?.verticalAmplitude ?? 0,
    deltaSeconds,
    HEAD_BOB_SMOOTHING,
  );
  out.phase = phase;
  out.envelope = envelope;
  out.horizontalAmplitude = horizontalAmplitude;
  out.verticalAmplitude = verticalAmplitude;
  out.x = envelope ? Math.sin(phase) * horizontalAmplitude * envelope : 0;
  out.y = envelope ? -Math.abs(Math.cos(phase)) * verticalAmplitude * envelope : 0;
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
