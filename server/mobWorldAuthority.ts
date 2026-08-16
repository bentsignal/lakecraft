import {
  MOB_MOTION_TICKS_PER_SECOND,
  MOB_MOTION_UNITS_PER_BLOCK,
  createMobMotionState,
  replayMobMotion,
  restoreMobMotionCheckpoint,
  writeMobMotionCheckpoint,
  writeMobMotionPoses,
  isCreeperFuseDue,
  type MobMotionCheckpoint,
  type MobMotionPose,
  type MobMotionState,
  type MobMotionTargetSnapshot,
  type MobMotionWorldSnapshot,
} from "../shared/mobMotionAuthority.ts";
import { creeperExplosionEventId, type CreeperExplosionRequest } from "../shared/creeperExplosion.ts";
import {
  MOB_AUTHORITY_WORLD_SEED_TOKEN,
  validateMobIdentity,
  type MobAuthorityKind,
} from "../shared/mobCombat.ts";
import { MAX_HEALTH } from "../shared/game.ts";
import { mitigatedPlayerDamage } from "../shared/playerCombat.ts";
import * as BS from "../shared/bundleStrings.ts";
import { createDeterministicMobSpawnLayout } from "../shared/mobSpawnLayout.ts";

export const MOB_WORLD_AUTHORITY_KEY = "main";
export const MOB_WORLD_SEED = 7_319;
/**
 * Mob motion is deterministically replayed between persisted checkpoints. A
 * thirty-second cadence keeps the singleton authority useful without spending
 * one mutation per second (600 mutations in a ten-minute session).
 */
export const MOB_WORLD_CHECKPOINT_MS = 30_000;
export const MOB_WORLD_LEASE_MS = 60_000;
/** A bounded ten-minute catch-up avoids silently discarding a throttled lease. */
export const MOB_WORLD_MAX_ADVANCE_TICKS = 6_000;
export const MOB_WORLD_MAX_CHECKPOINT_BYTES = 32_768;
export const MOB_WORLD_MAX_INPUT_BYTES = 16_384;
export const MOB_DAMAGE_CLAIM_MAX_AGE_TICKS = 20;

export interface StoredMobWorldAuthorityRow {
  authorityKey: string;
  ownerUserId: string;
  leaseId: string;
  leaseExpiresAt: string;
  checkpointJson: string;
  inputJson: string;
  checkpointRevision: string;
  checkpointAt: string;
}

export interface MobWorldCheckpointRequest {
  leaseId: string;
  expectedRevision: number;
}

export interface MobDamageClaim {
  operationId: string;
  mobId: string;
  checkpointRevision: number;
  tick: number;
}

export interface MobDamageRequest extends MobDamageClaim {}

export interface CreeperExplosionClaim extends CreeperExplosionRequest {}

export interface MobWorldReplayInput {
  version: 1;
  isNight: boolean;
  targets: MobMotionTargetSnapshot[];
}

const CHECKPOINT_REQUEST_KEYS = ["leaseId", BS.expectedRevision] as const;
const DAMAGE_REQUEST_KEYS = [BS.operationId, "mobId", "checkpointRevision", "tick"] as const;

function exactKeys(record: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(record);
  return keys.length === expected.length && keys.every((key) => expected.includes(key));
}

function parseRecord(rawJson: string, maxBytes = 1_024): Record<string, unknown> | null {
  if (!BS.isString(rawJson) || rawJson.length > maxBytes) return null;
  try {
    const parsed = JSON.parse(rawJson);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export function validateMobWorldCheckpointRequestJson(rawJson: string): MobWorldCheckpointRequest | null {
  const record = parseRecord(rawJson);
  if (!record || !exactKeys(record, CHECKPOINT_REQUEST_KEYS)
    || !BS.isString(record.leaseId) || !/^[A-Za-z0-9_-]{20,64}$/.test(record.leaseId)
    || typeof record.expectedRevision !== "number" || !Number.isSafeInteger(record.expectedRevision)
    || record.expectedRevision < 0) return null;
  return { leaseId: record.leaseId, expectedRevision: record.expectedRevision };
}

export function validateMobDamageRequestJson(rawJson: string): MobDamageRequest | null {
  const record = parseRecord(rawJson);
  if (!record || !exactKeys(record, DAMAGE_REQUEST_KEYS)
    || !BS.isString(record.operationId) || !/^[A-Za-z0-9_-]{16,64}$/.test(record.operationId)
    || !BS.isString(record.mobId)
    || typeof record.checkpointRevision !== "number" || !Number.isSafeInteger(record.checkpointRevision)
    || record.checkpointRevision < 0
    || typeof record.tick !== "number" || !Number.isSafeInteger(record.tick) || record.tick < 0) return null;
  const identity = validateMobIdentity(record.mobId, undefined, MOB_AUTHORITY_WORLD_SEED_TOKEN);
  return identity.ok ? {
    operationId: record.operationId,
    mobId: identity.mobId,
    checkpointRevision: record.checkpointRevision,
    tick: record.tick,
  } : null;
}

export function parseStoredInteger(value: unknown): number | null {
  if (!BS.isString(value) || !/^\d{1,16}$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function parseMobWorldCheckpointJson(rawJson: string): MobMotionState | null {
  if (!BS.isString(rawJson) || rawJson.length > MOB_WORLD_MAX_CHECKPOINT_BYTES) return null;
  try {
    return restoreMobMotionCheckpoint(JSON.parse(rawJson) as MobMotionCheckpoint);
  } catch {
    return null;
  }
}

export function encodeMobWorldCheckpoint(state: Readonly<MobMotionState>): string {
  return JSON.stringify(writeMobMotionCheckpoint(state));
}

export function canonicalMobWorldReplayInput(
  snapshot: Readonly<MobMotionWorldSnapshot>,
): MobWorldReplayInput | null {
  if (snapshot.isNight !== true && snapshot.isNight !== false || !Array.isArray(snapshot.targets)) return null;
  const candidates: MobMotionTargetSnapshot[] = [];
  for (const raw of snapshot.targets) {
    if (!raw || !BS.isString(raw.userId) || !raw.userId || raw.userId.length > 128
      || !Number.isFinite(raw.x) || !Number.isFinite(raw.y) || !Number.isFinite(raw.z)
      || Math.abs(raw.x) > 1_000_000 || Math.abs(raw.y) > 1_000_000 || Math.abs(raw.z) > 1_000_000
      || raw.active === false) continue;
    candidates.push({
      userId: raw.userId,
      x: Math.round(raw.x * MOB_MOTION_UNITS_PER_BLOCK) / MOB_MOTION_UNITS_PER_BLOCK,
      y: Math.round(raw.y * MOB_MOTION_UNITS_PER_BLOCK) / MOB_MOTION_UNITS_PER_BLOCK,
      z: Math.round(raw.z * MOB_MOTION_UNITS_PER_BLOCK) / MOB_MOTION_UNITS_PER_BLOCK,
      active: true,
    });
  }
  candidates.sort((left, right) => (left.userId < right.userId ? -1 : left.userId > right.userId ? 1 : 0)
    || left.x - right.x || left.y - right.y || left.z - right.z);
  const targets: MobMotionTargetSnapshot[] = [];
  for (const candidate of candidates) {
    if (targets.length >= 64) break;
    if (targets.at(-1)?.userId === candidate.userId) continue;
    targets.push(candidate);
  }
  return { version: 1, isNight: snapshot.isNight, targets };
}

export function encodeMobWorldReplayInput(snapshot: Readonly<MobMotionWorldSnapshot>): string | null {
  const canonical = canonicalMobWorldReplayInput(snapshot);
  return canonical ? JSON.stringify(canonical) : null;
}

export function parseMobWorldReplayInputJson(rawJson: string): MobWorldReplayInput | null {
  if (!BS.isString(rawJson) || rawJson.length > MOB_WORLD_MAX_INPUT_BYTES) return null;
  try {
    const raw = JSON.parse(rawJson) as Record<string, unknown>;
    if (!raw || raw.version !== 1 || typeof raw.isNight !== "boolean" || !Array.isArray(raw.targets)) return null;
    return canonicalMobWorldReplayInput({
      isNight: raw.isNight,
      targets: raw.targets as MobMotionTargetSnapshot[],
    });
  } catch {
    return null;
  }
}

export function canonicalMobSpawnSnapshot(
  terrainHeight: (x: number, z: number) => number,
  isSpawnable: (kind: MobAuthorityKind, x: number, y: number, z: number) => boolean,
): Array<{ mobId: string; kind: MobAuthorityKind; x: number; y: number; z: number; yaw: number }> {
  return createDeterministicMobSpawnLayout({
    seed: MOB_WORLD_SEED,
    radius: 16,
    terrainHeight,
    maxPopulation: 16,
    passivePopulation: 12,
    hostilePopulation: 4,
    spawnClearRadius: 6,
    hardMaxPopulation: 16,
    isSpawnable,
  }).map(({ id, kind, x, y, z, yaw }) => ({ mobId: id, kind, x, y, z, yaw }));
}

export function createCanonicalMobWorldState(
  epoch: number,
  terrainHeight: (x: number, z: number) => number,
  isSpawnable: (kind: MobAuthorityKind, x: number, y: number, z: number) => boolean,
): MobMotionState | null {
  return createMobMotionState({ seed: MOB_WORLD_SEED, epoch, snapshot: canonicalMobSpawnSnapshot(terrainHeight, isSpawnable) });
}

export function advanceMobWorldState(
  stored: StoredMobWorldAuthorityRow,
  serverNow: number,
  snapshot: Readonly<MobMotionWorldSnapshot>,
): { state: MobMotionState; ticks: number; checkpointAt: number; revision: number } | null {
  const state = parseMobWorldCheckpointJson(stored.checkpointJson);
  const checkpointAt = parseStoredInteger(stored.checkpointAt);
  const revision = parseStoredInteger(stored.checkpointRevision);
  if (!state || checkpointAt === null || revision === null || checkpointAt > serverNow + 5_000) return null;
  const ticks = Math.max(0, Math.floor((serverNow - checkpointAt) * MOB_MOTION_TICKS_PER_SECOND / 1_000));
  if (ticks > MOB_WORLD_MAX_ADVANCE_TICKS) return null;
  return replayMobMotion(state, snapshot, ticks) ? { state, ticks, checkpointAt, revision } : null;
}

function hashText(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function attackCadence(kind: MobAuthorityKind): { ticks: number; reach: number; verticalReach: number; damage: number } | null {
  if (kind === "zombie") return { ticks: 10, reach: 1.75, verticalReach: 2.5, damage: 3 };
  if (kind === "skeleton") return { ticks: 16, reach: 12, verticalReach: 4, damage: 2 };
  if (kind === "spider") return { ticks: 10, reach: 1.9, verticalReach: 1.5, damage: 2 };
  // Creeper damage is a separate, one-shot explosion claim. Never turn its
  // fuse into a repeating cadence hit.
  if (kind === "creeper") return null;
  return null;
}

export function dueMobDamageClaim(
  pose: Readonly<MobMotionPose>,
  target: Readonly<MobMotionTargetSnapshot>,
  epoch: number,
  checkpointRevision: number,
  currentTick: number,
): (MobDamageClaim & { damage: number }) | null {
  if (pose.targetUserId !== target.userId) return null;
  const cadence = attackCadence(pose.kind);
  if (!cadence) return null;
  const dx = pose.x - target.x;
  const dz = pose.z - target.z;
  if (Math.hypot(dx, dz) > cadence.reach || Math.abs(pose.y - target.y) > cadence.verticalReach) return null;
  const phase = hashText(pose.mobId) % cadence.ticks;
  const dueTick = currentTick - ((currentTick - phase + cadence.ticks) % cadence.ticks);
  if (dueTick < 0 || currentTick - dueTick > MOB_DAMAGE_CLAIM_MAX_AGE_TICKS) return null;
  // Revision is validation context, not logical event identity: the same due
  // hit may be observed on both sides of a one-second checkpoint boundary.
  const operationId = `mob_${epoch.toString(36)}_${dueTick.toString(36)}_${hashText(`${pose.mobId}:${target.userId}`).toString(36)}`;
  return { operationId, mobId: pose.mobId, checkpointRevision, tick: dueTick, damage: cadence.damage };
}

export function mobDamageClaimsForTarget(
  state: Readonly<MobMotionState>,
  target: Readonly<MobMotionTargetSnapshot>,
  checkpointRevision: number,
): MobDamageClaim[] {
  const claims: MobDamageClaim[] = [];
  for (const pose of writeMobMotionPoses(state)) {
    const claim = dueMobDamageClaim(pose, target, state.epoch, checkpointRevision, state.tick);
    if (claim) claims.push({ operationId: claim.operationId, mobId: claim.mobId, checkpointRevision, tick: claim.tick });
  }
  return claims;
}

export function creeperExplosionClaims(
  state: Readonly<MobMotionState>,
  checkpointRevision: number,
): CreeperExplosionClaim[] {
  const claims: CreeperExplosionClaim[] = [];
  for (const pose of writeMobMotionPoses(state)) {
    if (pose.kind !== "creeper" || !isCreeperFuseDue(pose, state.tick)
      || state.tick - pose.fuseUntilTick > MOB_DAMAGE_CLAIM_MAX_AGE_TICKS) continue;
    const claim = {
      mobId: pose.mobId,
      epoch: state.epoch,
      checkpointRevision,
      fuseStartedTick: pose.fuseStartedTick,
    };
    claims.push({ ...claim, operationId: creeperExplosionEventId(claim) });
  }
  return claims;
}

export function resolveMobDamage(
  state: Readonly<MobMotionState>,
  request: Readonly<MobDamageRequest>,
  target: Readonly<MobMotionTargetSnapshot>,
  checkpointRevision: number,
  health: number,
  armorProtection = 0,
): { ok: true; damage: number; health: number; killed: boolean } | { ok: false; reason: string } {
  if (request.checkpointRevision !== checkpointRevision
    || request.tick > state.tick || state.tick - request.tick > MOB_DAMAGE_CLAIM_MAX_AGE_TICKS) {
    return { ok: false, reason: "stale_claim" };
  }
  const pose = writeMobMotionPoses(state).find((candidate) => candidate.mobId === request.mobId);
  if (!pose) return { ok: false, reason: "unknown_mob" };
  const expected = dueMobDamageClaim(pose, target, state.epoch, checkpointRevision, state.tick);
  if (!expected || expected.operationId !== request.operationId || expected.tick !== request.tick) {
    return { ok: false, reason: "invalid_claim" };
  }
  const damage = mitigatedPlayerDamage(expected.damage, armorProtection);
  const nextHealth = Math.max(0, Math.min(MAX_HEALTH, health) - damage);
  return { ok: true, damage, health: nextHealth, killed: nextHealth === 0 };
}
