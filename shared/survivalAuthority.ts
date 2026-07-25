import { MAX_HEALTH, MAX_HUNGER } from "./game.ts";
import { PRESENCE_ACTIVE_LEASE_MS } from "./presenceMotion.ts";

export const SURVIVAL_MAX_STEP_MS = PRESENCE_ACTIVE_LEASE_MS;
export const HUNGER_PROGRESS_HALF_MS_PER_POINT = 90_000;
export const HEALTH_RECOVERY_INTERVAL_MS = 4_000;
export const STARVATION_DAMAGE_INTERVAL_MS = 4_000;
export const STARVATION_HEALTH_FLOOR = 1;

export type StoredSurvivalProgress = {
  survivalAt: string;
  hungerProgressHalfMs: string;
  recoveryProgressMs: string;
  starvationProgressMs: string;
};

export type AuthoritativeSurvivalInput = {
  hunger: number;
  health: number;
  revision: number;
  progress: Partial<StoredSurvivalProgress> | null | undefined;
  serverNow: number;
  activityHalfUnits: number;
};

export type AuthoritativeSurvivalResult = {
  hunger: number;
  health: number;
  revision: number;
  progress: StoredSurvivalProgress;
  hungerLost: number;
  healthRecovered: number;
  starvationDamage: number;
  hungerChanged: boolean;
  healthChanged: boolean;
  revisionExhausted: boolean;
};

function boundedInteger(value: unknown, minimum: number, maximum: number, fallback: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum
    ? value
    : fallback;
}

function storedProgress(value: unknown, maximumExclusive: number): number {
  if (typeof value !== "string" || !/^\d{1,16}$/.test(value)) return 0;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed < maximumExclusive ? parsed : 0;
}

function storedTime(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{1,16}$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function activityHalfUnitsForDisplacement(
  previous: { x: number; y: number; z: number } | null,
  next: { x: number; y: number; z: number },
  elapsedMs: number,
): 1 | 2 | 4 | 6 {
  if (!previous || !Number.isFinite(elapsedMs) || elapsedMs <= 0) return 1;
  const seconds = elapsedMs / 1_000;
  const horizontalSpeed = Math.hypot(next.x - previous.x, next.z - previous.z) / seconds;
  const verticalSpeed = Math.abs(next.y - previous.y) / seconds;
  if (!Number.isFinite(horizontalSpeed) || !Number.isFinite(verticalSpeed)) return 1;
  if (horizontalSpeed > 4.9) return 6;
  if (horizontalSpeed > 1.8 || verticalSpeed > 0.15) return 4;
  if (horizontalSpeed > 0.15) return 2;
  return 1;
}

/**
 * Integer-only survival authority. Call only after session, sequence, rate, and
 * trajectory authorization. Its timers live on the presence row; callers write
 * combat/inventory rows only when the corresponding changed flag is true.
 */
export function advanceAuthoritativeSurvival(input: AuthoritativeSurvivalInput): AuthoritativeSurvivalResult {
  const serverNow = boundedInteger(input.serverNow, 0, Number.MAX_SAFE_INTEGER, 0);
  const previousAt = storedTime(input.progress?.survivalAt);
  const elapsedMs = previousAt !== null && serverNow >= previousAt
    ? Math.min(SURVIVAL_MAX_STEP_MS, serverNow - previousAt)
    : 0;
  const activityHalfUnits = [1, 2, 4, 6].includes(input.activityHalfUnits) ? input.activityHalfUnits : 1;
  const initialHunger = boundedInteger(input.hunger, 0, MAX_HUNGER, MAX_HUNGER);
  const initialHealth = boundedInteger(input.health, 0, MAX_HEALTH, MAX_HEALTH);
  let hunger = initialHunger;
  let health = initialHealth;
  let hungerProgressHalfMs = storedProgress(input.progress?.hungerProgressHalfMs, HUNGER_PROGRESS_HALF_MS_PER_POINT);
  let recoveryProgressMs = storedProgress(input.progress?.recoveryProgressMs, HEALTH_RECOVERY_INTERVAL_MS);
  let starvationProgressMs = storedProgress(input.progress?.starvationProgressMs, STARVATION_DAMAGE_INTERVAL_MS);
  let hungerLost = 0;
  let healthRecovered = 0;
  let starvationDamage = 0;

  if (health === 0) {
    return {
      hunger,
      health,
      revision: boundedInteger(input.revision, 0, Number.MAX_SAFE_INTEGER, 0),
      progress: {
        survivalAt: String(serverNow),
        hungerProgressHalfMs: "0",
        recoveryProgressMs: "0",
        starvationProgressMs: "0",
      },
      hungerLost,
      healthRecovered,
      starvationDamage,
      hungerChanged: false,
      healthChanged: false,
      revisionExhausted: false,
    };
  }

  let remainingMs = elapsedMs;
  // A 90-second lease can cross at most 29 survival boundaries (six maximum-
  // activity hunger drains plus 23 four-second health boundaries). Keep the
  // loop statically bounded for Lakebed's anonymous-server compiler.
  for (let transition = 0; transition < 64 && remainingMs > 0; transition += 1) {
    const recovering = hunger >= 18 && health < MAX_HEALTH;
    const starving = hunger === 0 && health > STARVATION_HEALTH_FLOOR;
    if (!recovering) recoveryProgressMs = 0;
    if (!starving) starvationProgressMs = 0;
    if (hunger === 0) hungerProgressHalfMs = 0;

    const untilHunger = hunger > 0
      ? Math.ceil((HUNGER_PROGRESS_HALF_MS_PER_POINT - hungerProgressHalfMs) / activityHalfUnits)
      : Number.POSITIVE_INFINITY;
    const untilRecovery = recovering
      ? HEALTH_RECOVERY_INTERVAL_MS - recoveryProgressMs
      : Number.POSITIVE_INFINITY;
    const untilStarvation = starving
      ? STARVATION_DAMAGE_INTERVAL_MS - starvationProgressMs
      : Number.POSITIVE_INFINITY;
    const stepMs = Math.min(remainingMs, untilHunger, untilRecovery, untilStarvation);
    if (!Number.isFinite(stepMs) || stepMs <= 0) break;

    if (hunger > 0) hungerProgressHalfMs += stepMs * activityHalfUnits;
    if (recovering) recoveryProgressMs += stepMs;
    if (starving) starvationProgressMs += stepMs;
    remainingMs -= stepMs;

    // Events sharing the same millisecond keep the original rule order:
    // passive hunger first, then post-drain recovery, then starvation.
    if (hunger > 0 && hungerProgressHalfMs >= HUNGER_PROGRESS_HALF_MS_PER_POINT) {
      const passiveLoss = Math.min(hunger, Math.floor(hungerProgressHalfMs / HUNGER_PROGRESS_HALF_MS_PER_POINT));
      hunger -= passiveLoss;
      hungerLost += passiveLoss;
      hungerProgressHalfMs -= passiveLoss * HUNGER_PROGRESS_HALF_MS_PER_POINT;
      if (hunger === 0) hungerProgressHalfMs = 0;
    }
    if (hunger >= 18 && health < MAX_HEALTH && recoveryProgressMs >= HEALTH_RECOVERY_INTERVAL_MS) {
      health += 1;
      healthRecovered += 1;
      hunger -= 1;
      hungerLost += 1;
      recoveryProgressMs -= HEALTH_RECOVERY_INTERVAL_MS;
      if (hunger < 18 || health >= MAX_HEALTH) recoveryProgressMs = 0;
    } else if (hunger < 18 || health >= MAX_HEALTH) {
      recoveryProgressMs = 0;
    }
    if (hunger === 0 && health > STARVATION_HEALTH_FLOOR
      && starvationProgressMs >= STARVATION_DAMAGE_INTERVAL_MS) {
      health -= 1;
      starvationDamage += 1;
      starvationProgressMs -= STARVATION_DAMAGE_INTERVAL_MS;
      if (health <= STARVATION_HEALTH_FLOOR) starvationProgressMs = 0;
    } else if (hunger !== 0 || health <= STARVATION_HEALTH_FLOOR) {
      starvationProgressMs = 0;
    }
  }

  const healthChanged = health !== initialHealth;
  const revision = boundedInteger(input.revision, 0, Number.MAX_SAFE_INTEGER, 0);
  if (healthChanged && revision === Number.MAX_SAFE_INTEGER) {
    return {
      hunger: initialHunger,
      health: initialHealth,
      revision,
      progress: {
        survivalAt: input.progress?.survivalAt ?? "0",
        hungerProgressHalfMs: String(storedProgress(input.progress?.hungerProgressHalfMs, HUNGER_PROGRESS_HALF_MS_PER_POINT)),
        recoveryProgressMs: String(storedProgress(input.progress?.recoveryProgressMs, HEALTH_RECOVERY_INTERVAL_MS)),
        starvationProgressMs: String(storedProgress(input.progress?.starvationProgressMs, STARVATION_DAMAGE_INTERVAL_MS)),
      },
      hungerLost: 0,
      healthRecovered: 0,
      starvationDamage: 0,
      hungerChanged: false,
      healthChanged: false,
      revisionExhausted: true,
    };
  }
  return {
    hunger,
    health,
    revision: healthChanged ? revision + 1 : revision,
    progress: {
      survivalAt: String(serverNow),
      hungerProgressHalfMs: String(hungerProgressHalfMs),
      recoveryProgressMs: String(recoveryProgressMs),
      starvationProgressMs: String(starvationProgressMs),
    },
    hungerLost,
    healthRecovered,
    starvationDamage,
    hungerChanged: hunger !== initialHunger,
    healthChanged,
    revisionExhausted: false,
  };
}
