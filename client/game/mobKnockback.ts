export const MAX_ACTIVE_MOB_KNOCKBACK_REACTIONS = 32;
export const MAX_MOB_KNOCKBACK_RECEIPTS = 64;
export const MOB_KNOCKBACK_MAX_OFFSET = 0.82;

const MOB_KNOCKBACK_BASE_SPEED = 4.8;
const MOB_KNOCKBACK_MAX_SPEED = 6.4;
const MOB_KNOCKBACK_DRAG = 7.5;
const MOB_KNOCKBACK_SPRING = 18;

export interface MobKnockbackImpulse {
  x: number;
  z: number;
}

export interface MobKnockbackReaction {
  offsetX: number;
  offsetZ: number;
  previousOffsetX: number;
  previousOffsetZ: number;
  velocityX: number;
  velocityZ: number;
}

export type MobKnockbackDecision = "accept" | "duplicate" | "ineligible";

export function decideMobKnockback(
  eventId: string,
  duplicate: boolean,
  eligible: boolean,
): MobKnockbackDecision {
  if (typeof eventId !== "string" || !eventId || !eligible) return "ineligible";
  return duplicate ? "duplicate" : "accept";
}

export function createMobKnockbackReaction(): MobKnockbackReaction {
  return {
    offsetX: 0,
    offsetZ: 0,
    previousOffsetX: 0,
    previousOffsetZ: 0,
    velocityX: 0,
    velocityZ: 0,
  };
}

/** Resolves a horizontal impulse away from a confirmed attacker or projectile origin. */
export function resolveMobKnockback(
  sourceX: number,
  sourceZ: number,
  mobX: number,
  mobZ: number,
  fallbackX: number,
  fallbackZ: number,
  damage: number,
): MobKnockbackImpulse | null {
  if (![sourceX, sourceZ, mobX, mobZ, fallbackX, fallbackZ, damage].every(Number.isFinite) || damage <= 0) return null;
  let dx = mobX - sourceX;
  let dz = mobZ - sourceZ;
  let distance = Math.hypot(dx, dz);
  if (distance < 1e-6) {
    dx = fallbackX;
    dz = fallbackZ;
    distance = Math.hypot(dx, dz);
  }
  if (distance < 1e-6) return null;
  const speed = Math.min(MOB_KNOCKBACK_MAX_SPEED, MOB_KNOCKBACK_BASE_SPEED + Math.min(20, damage) * 0.1);
  return { x: dx / distance * speed, z: dz / distance * speed };
}

export function applyMobKnockbackImpulse(
  reaction: MobKnockbackReaction,
  impulse: Readonly<MobKnockbackImpulse>,
): void {
  reaction.velocityX = Math.max(-MOB_KNOCKBACK_MAX_SPEED, Math.min(MOB_KNOCKBACK_MAX_SPEED, impulse.x));
  reaction.velocityZ = Math.max(-MOB_KNOCKBACK_MAX_SPEED, Math.min(MOB_KNOCKBACK_MAX_SPEED, impulse.z));
}

export function beginMobKnockbackStep(reaction: MobKnockbackReaction): void {
  reaction.previousOffsetX = reaction.offsetX;
  reaction.previousOffsetZ = reaction.offsetZ;
}

/** Collision-bearing spring step. The retained offset always recovers to the canonical mob pose. */
export function stepMobKnockbackAxis(
  offset: number,
  velocity: number,
  dtSeconds: number,
  move: (distance: number) => boolean,
): { offset: number; velocity: number } {
  if (!Number.isFinite(offset) || !Number.isFinite(velocity) || !Number.isFinite(dtSeconds)) return { offset: 0, velocity: 0 };
  const dt = Math.max(0, Math.min(0.05, dtSeconds));
  if (dt === 0) return { offset, velocity };
  const nextVelocity = (velocity - offset * MOB_KNOCKBACK_SPRING * dt) * Math.exp(-MOB_KNOCKBACK_DRAG * dt);
  const boundedVelocity = Math.max(-MOB_KNOCKBACK_MAX_SPEED, Math.min(MOB_KNOCKBACK_MAX_SPEED, nextVelocity));
  const requested = Math.max(
    -MOB_KNOCKBACK_MAX_OFFSET - offset,
    Math.min(MOB_KNOCKBACK_MAX_OFFSET - offset, boundedVelocity * dt),
  );
  if (Math.abs(requested) > 1e-7 && move(requested)) return { offset, velocity: 0 };
  const nextOffset = offset + requested;
  if (Math.abs(nextOffset) < 0.002 && Math.abs(boundedVelocity) < 0.03) return { offset: 0, velocity: 0 };
  return { offset: nextOffset, velocity: boundedVelocity };
}

export function mobKnockbackReactionSettled(reaction: Readonly<MobKnockbackReaction>): boolean {
  return reaction.offsetX === 0 && reaction.offsetZ === 0
    && reaction.velocityX === 0 && reaction.velocityZ === 0;
}
