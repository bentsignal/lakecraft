export const PLAYER_KNOCKBACK_COOLDOWN_MS = 450;
export const PLAYER_KNOCKBACK_HORIZONTAL_SPEED = 5;
export const PLAYER_KNOCKBACK_GROUNDED_LIFT = 3.8;
export const PLAYER_KNOCKBACK_AIR_LIFT = 1.25;
const PLAYER_KNOCKBACK_DRAG = 8;
const PLAYER_KNOCKBACK_MAX_HORIZONTAL_SPEED = 6;

export type PlayerKnockbackDecision = "accept" | "duplicate" | "cooldown" | "ineligible" | "invalid";

export interface PlayerKnockbackImpulse {
  x: number;
  y: number;
  z: number;
}

/** Pure eligibility fence shared by local hits and Lakebed-confirmed damage receipts. */
export function decidePlayerKnockback(
  eventId: string,
  nowMs: number,
  readyAtMs: number,
  duplicate: boolean,
  eligible: boolean,
): PlayerKnockbackDecision {
  if (!eligible) return "ineligible";
  if (!eventId || eventId.length > 160 || !Number.isFinite(nowMs) || !Number.isFinite(readyAtMs)) return "invalid";
  if (duplicate) return "duplicate";
  return nowMs + 1e-6 < readyAtMs ? "cooldown" : "accept";
}

/** A bounded, damage-confirmed impulse pointing directly away from the attacker. */
export function resolvePlayerKnockback(
  attackerX: number,
  attackerZ: number,
  playerX: number,
  playerZ: number,
  damage: number,
  grounded: boolean,
): PlayerKnockbackImpulse | null {
  if (![attackerX, attackerZ, playerX, playerZ, damage].every(Number.isFinite) || damage <= 0) return null;
  const dx = playerX - attackerX;
  const dz = playerZ - attackerZ;
  const distance = Math.hypot(dx, dz);
  if (distance < 1e-6) return null;
  const speed = Math.min(PLAYER_KNOCKBACK_MAX_HORIZONTAL_SPEED,
    PLAYER_KNOCKBACK_HORIZONTAL_SPEED + Math.min(10, damage) * 0.08);
  return {
    x: dx / distance * speed,
    y: grounded ? PLAYER_KNOCKBACK_GROUNDED_LIFT : PLAYER_KNOCKBACK_AIR_LIFT,
    z: dz / distance * speed,
  };
}

/** Integrates one collision-bearing horizontal axis and clears it against walls. */
export function stepPlayerKnockbackAxis(
  velocity: number,
  elapsedSeconds: number,
  move: (distance: number) => boolean,
): number {
  const dt = Number.isFinite(elapsedSeconds) ? Math.max(0, Math.min(0.05, elapsedSeconds)) : 0;
  const bounded = Number.isFinite(velocity)
    ? Math.max(-PLAYER_KNOCKBACK_MAX_HORIZONTAL_SPEED, Math.min(PLAYER_KNOCKBACK_MAX_HORIZONTAL_SPEED, velocity))
    : 0;
  if (dt === 0 || Math.abs(bounded) < 0.01) return 0;
  if (move(bounded * dt)) return 0;
  const next = bounded * Math.max(0, 1 - PLAYER_KNOCKBACK_DRAG * dt);
  return Math.abs(next) < 0.01 ? 0 : next;
}
