import { MAX_HEALTH } from "./game.ts";
import { PRESENCE_MAX_Y, PRESENCE_MIN_Y } from "./presenceMotion.ts";

export const FALL_DAMAGE_SAFE_DISTANCE = 3;

/** Compact fields stored beside the last accepted presence pose. */
export type StoredAuthoritativeFallState = {
  grounded: boolean;
  fallPeakY: string;
};

/**
 * This transition is evaluated only after the caller has accepted the pose's
 * session, sequence, rate and trajectory. Support and ladder contact are
 * server-resolved facts; they are never client claims.
 */
export type AcceptedAuthoritativeFallTransition = {
  state?: StoredAuthoritativeFallState | null;
  previousY: unknown;
  nextY: unknown;
  supported: unknown;
  onLadder: unknown;
  relocated: unknown;
  /** Conservative server decision for an unobserved sparse supported-to-supported drop. */
  directDrop: unknown;
  health: unknown;
  revision: unknown;
};

export type AuthoritativeFallFailureReason =
  | "invalid_height"
  | "invalid_flags"
  | "invalid_state"
  | "invalid_combat"
  | "revision_exhausted";

export type AuthoritativeFallResult =
  | { ok: false; reason: AuthoritativeFallFailureReason }
  | {
      ok: true;
      state: StoredAuthoritativeFallState;
      health: number;
      revision: number;
      damage: number;
      fallDistance: number;
      landed: boolean;
      reset: "ladder" | "relocation" | null;
      killed: boolean;
      healthChanged: boolean;
    };

const STORED_HEIGHT_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:e[+-]?\d+)?$/i;

function validHeight(value: unknown): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && value >= PRESENCE_MIN_Y
    && value <= PRESENCE_MAX_Y;
}

function parseStoredHeight(value: unknown): number | null {
  if (typeof value !== "string" || value.length < 1 || value.length > 32
    || !STORED_HEIGHT_PATTERN.test(value)) return null;
  const parsed = Number(value);
  return validHeight(parsed) ? parsed : null;
}

function canonicalHeight(value: number): string {
  return String(Object.is(value, -0) ? 0 : value);
}

/** Safe initializer for spawn, respawn and an authorized relocation grant. */
export function resetAuthoritativeFallState(y: unknown): StoredAuthoritativeFallState | null {
  return validHeight(y) ? { grounded: true, fallPeakY: canonicalHeight(y) } : null;
}

function parseCombat(health: unknown, revision: unknown): { health: number; revision: number } | null {
  return typeof health === "number"
    && Number.isSafeInteger(health)
    && health >= 0
    && health <= MAX_HEALTH
    && typeof revision === "number"
    && Number.isSafeInteger(revision)
    && revision >= 0
    ? { health, revision }
    : null;
}

/** Minecraft-style unarmored landing damage. */
export function fallDamageForDistance(fallDistance: number): number {
  if (!Number.isFinite(fallDistance) || fallDistance <= FALL_DAMAGE_SAFE_DISTANCE) return 0;
  return Math.max(0, Math.ceil(fallDistance - FALL_DAMAGE_SAFE_DISTANCE));
}

/**
 * Advances fall tracking and combat as one pure transaction. A positive
 * landing consumes exactly one combat revision, regardless of damage size.
 * Revision exhaustion fails closed without consuming the landing transition.
 */
export function advanceAuthoritativeFall(
  input: AcceptedAuthoritativeFallTransition,
): AuthoritativeFallResult {
  if (!validHeight(input.previousY) || !validHeight(input.nextY)) {
    return { ok: false, reason: "invalid_height" };
  }
  if (typeof input.supported !== "boolean" || typeof input.onLadder !== "boolean"
    || typeof input.relocated !== "boolean" || typeof input.directDrop !== "boolean") {
    return { ok: false, reason: "invalid_flags" };
  }
  const combat = parseCombat(input.health, input.revision);
  if (!combat) return { ok: false, reason: "invalid_combat" };

  let grounded = true;
  let peakY = input.previousY;
  if (input.state !== null && input.state !== undefined) {
    if (typeof input.state.grounded !== "boolean") return { ok: false, reason: "invalid_state" };
    const storedPeakY = parseStoredHeight(input.state.fallPeakY);
    if (storedPeakY === null) return { ok: false, reason: "invalid_state" };
    grounded = input.state.grounded;
    peakY = storedPeakY;
  }

  const reset = input.relocated ? "relocation" : input.onLadder ? "ladder" : null;
  if (reset !== null) {
    const state = resetAuthoritativeFallState(input.nextY)!;
    return {
      ok: true,
      state,
      health: combat.health,
      revision: combat.revision,
      damage: 0,
      fallDistance: 0,
      landed: false,
      reset,
      killed: combat.health === 0,
      healthChanged: false,
    };
  }

  if (grounded) {
    if (input.supported) {
      const state = resetAuthoritativeFallState(input.nextY)!;
      const fallDistance = input.directDrop ? Math.max(0, input.previousY - input.nextY) : 0;
      const damage = combat.health === 0 ? 0 : fallDamageForDistance(fallDistance);
      if (damage > 0 && combat.revision === Number.MAX_SAFE_INTEGER) {
        return { ok: false, reason: "revision_exhausted" };
      }
      const health = Math.max(0, combat.health - damage);
      return {
        ok: true,
        state,
        health,
        revision: damage > 0 ? combat.revision + 1 : combat.revision,
        damage,
        fallDistance,
        landed: fallDistance > 0,
        reset: null,
        killed: health === 0,
        healthChanged: damage > 0,
      };
    }
    return {
      ok: true,
      state: { grounded: false, fallPeakY: canonicalHeight(Math.max(input.previousY, input.nextY)) },
      health: combat.health,
      revision: combat.revision,
      damage: 0,
      fallDistance: 0,
      landed: false,
      reset: null,
      killed: combat.health === 0,
      healthChanged: false,
    };
  }

  const nextPeakY = Math.max(peakY, input.previousY, input.nextY);
  if (!input.supported) {
    return {
      ok: true,
      state: { grounded: false, fallPeakY: canonicalHeight(nextPeakY) },
      health: combat.health,
      revision: combat.revision,
      damage: 0,
      fallDistance: 0,
      landed: false,
      reset: null,
      killed: combat.health === 0,
      healthChanged: false,
    };
  }

  const fallDistance = Math.max(0, nextPeakY - input.nextY);
  const damage = combat.health === 0 ? 0 : fallDamageForDistance(fallDistance);
  if (damage > 0 && combat.revision === Number.MAX_SAFE_INTEGER) {
    return { ok: false, reason: "revision_exhausted" };
  }
  const health = Math.max(0, combat.health - damage);
  const state = resetAuthoritativeFallState(input.nextY)!;
  return {
    ok: true,
    state,
    health,
    revision: damage > 0 ? combat.revision + 1 : combat.revision,
    damage,
    fallDistance,
    landed: true,
    reset: null,
    killed: health === 0,
    healthChanged: damage > 0,
  };
}
