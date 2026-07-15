import {
  MAX_MOB_AUTHORITY_SLOTS,
  validateMobIdentity,
  type MobAuthorityKind,
} from "./mobCombat.ts";

/** Ten deterministic authority ticks per second; rendering may interpolate freely. */
export const MOB_MOTION_TICKS_PER_SECOND = 10;
export const MOB_MOTION_UNITS_PER_BLOCK = 1_024;
export const MOB_MOTION_MAX_TARGETS = 64;
export const MOB_MOTION_MAX_REPLAY_TICKS = MOB_MOTION_TICKS_PER_SECOND * 60 * 10;
export const MOB_MOTION_MAX_CHECKPOINT_TICK = MOB_MOTION_TICKS_PER_SECOND * 60 * 60 * 24;
export const MOB_MOTION_COORDINATE_LIMIT_BLOCKS = 1_000_000;
/** Creepers prime for 1.5 seconds at the fixed 10 Hz authority cadence. */
export const CREEPER_FUSE_TICKS = 15;
export const CREEPER_FUSE_START_RANGE_BLOCKS = 3;
export const CREEPER_FUSE_CANCEL_RANGE_BLOCKS = 7;
export const CREEPER_FUSE_VERTICAL_RANGE_BLOCKS = 3;

const MAX_TARGET_ID_LENGTH = 128;
const CHASE_RANGE_UNITS = 16 * MOB_MOTION_UNITS_PER_BLOCK;
const HOME_RANGE_UNITS = 8 * MOB_MOTION_UNITS_PER_BLOCK;
const MAX_HOME_RANGE_UNITS = 24 * MOB_MOTION_UNITS_PER_BLOCK;
const DIRECTION_SCALE = 1_024;

export type MobMotionBehavior = "dormant" | "idle" | "wander" | "chase" | "fuse";

export interface MobMotionSpawnSnapshot {
  mobId: string;
  kind: MobAuthorityKind;
  x: number;
  y: number;
  z: number;
  yaw?: number;
}

export interface MobMotionTargetSnapshot {
  userId: string;
  x: number;
  y: number;
  z: number;
  active?: boolean;
}

export interface MobMotionWorldSnapshot {
  isNight: boolean;
  targets: readonly MobMotionTargetSnapshot[];
}

export interface MobMotionMobState {
  mobId: string;
  kind: MobAuthorityKind;
  x: number;
  y: number;
  z: number;
  homeX: number;
  homeZ: number;
  yaw: number;
  behavior: MobMotionBehavior;
  behaviorUntilTick: number;
  directionX: number;
  directionZ: number;
  randomState: number;
  targetUserId: string;
  /** Zero when unprimed. A primed creeper retains these exact replay ticks. */
  fuseStartedTick: number;
  fuseUntilTick: number;
}

export interface MobMotionState {
  version: 1;
  seed: number;
  epoch: number;
  tick: number;
  mobs: MobMotionMobState[];
}

export interface MobMotionCheckpoint {
  version: 1;
  seed: number;
  epoch: number;
  tick: number;
  mobs: MobMotionMobState[];
}

export interface MobMotionPose {
  mobId: string;
  kind: MobAuthorityKind;
  x: number;
  y: number;
  z: number;
  yaw: number;
  behavior: MobMotionBehavior;
  targetUserId: string;
  fuseStartedTick: number;
  fuseUntilTick: number;
  fuseProgress: number;
}

type FixedTarget = {
  userId: string;
  x: number;
  y: number;
  z: number;
};

type MotionDefinition = Readonly<{
  passive: boolean;
  moveUnitsPerTick: number;
  chaseUnitsPerTick: number;
}>;

const MOTION_DEFINITIONS: Readonly<Record<MobAuthorityKind, MotionDefinition>> = Object.freeze({
  pig: Object.freeze({ passive: true, moveUnitsPerTick: 118, chaseUnitsPerTick: 118 }),
  cow: Object.freeze({ passive: true, moveUnitsPerTick: 102, chaseUnitsPerTick: 102 }),
  sheep: Object.freeze({ passive: true, moveUnitsPerTick: 108, chaseUnitsPerTick: 108 }),
  // Keep two 10 Hz snapshots below the multiplayer 0.25-block agreement
  // budget even when two clients' 5 Hz query phases land on adjacent pairs.
  zombie: Object.freeze({ passive: false, moveUnitsPerTick: 92, chaseUnitsPerTick: 120 }),
  skeleton: Object.freeze({ passive: false, moveUnitsPerTick: 84, chaseUnitsPerTick: 118 }),
  creeper: Object.freeze({ passive: false, moveUnitsPerTick: 86, chaseUnitsPerTick: 112 }),
  // Two adjacent 10 Hz poses remain under the multiplayer 0.25-block budget.
  spider: Object.freeze({ passive: false, moveUnitsPerTick: 104, chaseUnitsPerTick: 124 }),
});

/** Integer unit vectors avoid trigonometric drift in seeded wander decisions. */
const DIRECTIONS: readonly (readonly [number, number])[] = Object.freeze([
  Object.freeze([0, 1_024]), Object.freeze([392, 946]), Object.freeze([724, 724]), Object.freeze([946, 392]),
  Object.freeze([1_024, 0]), Object.freeze([946, -392]), Object.freeze([724, -724]), Object.freeze([392, -946]),
  Object.freeze([0, -1_024]), Object.freeze([-392, -946]), Object.freeze([-724, -724]), Object.freeze([-946, -392]),
  Object.freeze([-1_024, 0]), Object.freeze([-946, 392]), Object.freeze([-724, 724]), Object.freeze([-392, 946]),
]);

function uint32(value: number): number {
  return value >>> 0;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function hashString(value: string, initial = 0x811c9dc5): number {
  let hash = uint32(initial);
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return uint32(hash);
}

function nextRandomUint(state: MobMotionMobState): number {
  let value = state.randomState | 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  state.randomState = uint32(value) || 0x6d2b79f5;
  return state.randomState;
}

function safeSeed(value: number): number | null {
  return Number.isInteger(value) && value >= 0 && value <= 0xffff_ffff ? uint32(value) : null;
}

function safeEpoch(value: number): number | null {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function coordinateUnits(value: number): number | null {
  if (!Number.isFinite(value) || Math.abs(value) > MOB_MOTION_COORDINATE_LIMIT_BLOCKS) return null;
  const units = Math.round(value * MOB_MOTION_UNITS_PER_BLOCK);
  return Number.isSafeInteger(units) ? units : null;
}

function yawUnits(value: number | undefined): number | null {
  if (value === undefined) return 0;
  if (!Number.isFinite(value)) return null;
  const units = Math.round(value * 1_000_000);
  return Number.isSafeInteger(units) && Math.abs(units) <= 10_000_000 ? units : null;
}

function behavior(value: unknown): value is MobMotionBehavior {
  return value === "dormant" || value === "idle" || value === "wander" || value === "chase" || value === "fuse";
}

function boundedInteger(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function canonicalSpawn(
  raw: Readonly<MobMotionSpawnSnapshot>,
  seedToken: string,
  seed: number,
  epoch: number,
): MobMotionMobState | null {
  const identity = validateMobIdentity(raw.mobId, raw.kind, seedToken);
  if (!identity.ok) return null;
  const x = coordinateUnits(raw.x);
  const y = coordinateUnits(raw.y);
  const z = coordinateUnits(raw.z);
  const yaw = yawUnits(raw.yaw);
  if (x === null || y === null || z === null || yaw === null) return null;
  const randomState = hashString(`${seed}:${epoch}:${identity.mobId}`) || 0x6d2b79f5;
  return {
    mobId: identity.mobId,
    kind: identity.kind,
    x,
    y,
    z,
    homeX: x,
    homeZ: z,
    yaw,
    behavior: MOTION_DEFINITIONS[identity.kind].passive ? "idle" : "dormant",
    behaviorUntilTick: 0,
    directionX: 0,
    directionZ: 0,
    randomState,
    targetUserId: "",
    fuseStartedTick: 0,
    fuseUntilTick: 0,
  };
}

function cancelCreeperFuse(mob: MobMotionMobState): void {
  mob.fuseStartedTick = 0;
  mob.fuseUntilTick = 0;
  if (mob.behavior === "fuse") mob.behavior = "chase";
}

function startCreeperFuse(mob: MobMotionMobState, tick: number): void {
  mob.behavior = "fuse";
  mob.behaviorUntilTick = tick + CREEPER_FUSE_TICKS;
  mob.directionX = 0;
  mob.directionZ = 0;
  mob.fuseStartedTick = tick;
  mob.fuseUntilTick = tick + CREEPER_FUSE_TICKS;
}

/** A completed fuse is latched until the future exact-once explosion claim consumes it. */
export function isCreeperFuseDue(
  mob: Readonly<Pick<MobMotionMobState, "kind" | "fuseStartedTick" | "fuseUntilTick">>,
  tick: number,
): boolean {
  return mob.kind === "creeper" && mob.fuseStartedTick > 0
    && mob.fuseUntilTick > mob.fuseStartedTick && tick >= mob.fuseUntilTick;
}

/**
 * Builds a canonical bounded epoch state. Mob input order is irrelevant; IDs
 * must match the seed-derived deterministic population namespace.
 */
export function createMobMotionState(input: Readonly<{
  seed: number;
  epoch: number;
  snapshot: readonly MobMotionSpawnSnapshot[];
}>): MobMotionState | null {
  const seed = safeSeed(input.seed);
  const epoch = safeEpoch(input.epoch);
  if (seed === null || epoch === null || !Array.isArray(input.snapshot)
    || input.snapshot.length > MAX_MOB_AUTHORITY_SLOTS) return null;
  const seedToken = seed.toString(36);
  const mobs: MobMotionMobState[] = [];
  const ids = new Set<string>();
  for (const raw of input.snapshot) {
    const mob = canonicalSpawn(raw, seedToken, seed, epoch);
    if (!mob || ids.has(mob.mobId)) return null;
    ids.add(mob.mobId);
    mobs.push(mob);
  }
  mobs.sort((left, right) => compareText(left.mobId, right.mobId));
  return { version: 1, seed, epoch, tick: 0, mobs };
}

function canonicalTargets(rawTargets: readonly MobMotionTargetSnapshot[]): FixedTarget[] {
  const candidates: FixedTarget[] = [];
  for (let index = 0; index < rawTargets.length; index += 1) {
    const raw = rawTargets[index];
    if (raw.active === false || typeof raw.userId !== "string" || !raw.userId
      || raw.userId.length > MAX_TARGET_ID_LENGTH) continue;
    const x = coordinateUnits(raw.x);
    const y = coordinateUnits(raw.y);
    const z = coordinateUnits(raw.z);
    if (x === null || y === null || z === null) continue;
    candidates.push({ userId: raw.userId, x, y, z });
  }
  candidates.sort((left, right) => compareText(left.userId, right.userId)
    || left.x - right.x || left.y - right.y || left.z - right.z);
  const targets: FixedTarget[] = [];
  let previousId = "";
  for (let index = 0; index < candidates.length && targets.length < MOB_MOTION_MAX_TARGETS; index += 1) {
    if (candidates[index].userId === previousId) continue;
    previousId = candidates[index].userId;
    targets.push(candidates[index]);
  }
  return targets;
}

/** Stable nearest-target selection: squared distance, then canonical user ID. */
function selectTarget(mob: Readonly<MobMotionMobState>, targets: readonly FixedTarget[]): FixedTarget | null {
  let selected: FixedTarget | null = null;
  let selectedDistance = Number.MAX_SAFE_INTEGER;
  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index];
    const dx = target.x - mob.x;
    const dz = target.z - mob.z;
    if (Math.abs(dx) > CHASE_RANGE_UNITS || Math.abs(dz) > CHASE_RANGE_UNITS) continue;
    const distance = dx * dx + dz * dz;
    if (distance > CHASE_RANGE_UNITS * CHASE_RANGE_UNITS) continue;
    if (distance < selectedDistance
      || (distance === selectedDistance && selected !== null && target.userId < selected.userId)) {
      selected = target;
      selectedDistance = distance;
    }
  }
  return selected;
}

/** Public target oracle used by server validation and deterministic tests. */
export function selectMobMotionTarget(
  mob: Readonly<MobMotionMobState>,
  targets: readonly MobMotionTargetSnapshot[],
): string | null {
  return selectTarget(mob, canonicalTargets(targets))?.userId ?? null;
}

function setDirectionToward(mob: MobMotionMobState, dx: number, dz: number, multiplier = 1): void {
  const distanceSquared = dx * dx + dz * dz;
  if (distanceSquared <= 0) {
    mob.directionX = 0;
    mob.directionZ = 0;
    return;
  }
  const distance = Math.sqrt(distanceSquared);
  mob.directionX = Math.round(dx * DIRECTION_SCALE / distance) * multiplier;
  mob.directionZ = Math.round(dz * DIRECTION_SCALE / distance) * multiplier;
}

function chooseWander(mob: MobMotionMobState, tick: number): void {
  const decision = nextRandomUint(mob);
  if (decision % 100 < 42) {
    mob.behavior = "idle";
    mob.directionX = 0;
    mob.directionZ = 0;
    mob.behaviorUntilTick = tick + 8 + (nextRandomUint(mob) % 27);
    return;
  }
  const direction = DIRECTIONS[nextRandomUint(mob) % DIRECTIONS.length];
  mob.behavior = "wander";
  mob.directionX = direction[0];
  mob.directionZ = direction[1];
  mob.behaviorUntilTick = tick + 14 + (nextRandomUint(mob) % 39);
}

function moveMob(mob: MobMotionMobState, unitsPerTick: number): void {
  const dx = Math.round(mob.directionX * unitsPerTick / DIRECTION_SCALE);
  const dz = Math.round(mob.directionZ * unitsPerTick / DIRECTION_SCALE);
  const minimumX = Math.max(
    -MOB_MOTION_COORDINATE_LIMIT_BLOCKS * MOB_MOTION_UNITS_PER_BLOCK,
    mob.homeX - MAX_HOME_RANGE_UNITS,
  );
  const maximumX = Math.min(
    MOB_MOTION_COORDINATE_LIMIT_BLOCKS * MOB_MOTION_UNITS_PER_BLOCK,
    mob.homeX + MAX_HOME_RANGE_UNITS,
  );
  const minimumZ = Math.max(
    -MOB_MOTION_COORDINATE_LIMIT_BLOCKS * MOB_MOTION_UNITS_PER_BLOCK,
    mob.homeZ - MAX_HOME_RANGE_UNITS,
  );
  const maximumZ = Math.min(
    MOB_MOTION_COORDINATE_LIMIT_BLOCKS * MOB_MOTION_UNITS_PER_BLOCK,
    mob.homeZ + MAX_HOME_RANGE_UNITS,
  );
  mob.x = Math.max(minimumX, Math.min(maximumX, mob.x + dx));
  mob.z = Math.max(minimumZ, Math.min(maximumZ, mob.z + dz));
  if (dx !== 0 || dz !== 0) mob.yaw = Math.round(Math.atan2(dx, dz) * 1_000_000);
}

/** Advances exactly one fixed authority tick in place. */
export function stepMobMotion(state: MobMotionState, snapshot: Readonly<MobMotionWorldSnapshot>): MobMotionState {
  if (state.tick >= MOB_MOTION_MAX_CHECKPOINT_TICK) return state;
  const targets = canonicalTargets(Array.isArray(snapshot.targets) ? snapshot.targets : []);
  state.tick += 1;
  for (let index = 0; index < state.mobs.length; index += 1) {
    const mob = state.mobs[index];
    const definition = MOTION_DEFINITIONS[mob.kind];
    if (isCreeperFuseDue(mob, state.tick)) {
      mob.behavior = "fuse";
      mob.directionX = 0;
      mob.directionZ = 0;
      continue;
    }
    mob.targetUserId = "";
    if (!definition.passive && snapshot.isNight !== true) {
      if (mob.kind === "creeper") cancelCreeperFuse(mob);
      mob.behavior = "dormant";
      mob.directionX = 0;
      mob.directionZ = 0;
      continue;
    }

    const target = !definition.passive ? selectTarget(mob, targets) : null;
    let speed = definition.moveUnitsPerTick;
    if (target) {
      mob.targetUserId = target.userId;
      const dx = target.x - mob.x;
      const dz = target.z - mob.z;
      const distanceSquared = dx * dx + dz * dz;
      const distance = Math.sqrt(distanceSquared);
      if (mob.kind === "creeper") {
        const verticalDistance = Math.abs(target.y - mob.y);
        const fuseActive = mob.fuseStartedTick > 0 && mob.fuseUntilTick > mob.fuseStartedTick;
        if (fuseActive && (distance > CREEPER_FUSE_CANCEL_RANGE_BLOCKS * MOB_MOTION_UNITS_PER_BLOCK
          || verticalDistance > CREEPER_FUSE_VERTICAL_RANGE_BLOCKS * MOB_MOTION_UNITS_PER_BLOCK)) {
          cancelCreeperFuse(mob);
        }
        if (mob.fuseStartedTick > 0) {
          mob.behavior = "fuse";
          mob.directionX = 0;
          mob.directionZ = 0;
          mob.behaviorUntilTick = mob.fuseUntilTick;
          continue;
        }
        if (distance <= CREEPER_FUSE_START_RANGE_BLOCKS * MOB_MOTION_UNITS_PER_BLOCK
          && verticalDistance <= CREEPER_FUSE_VERTICAL_RANGE_BLOCKS * MOB_MOTION_UNITS_PER_BLOCK) {
          startCreeperFuse(mob, state.tick);
          continue;
        }
        setDirectionToward(mob, dx, dz);
        speed = definition.chaseUnitsPerTick;
      } else if (mob.kind === "skeleton" && distance < 5 * MOB_MOTION_UNITS_PER_BLOCK) {
        setDirectionToward(mob, dx, dz, -1);
      } else if (mob.kind === "skeleton" && distance <= 10 * MOB_MOTION_UNITS_PER_BLOCK) {
        const side = (mob.randomState & 1) === 0 ? 1 : -1;
        setDirectionToward(mob, dz * side, -dx * side);
        speed = definition.moveUnitsPerTick;
      } else {
        setDirectionToward(mob, dx, dz);
        speed = definition.chaseUnitsPerTick;
      }
      mob.behavior = "chase";
      mob.behaviorUntilTick = state.tick + 2;
    } else {
      if (mob.kind === "creeper") cancelCreeperFuse(mob);
      if (mob.behavior === "chase") mob.behaviorUntilTick = state.tick;
      if (state.tick >= mob.behaviorUntilTick || mob.behavior === "dormant") chooseWander(mob, state.tick);
      if (mob.behavior === "wander") {
        const homeDx = mob.homeX - mob.x;
        const homeDz = mob.homeZ - mob.z;
        if (Math.abs(homeDx) > HOME_RANGE_UNITS || Math.abs(homeDz) > HOME_RANGE_UNITS
          || homeDx * homeDx + homeDz * homeDz > HOME_RANGE_UNITS * HOME_RANGE_UNITS) {
          setDirectionToward(mob, homeDx, homeDz);
        }
      }
    }
    if (mob.behavior === "wander" || mob.behavior === "chase") moveMob(mob, speed);
  }
  return state;
}

/** Replays a bounded number of ticks from one immutable target/night snapshot. */
export function replayMobMotion(
  state: MobMotionState,
  snapshot: Readonly<MobMotionWorldSnapshot>,
  rawTicks: number,
): MobMotionState | null {
  if (!Number.isInteger(rawTicks) || rawTicks < 0 || rawTicks > MOB_MOTION_MAX_REPLAY_TICKS
    || state.tick + rawTicks > MOB_MOTION_MAX_CHECKPOINT_TICK) return null;
  for (let tick = 0; tick < rawTicks; tick += 1) stepMobMotion(state, snapshot);
  return state;
}

export function writeMobMotionCheckpoint(state: Readonly<MobMotionState>): MobMotionCheckpoint {
  return {
    version: 1,
    seed: state.seed,
    epoch: state.epoch,
    tick: state.tick,
    mobs: state.mobs.map((mob) => ({ ...mob })),
  };
}

function validCheckpointMob(raw: Readonly<MobMotionMobState>, seedToken: string): boolean {
  const identity = validateMobIdentity(raw.mobId, raw.kind, seedToken);
  const coordinateLimit = MOB_MOTION_COORDINATE_LIMIT_BLOCKS * MOB_MOTION_UNITS_PER_BLOCK;
  return identity.ok
    && boundedInteger(raw.x, -coordinateLimit, coordinateLimit)
    && boundedInteger(raw.y, -coordinateLimit, coordinateLimit)
    && boundedInteger(raw.z, -coordinateLimit, coordinateLimit)
    && boundedInteger(raw.homeX, -coordinateLimit, coordinateLimit)
    && boundedInteger(raw.homeZ, -coordinateLimit, coordinateLimit)
    && Math.abs(raw.x - raw.homeX) <= MAX_HOME_RANGE_UNITS
    && Math.abs(raw.z - raw.homeZ) <= MAX_HOME_RANGE_UNITS
    && boundedInteger(raw.yaw, -10_000_000, 10_000_000)
    && behavior(raw.behavior)
    && boundedInteger(raw.behaviorUntilTick, 0, MOB_MOTION_MAX_CHECKPOINT_TICK + 64)
    && boundedInteger(raw.directionX, -DIRECTION_SCALE, DIRECTION_SCALE)
    && boundedInteger(raw.directionZ, -DIRECTION_SCALE, DIRECTION_SCALE)
    && boundedInteger(raw.randomState, 1, 0xffff_ffff)
    && typeof raw.targetUserId === "string"
    && raw.targetUserId.length <= MAX_TARGET_ID_LENGTH
    && boundedInteger(raw.fuseStartedTick, 0, MOB_MOTION_MAX_CHECKPOINT_TICK)
    && boundedInteger(raw.fuseUntilTick, 0, MOB_MOTION_MAX_CHECKPOINT_TICK + CREEPER_FUSE_TICKS)
    && (identity.kind === "creeper"
      ? (raw.fuseStartedTick === 0 && raw.fuseUntilTick === 0)
        || raw.fuseUntilTick === raw.fuseStartedTick + CREEPER_FUSE_TICKS
      : raw.fuseStartedTick === 0 && raw.fuseUntilTick === 0);
}

/** Reconstructs byte-identical fixed-point state from a persisted checkpoint. */
export function restoreMobMotionCheckpoint(raw: Readonly<MobMotionCheckpoint>): MobMotionState | null {
  const seed = safeSeed(raw.seed);
  const epoch = safeEpoch(raw.epoch);
  if (raw.version !== 1 || seed === null || epoch === null
    || !boundedInteger(raw.tick, 0, MOB_MOTION_MAX_CHECKPOINT_TICK)
    || !Array.isArray(raw.mobs) || raw.mobs.length > MAX_MOB_AUTHORITY_SLOTS) return null;
  const seedToken = seed.toString(36);
  const mobs: MobMotionMobState[] = [];
  const ids = new Set<string>();
  for (const rawMob of raw.mobs) {
    if (!validCheckpointMob(rawMob, seedToken) || ids.has(rawMob.mobId)) return null;
    ids.add(rawMob.mobId);
    mobs.push({ ...rawMob });
  }
  mobs.sort((left, right) => compareText(left.mobId, right.mobId));
  return { version: 1, seed, epoch, tick: raw.tick, mobs };
}

/** Canonical checkpoint bytes: fixed key order and integer-only motion fields. */
export function serializeMobMotionCheckpoint(checkpoint: Readonly<MobMotionCheckpoint>): string {
  const mobs = checkpoint.mobs.slice().sort((left, right) => compareText(left.mobId, right.mobId));
  return JSON.stringify({
    version: checkpoint.version,
    seed: checkpoint.seed,
    epoch: checkpoint.epoch,
    tick: checkpoint.tick,
    mobs: mobs.map((mob) => [
      mob.mobId,
      mob.kind,
      mob.x,
      mob.y,
      mob.z,
      mob.homeX,
      mob.homeZ,
      mob.yaw,
      mob.behavior,
      mob.behaviorUntilTick,
      mob.directionX,
      mob.directionZ,
      mob.randomState,
      mob.targetUserId,
      mob.fuseStartedTick,
      mob.fuseUntilTick,
    ]),
  });
}

/** Two independent 32-bit hashes give a compact deterministic replay token. */
export function hashMobMotionCheckpoint(checkpoint: Readonly<MobMotionCheckpoint>): string {
  const bytes = serializeMobMotionCheckpoint(checkpoint);
  const left = hashString(bytes, 0x811c9dc5).toString(16).padStart(8, "0");
  const right = hashString(bytes, 0x9e3779b9).toString(16).padStart(8, "0");
  return `${left}${right}`;
}

export function writeMobMotionPoses(
  state: Readonly<MobMotionState>,
  output: MobMotionPose[] = [],
): MobMotionPose[] {
  for (let index = 0; index < state.mobs.length; index += 1) {
    const mob = state.mobs[index];
    output[index] = {
      mobId: mob.mobId,
      kind: mob.kind,
      x: mob.x / MOB_MOTION_UNITS_PER_BLOCK,
      y: mob.y / MOB_MOTION_UNITS_PER_BLOCK,
      z: mob.z / MOB_MOTION_UNITS_PER_BLOCK,
      yaw: mob.yaw / 1_000_000,
      behavior: mob.behavior,
      targetUserId: mob.targetUserId,
      fuseStartedTick: mob.fuseStartedTick,
      fuseUntilTick: mob.fuseUntilTick,
      fuseProgress: mob.fuseStartedTick > 0
        ? Math.max(0, Math.min(1, (state.tick - mob.fuseStartedTick) / CREEPER_FUSE_TICKS))
        : 0,
    };
  }
  output.length = state.mobs.length;
  return output;
}
