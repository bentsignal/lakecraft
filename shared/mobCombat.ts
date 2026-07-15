export type MobAuthorityKind = "pig" | "cow" | "sheep" | "zombie" | "skeleton" | "creeper" | "spider";
export type MobAuthorityDropId = "pork" | "beef" | "leather" | "wool" | "mutton" | "rotten_flesh" | "stick" | "string" | "arrow" | "bone" | "gunpowder";

export interface MobAuthorityDrop {
  itemId: MobAuthorityDropId;
  count: number;
}

export interface MobAuthorityState {
  mobId: string;
  kind: MobAuthorityKind;
  health: number;
  maxHealth: number;
  revision: number;
  deadUntil: number;
  lastAttackAt: number;
  lastAttackerId: string;
}

export interface MobAttackInventory {
  id: string;
  userId: string;
  inventoryJson: string;
  revision: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredMobAuthorityState {
  mobId: string;
  kind: string;
  health: string;
  revision: string;
  deadUntil: string;
  lastAttackAt: string;
  lastAttackerId: string;
}

export type MobAttackFailureReason = "invalid_mob" | "invalid_damage" | "cooldown" | "dead";

export type MobAttackResolution =
  | {
      ok: true;
      killed: boolean;
      drops: MobAuthorityDrop[];
      state: MobAuthorityState;
      nextRow: StoredMobAuthorityState;
    }
  | {
      ok: false;
      reason: MobAttackFailureReason;
      state?: MobAuthorityState;
      retryAfterMs?: number;
    };

export type MobAttackResult =
  | { ok: true; replayed: boolean; killed: boolean; drops: MobAuthorityDrop[]; state: MobAuthorityState; inventory: MobAttackInventory; serverNow: number }
  | {
      ok: false;
      reason:
        | "authentication_required"
        | "invalid_operation"
        | "operation_id_reused"
        | "invalid_receipt"
        | "active_presence_required"
        | "attacker_dead"
        | "inventory_required"
        | "inventory_invalid"
        | "weapon_mismatch"
        | "authority_unavailable"
        | "out_of_reach"
        | "not_aimed"
        | MobAttackFailureReason;
      state?: MobAuthorityState;
      retryAfterMs?: number;
      serverNow: number;
    };

export type MobAuthorityQueryResult =
  | { ok: true; states: MobAuthorityState[]; serverNow: number }
  | { ok: false; reason: "authentication_required" | "invalid_mob_ids"; states: []; serverNow: number };

type DropDefinition = Readonly<{
  itemId: MobAuthorityDropId;
  minCount: number;
  maxCount: number;
  chance: number;
}>;

type AuthorityDefinition = Readonly<{
  maxHealth: number;
  drops: readonly DropDefinition[];
}>;

export const MAX_MOB_AUTHORITY_QUERY_IDS = 64;
export const MAX_MOB_ATTACK_DAMAGE = 12;
export const MOB_ATTACK_COOLDOWN_MS = 300;
export const MOB_RESPAWN_MS = 30_000;
export const MAX_MOB_ID_LENGTH = 40;
export const MAX_MOB_AUTHORITY_SLOTS = 64;
/** Matches the fixed alpha world seed (7319) used by the deterministic spawner. */
export const MOB_AUTHORITY_WORLD_SEED_TOKEN = "5nb";

export const MOB_AUTHORITY_DEFINITIONS: Readonly<Record<MobAuthorityKind, AuthorityDefinition>> = Object.freeze({
  pig: Object.freeze({
    maxHealth: 10,
    drops: Object.freeze([{ itemId: "pork", minCount: 1, maxCount: 3, chance: 1 }]),
  }),
  cow: Object.freeze({
    maxHealth: 10,
    drops: Object.freeze([
      { itemId: "beef", minCount: 1, maxCount: 3, chance: 1 },
      { itemId: "leather", minCount: 0, maxCount: 2, chance: 0.75 },
    ]),
  }),
  sheep: Object.freeze({
    maxHealth: 8,
    drops: Object.freeze([
      { itemId: "wool", minCount: 1, maxCount: 1, chance: 1 },
      { itemId: "mutton", minCount: 1, maxCount: 2, chance: 1 },
    ]),
  }),
  zombie: Object.freeze({
    maxHealth: 20,
    drops: Object.freeze([{ itemId: "rotten_flesh", minCount: 0, maxCount: 2, chance: 0.85 }]),
  }),
  skeleton: Object.freeze({
    maxHealth: 20,
    drops: Object.freeze([
      { itemId: "arrow", minCount: 0, maxCount: 2, chance: 1 },
      { itemId: "bone", minCount: 0, maxCount: 2, chance: 1 },
    ]),
  }),
  creeper: Object.freeze({
    maxHealth: 20,
    drops: Object.freeze([{ itemId: "gunpowder", minCount: 0, maxCount: 2, chance: 1 }]),
  }),
  spider: Object.freeze({
    maxHealth: 16,
    drops: Object.freeze([{ itemId: "string", minCount: 0, maxCount: 2, chance: 1 }]),
  }),
});

export type MobIdentityValidation =
  | { ok: true; mobId: string; kind: MobAuthorityKind }
  | { ok: false; reason: "invalid_mob" };

export type MobIdListValidation =
  | { ok: true; mobIds: string[] }
  | { ok: false; reason: "invalid_mob_ids" };

function isMobKind(value: string): value is MobAuthorityKind {
  return value === "pig" || value === "cow" || value === "sheep" || value === "zombie"
    || value === "skeleton" || value === "creeper" || value === "spider";
}

export function validateMobIdentity(
  rawMobId: string,
  rawKind?: string,
  requiredSeedToken?: string,
): MobIdentityValidation {
  if (typeof rawMobId !== "string" || rawMobId.length > MAX_MOB_ID_LENGTH) {
    return { ok: false, reason: "invalid_mob" };
  }
  const mobId = rawMobId.trim();
  const match = /^(pig|cow|sheep|zombie|skeleton|creeper|spider)-([0-9a-z]{1,8})-([0-9a-z]{1,3})$/.exec(mobId);
  if (!match || !isMobKind(match[1])) return { ok: false, reason: "invalid_mob" };
  const kind = match[1];
  const slot = Number.parseInt(match[3], 36);
  if (slot >= MAX_MOB_AUTHORITY_SLOTS || (requiredSeedToken !== undefined && match[2] !== requiredSeedToken)) {
    return { ok: false, reason: "invalid_mob" };
  }
  if (rawKind !== undefined && rawKind.trim().toLowerCase() !== kind) {
    return { ok: false, reason: "invalid_mob" };
  }
  return { ok: true, mobId, kind };
}

export function validateMobIdList(rawMobIds: unknown, requiredSeedToken?: string): MobIdListValidation {
  if (!Array.isArray(rawMobIds) || rawMobIds.length > MAX_MOB_AUTHORITY_QUERY_IDS) {
    return { ok: false, reason: "invalid_mob_ids" };
  }
  const unique = new Set<string>();
  for (const rawMobId of rawMobIds) {
    if (typeof rawMobId !== "string") return { ok: false, reason: "invalid_mob_ids" };
    const validation = validateMobIdentity(rawMobId, undefined, requiredSeedToken);
    if (!validation.ok) return { ok: false, reason: "invalid_mob_ids" };
    unique.add(validation.mobId);
  }
  return { ok: true, mobIds: [...unique].sort() };
}

export function validateMobDamage(rawDamage: string | number): number | null {
  const damage = typeof rawDamage === "number" ? rawDamage : Number(rawDamage.trim());
  return Number.isInteger(damage) && damage >= 1 && damage <= MAX_MOB_ATTACK_DAMAGE ? damage : null;
}

export function defaultMobAuthorityState(mobId: string, kind: MobAuthorityKind): MobAuthorityState {
  return {
    mobId,
    kind,
    health: MOB_AUTHORITY_DEFINITIONS[kind].maxHealth,
    maxHealth: MOB_AUTHORITY_DEFINITIONS[kind].maxHealth,
    revision: 0,
    deadUntil: 0,
    lastAttackAt: 0,
    lastAttackerId: "",
  };
}

function storedInteger(value: string, minimum: number, maximum: number, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

/** Materializes expired deaths as alive without requiring background database timers. */
export function materializeMobAuthorityState(
  stored: StoredMobAuthorityState | null | undefined,
  mobId: string,
  kind: MobAuthorityKind,
  serverNow: number,
): MobAuthorityState {
  const fallback = defaultMobAuthorityState(mobId, kind);
  if (!stored || stored.mobId !== mobId || stored.kind !== kind) return fallback;
  const maxHealth = MOB_AUTHORITY_DEFINITIONS[kind].maxHealth;
  const health = storedInteger(stored.health, 0, maxHealth, maxHealth);
  const revision = storedInteger(stored.revision, 0, Number.MAX_SAFE_INTEGER, 0);
  const deadUntil = storedInteger(stored.deadUntil, 0, Number.MAX_SAFE_INTEGER, 0);
  const lastAttackAt = storedInteger(stored.lastAttackAt, 0, Number.MAX_SAFE_INTEGER, 0);
  if (health === 0 && deadUntil <= serverNow) {
    return { ...fallback, revision, lastAttackAt, lastAttackerId: stored.lastAttackerId.slice(0, 128) };
  }
  return {
    mobId,
    kind,
    health,
    maxHealth,
    revision,
    deadUntil: health === 0 ? deadUntil : 0,
    lastAttackAt,
    lastAttackerId: stored.lastAttackerId.slice(0, 128),
  };
}

function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function deterministicMobDrops(
  mobId: string,
  kind: MobAuthorityKind,
  deathRevision: number,
): MobAuthorityDrop[] {
  const drops: MobAuthorityDrop[] = [];
  for (const definition of MOB_AUTHORITY_DEFINITIONS[kind].drops) {
    const seed = `${mobId}:${deathRevision}:${definition.itemId}`;
    const chanceRoll = hashString(`${seed}:chance`) / 4294967296;
    if (chanceRoll >= definition.chance) continue;
    const range = definition.maxCount - definition.minCount + 1;
    const count = definition.minCount + (hashString(`${seed}:count`) % range);
    if (count > 0) drops.push({ itemId: definition.itemId, count });
  }
  return drops;
}

function storedRow(state: MobAuthorityState): StoredMobAuthorityState {
  return {
    mobId: state.mobId,
    kind: state.kind,
    health: String(state.health),
    revision: String(state.revision),
    deadUntil: String(state.deadUntil),
    lastAttackAt: String(state.lastAttackAt),
    lastAttackerId: state.lastAttackerId,
  };
}

export function resolveMobAttack(input: {
  stored?: StoredMobAuthorityState | null;
  rawMobId: string;
  rawKind: string;
  rawDamage: string | number;
  attackerId: string;
  serverNow: number;
}): MobAttackResolution {
  const identity = validateMobIdentity(input.rawMobId, input.rawKind);
  if (!identity.ok || !Number.isFinite(input.serverNow) || input.serverNow < 0 || !input.attackerId) {
    return { ok: false, reason: "invalid_mob" };
  }
  const damage = validateMobDamage(input.rawDamage);
  if (damage === null) return { ok: false, reason: "invalid_damage" };
  const state = materializeMobAuthorityState(input.stored, identity.mobId, identity.kind, input.serverNow);
  if (state.health === 0 && state.deadUntil > input.serverNow) {
    return { ok: false, reason: "dead", state, retryAfterMs: state.deadUntil - input.serverNow };
  }
  const elapsed = input.serverNow - state.lastAttackAt;
  if (state.revision > 0 && elapsed < MOB_ATTACK_COOLDOWN_MS) {
    return { ok: false, reason: "cooldown", state, retryAfterMs: MOB_ATTACK_COOLDOWN_MS - elapsed };
  }
  const health = Math.max(0, state.health - damage);
  const revision = state.revision + 1;
  const killed = health === 0;
  const nextState: MobAuthorityState = {
    ...state,
    health,
    revision,
    deadUntil: killed ? input.serverNow + MOB_RESPAWN_MS : 0,
    lastAttackAt: input.serverNow,
    lastAttackerId: input.attackerId.slice(0, 128),
  };
  return {
    ok: true,
    killed,
    drops: killed ? deterministicMobDrops(identity.mobId, identity.kind, revision) : [],
    state: nextState,
    nextRow: storedRow(nextState),
  };
}
