import { HOTBAR_SIZE, INVENTORY_SIZE, ITEMS, MAX_HUNGER, maxItemDurability } from "./game.ts";
import { validateFurnaceState } from "./furnaces.ts";

const T = 8_640_000_000_000_000;
const W = 30_000_000;
const Y = 2_048;
const ID = /^[A-Za-z0-9_.:\-]{1,96}$/;
const WORLD_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const KINDS: Record<string, number> = { pig: 10, cow: 10, sheep: 8, chicken: 4, zombie: 20, skeleton: 20, creeper: 20, spider: 16 };
const BEHAVIORS = new Set(["dormant", "idle", "wander", "chase", "fuse"]);
const MOB_KEYS = ["id", "kind", "x", "y", "z", "yaw", "homeX", "homeZ", "behaviorSeed", "homeY", "previousX", "previousY", "previousZ", "previousYaw", "health", "alive", "behavior", "behaviorUntilSeconds", "directionX", "directionZ", "desiredX", "desiredZ", "hostileActive", "randomState", "damageSequence", "nextContactDamageAtSeconds", "nextRangedAttackAtSeconds", "rangedSequence", "authoritativeRevision", "authoritativeDeadUntil", "sheared", "fuseStartedAtSeconds", "fuseUntilSeconds"];
const PROJECTILE_KEYS = ["id", "active", "ownerId", "x", "y", "z", "previousX", "previousY", "previousZ", "velocityX", "velocityY", "velocityZ", "yaw", "pitch", "remainingSeconds", "damage"];

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}
function integer(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum;
}
function finite(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}
function identifier(value: unknown): value is string {
  return typeof value === "string" && ID.test(value);
}
function sortedUnique(values: readonly string[]): boolean {
  return values.every((value, index) => index === 0 || values[index - 1].localeCompare(value) < 0);
}
function coordinate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(-?\d+):(-?\d+):(-?\d+)$/.exec(value);
  if (!match) return false;
  const [x, y, z] = match.slice(1).map(Number);
  return integer(x, -W, W) && integer(y, -Y, Y) && integer(z, -W, W) && value === `${x}:${y}:${z}`;
}
function stack(value: unknown): boolean {
  if (value === null) return true;
  const row = object(value);
  if (!row || !exact(row, row.durability === undefined ? ["itemId", "count"] : ["itemId", "count", "durability"])
    || typeof row.itemId !== "string" || !Object.prototype.hasOwnProperty.call(ITEMS, row.itemId)) return false;
  const item = ITEMS[row.itemId as keyof typeof ITEMS];
  if (!integer(row.count, 1, item.maxStack)) return false;
  const durability = maxItemDurability(row.itemId as keyof typeof ITEMS);
  return durability === null ? row.durability === undefined : row.count === 1 && integer(row.durability, 1, durability);
}
function inventory(value: unknown, length: number): boolean {
  return Array.isArray(value) && value.length === length && value.every(stack);
}
function pose(value: unknown): boolean {
  const row = object(value);
  return Boolean(row && exact(row, ["x", "y", "z", "yaw", "pitch"])
    && finite(row.x, -1_000_000, 1_000_000) && finite(row.y, -24, 128) && finite(row.z, -1_000_000, 1_000_000)
    && finite(row.yaw, -Math.PI * 4, Math.PI * 4) && finite(row.pitch, -1.52, 1.52));
}
function mob(value: unknown): value is Record<string, unknown> {
  const row = object(value);
  if (!row || !exact(row, MOB_KEYS) || typeof row.id !== "string" || row.id.length < 1 || row.id.length > 128
    || typeof row.kind !== "string" || KINDS[row.kind] === undefined || typeof row.behavior !== "string" || !BEHAVIORS.has(row.behavior)
    || typeof row.alive !== "boolean" || typeof row.hostileActive !== "boolean" || typeof row.sheared !== "boolean") return false;
  if (!["x", "y", "z", "homeX", "homeY", "homeZ", "previousX", "previousY", "previousZ", "desiredX", "desiredZ"].every((key) => finite(row[key], -1_000_000, 1_000_000))
    || !finite(row.yaw, -Math.PI * 4, Math.PI * 4) || !finite(row.previousYaw, -Math.PI * 4, Math.PI * 4)
    || !integer(row.behaviorSeed, 0, 0xffff_ffff) || !integer(row.randomState, 1, 0xffff_ffff)
    || !integer(row.damageSequence, 0, Number.MAX_SAFE_INTEGER) || !integer(row.rangedSequence, 0, Number.MAX_SAFE_INTEGER)
    || !integer(row.authoritativeRevision, -1, Number.MAX_SAFE_INTEGER) || !finite(row.health, 0, KINDS[row.kind])
    || row.alive !== ((row.health as number) > 0) || (row.sheared && row.kind !== "sheep")
    || !finite(row.directionX, -1, 1) || !finite(row.directionZ, -1, 1)
    || !["behaviorUntilSeconds", "nextContactDamageAtSeconds", "nextRangedAttackAtSeconds", "fuseStartedAtSeconds", "fuseUntilSeconds"].every((key) => finite(row[key], 0, 1_000_000_000_000))
    || !finite(row.authoritativeDeadUntil, 0, 10_000_000_000_000_000)
    || (row.kind !== "creeper" && (row.fuseStartedAtSeconds !== 0 || row.fuseUntilSeconds !== 0))
    || (row.fuseStartedAtSeconds as number) > (row.fuseUntilSeconds as number)) return false;
  return true;
}
function projectile(value: unknown, expectedId: number, mobIds: Set<string>): boolean {
  const row = object(value);
  return Boolean(row && exact(row, PROJECTILE_KEYS) && row.id === expectedId && typeof row.active === "boolean"
    && typeof row.ownerId === "string" && row.ownerId.length <= 128 && (!row.active || (row.ownerId.length > 0 && mobIds.has(row.ownerId)))
    && ["x", "y", "z", "previousX", "previousY", "previousZ"].every((key) => finite(row[key], -1_000_000, 1_000_000))
    && ["velocityX", "velocityY", "velocityZ"].every((key) => finite(row[key], -1_000, 1_000))
    && finite(row.yaw, -Math.PI * 4, Math.PI * 4) && finite(row.pitch, -Math.PI * 2, Math.PI * 2)
    && finite(row.remainingSeconds, -3, 3) && finite(row.damage, 0, 100));
}
function runtime(value: unknown): boolean {
  if (value === null) return true;
  const row = object(value);
  const day = object(row?.dayNight);
  const simulation = object(row?.mobSimulation);
  if (!row || !exact(row, ["version", "pose", "respawnPoint", "playerHealth", "worldTimeMs", "dayNight", "mobAccumulatorSeconds", "mobSimulation"])
    || row.version !== 1 || !pose(row.pose) || !pose(row.respawnPoint) || !finite(row.playerHealth, 0, 20)
    || !finite(row.worldTimeMs, -10_000_000_000_000_000, 10_000_000_000_000_000) || !finite(row.mobAccumulatorSeconds, 0, .3)
    || !day || !exact(day, ["cycleLengthMs", "epochMs", "epochPhase"]) || !finite(day.cycleLengthMs, Number.MIN_VALUE, 1_000_000_000_000)
    || !finite(day.epochMs, -10_000_000_000_000_000, 10_000_000_000_000_000) || !finite(day.epochPhase, -1_000_000, 1_000_000)
    || !simulation || !exact(simulation, ["version", "elapsedSeconds", "tick", "mobs", "projectiles", "pendingProjectileDamage"])
    || simulation.version !== 1 || !finite(simulation.elapsedSeconds, 0, 1_000_000_000_000)
    || !integer(simulation.tick, 0, Number.MAX_SAFE_INTEGER) || !finite(simulation.pendingProjectileDamage, 0, 12)
    || !Array.isArray(simulation.mobs) || simulation.mobs.length > 64 || !Array.isArray(simulation.projectiles) || simulation.projectiles.length !== 24) return false;
  const mobs = simulation.mobs as unknown[];
  if (!mobs.every(mob)) return false;
  const ids = new Set(mobs.map((entry) => (entry as Record<string, unknown>).id as string));
  return ids.size === mobs.length && (simulation.projectiles as unknown[]).every((entry, index) => projectile(entry, index, ids));
}

/** Portable fail-closed gate shared by local journal parsing and server cloud admission. */
export function isRestorableSinglePlayerSnapshot(value: unknown): boolean {
  const root = object(value);
  const world = object(root?.world);
  const player = object(root?.player);
  const progression = object(root?.progression);
  if (!root || !exact(root, ["world", "player", "progression", "drops", "chests", "furnaces", "primedTnt", "runtime"])
    || !world || !exact(world, world.gameMode === undefined ? ["worldId", "generatorVersion", "seed", "createdAt", "activePlayMs", "weather", "edits"] : ["worldId", "generatorVersion", "seed", "createdAt", "activePlayMs", "gameMode", "weather", "edits"])
    || typeof world.worldId !== "string" || !WORLD_ID.test(world.worldId) || !integer(world.generatorVersion, 1, 1_000_000) || !integer(world.seed, -2_147_483_648, 2_147_483_647)
    || !integer(world.createdAt, 0, T) || !integer(world.activePlayMs, 0, T) || (world.gameMode !== undefined && world.gameMode !== "survival" && world.gameMode !== "creative")) return false;
  const weather = object(world.weather);
  if (!weather || !exact(weather, ["kind", "remainingMs"]) || !["clear", "rain", "thunder"].includes(weather.kind as string)
    || !integer(weather.remainingMs, 0, 7 * 24 * 60 * 60_000) || !Array.isArray(world.edits) || world.edits.length > 12_000) return false;
  let previousEdit: readonly [number, number, number] | null = null;
  for (const value of world.edits) {
    const row = object(value);
    if (!row || !exact(row, ["x", "y", "z", "block"]) || !integer(row.x, -W, W) || !integer(row.y, -Y, Y)
      || !integer(row.z, -W, W) || !integer(row.block, 0, 32)) return false;
    const current = [row.x, row.y, row.z] as const;
    if (previousEdit && !(current[0] > previousEdit[0] || (current[0] === previousEdit[0]
      && (current[1] > previousEdit[1] || (current[1] === previousEdit[1] && current[2] > previousEdit[2]))))) return false;
    previousEdit = current;
  }
  if (!player || !exact(player, ["inventory", "equipment", "selectedHotbar", "hunger"]) || !inventory(player.inventory, INVENTORY_SIZE)
    || !integer(player.selectedHotbar, 0, HOTBAR_SIZE - 1) || !integer(player.hunger, 0, MAX_HUNGER)) return false;
  const equipment = object(player.equipment);
  if (!equipment || !exact(equipment, ["head", "chest", "legs", "feet"])) return false;
  for (const slot of ["head", "chest", "legs", "feet"] as const) {
    if (equipment[slot] === null) continue;
    const item = object(equipment[slot]);
    if (!item || !exact(item, ["itemId", "durability"]) || typeof item.itemId !== "string" || !Object.prototype.hasOwnProperty.call(ITEMS, item.itemId)) return false;
    const armor = ITEMS[item.itemId as keyof typeof ITEMS].armor;
    if (!armor || armor.slot !== slot || !integer(item.durability, 1, armor.maxDurability)) return false;
  }
  if (!progression || !exact(progression, ["experience", "recipes", "advancements"]) || !integer(progression.experience, 0, Number.MAX_SAFE_INTEGER)) return false;
  for (const key of ["recipes", "advancements"] as const) {
    const list = progression[key];
    if (!Array.isArray(list) || list.length > 512 || !list.every(identifier) || !sortedUnique(list)) return false;
  }
  if (!Array.isArray(root.drops) || root.drops.length > 512 || !Array.isArray(root.chests) || root.chests.length > 512
    || !Array.isArray(root.furnaces) || root.furnaces.length > 512 || !Array.isArray(root.primedTnt) || root.primedTnt.length > 64) return false;
  const ids: string[] = [];
  for (const value of root.drops) {
    const row = object(value);
    if (!row || !exact(row, ["dropId", "item", "x", "y", "z", "droppedAt", "velocityY", "settled"]) || !identifier(row.dropId) || !stack(row.item)
      || row.item === null || !finite(row.x, -W, W) || !finite(row.y, -Y, Y) || !finite(row.z, -W, W) || !integer(row.droppedAt, 0, T)
      || !finite(row.velocityY, -24, 0) || typeof row.settled !== "boolean" || (row.settled && row.velocityY !== 0)) return false;
    ids.push(row.dropId);
  }
  if (!sortedUnique(ids)) return false;
  const coordinates: string[] = [];
  for (const value of root.chests) {
    const row = object(value);
    if (!row || !exact(row, ["coordKey", "inventory"]) || !coordinate(row.coordKey) || !inventory(row.inventory, 27)) return false;
    coordinates.push(row.coordKey);
  }
  if (!sortedUnique(coordinates)) return false;
  const furnaces = root.furnaces as unknown[];
  if (!furnaces.every((value) => validateFurnaceState(value).ok)
    || !sortedUnique(furnaces.map((value) => (value as Record<string, unknown>).coordKey as string))) return false;
  const fuses: string[] = [];
  for (const value of root.primedTnt) {
    const row = object(value);
    if (!row || !exact(row, ["eventId", "x", "y", "z", "ignitedAt", "dueAt"]) || !identifier(row.eventId)
      || !integer(row.x, -W, W) || !integer(row.y, -Y, Y) || !integer(row.z, -W, W)
      || !integer(row.ignitedAt, 0, T) || !integer(row.dueAt, row.ignitedAt, T)) return false;
    fuses.push(row.eventId);
  }
  return sortedUnique(fuses) && runtime(root.runtime);
}
