import { CREEPER_FUSE_TICKS } from "./mobMotionAuthority.ts";
import { MOB_AUTHORITY_WORLD_SEED_TOKEN, validateMobIdentity } from "./mobCombat.ts";
import type { BlockType } from "./protocol.ts";
import { BLOCKS, type BlockId, type ItemId } from "./game.ts";
import * as BS from "./bundleStrings.ts";

export const CREEPER_EXPLOSION_RADIUS = 3;
export const CREEPER_EXPLOSION_MAX_BLOCKS = 64;
export const CREEPER_EXPLOSION_MAX_AGE_TICKS = 20;
export const CREEPER_EXPLOSION_CALLER_RANGE = 96;
export const CREEPER_EXPLOSION_MAX_PLAYER_VICTIMS = 16;

export type CreeperExplosionRequest = {
  operationId: string;
  mobId: string;
  epoch: number;
  checkpointRevision: number;
  fuseStartedTick: number;
};

export type CreeperExplosionAuthority = {
  mobId: string;
  epoch: number;
  checkpointRevision: number;
  fuseStartedTick: number;
  explosionTick: number;
  currentTick: number;
  center: { x: number; y: number; z: number };
  radius: number;
};

export type CreeperExplosionCell = {
  x: number;
  y: number;
  z: number;
  coordKey: string;
  distanceSquared: number;
};

export type CreeperExplosionProbeCell = { x: number; y: number; z: number; coordKey: string };

function record(raw: string): Record<string, unknown> | null {
  if (!BS.isString(raw) || raw.length > 1_024) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function safeInteger(value: unknown, minimum = 0): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;
}

function hashText(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function creeperExplosionEventId(input: Pick<CreeperExplosionAuthority, "mobId" | "epoch" | "fuseStartedTick">): string {
  return `creeper_${input.epoch.toString(36)}_${input.fuseStartedTick.toString(36)}_${hashText(input.mobId)}`;
}

export function creeperExplosionFingerprint(request: Readonly<CreeperExplosionRequest>): string {
  return JSON.stringify([
    request.operationId,
    request.mobId,
    request.epoch,
    request.checkpointRevision,
    request.fuseStartedTick,
  ]);
}

export function validateCreeperExplosionRequestJson(rawJson: string): CreeperExplosionRequest | null {
  const parsed = record(rawJson);
  if (!parsed) return null;
  const keys = [BS.operationId, "mobId", "epoch", "checkpointRevision", "fuseStartedTick"];
  const actualKeys = Object.keys(parsed);
  if (actualKeys.length !== keys.length || actualKeys.some((key) => !keys.includes(key))
    || !BS.isString(parsed.operationId) || !/^[A-Za-z0-9_-]{16,64}$/.test(parsed.operationId)
    || !BS.isString(parsed.mobId)
    || !safeInteger(parsed.epoch)
    || !safeInteger(parsed.checkpointRevision)
    || !safeInteger(parsed.fuseStartedTick, 1)) return null;
  const identity = validateMobIdentity(parsed.mobId, "creeper", MOB_AUTHORITY_WORLD_SEED_TOKEN);
  return identity.ok ? {
    operationId: parsed.operationId,
    mobId: identity.mobId,
    epoch: parsed.epoch,
    checkpointRevision: parsed.checkpointRevision,
    fuseStartedTick: parsed.fuseStartedTick,
  } : null;
}

export function authorizeCreeperExplosionRequest(
  request: Readonly<CreeperExplosionRequest>,
  authority: Readonly<CreeperExplosionAuthority>,
): { ok: true; eventId: string; fingerprint: string } | { ok: false; reason: string } {
  const eventId = creeperExplosionEventId(authority);
  if (request.mobId !== authority.mobId || request.epoch !== authority.epoch
    || request.checkpointRevision !== authority.checkpointRevision
    || request.fuseStartedTick !== authority.fuseStartedTick
    || request.operationId !== eventId) return { ok: false, reason: "invalid_claim" };
  if (authority.explosionTick !== authority.fuseStartedTick + CREEPER_FUSE_TICKS
    || authority.currentTick < authority.explosionTick
    || authority.currentTick - authority.explosionTick > CREEPER_EXPLOSION_MAX_AGE_TICKS
    || !Number.isFinite(authority.center.x) || !Number.isFinite(authority.center.y)
    || !Number.isFinite(authority.center.z)
    || authority.radius !== CREEPER_EXPLOSION_RADIUS) return { ok: false, reason: "stale_claim" };
  return { ok: true, eventId, fingerprint: creeperExplosionFingerprint(request) };
}

/** Nearest-first deterministic sphere, bounded before any database reads. */
export function enumerateCreeperExplosionBlocks(
  authority: Readonly<Pick<CreeperExplosionAuthority, "center" | "radius">>,
): CreeperExplosionCell[] {
  if (authority.radius !== CREEPER_EXPLOSION_RADIUS) return [];
  const centerX = Math.floor(authority.center.x);
  const centerY = Math.floor(authority.center.y + 0.5);
  const centerZ = Math.floor(authority.center.z);
  const candidates: CreeperExplosionCell[] = [];
  for (let y = centerY - authority.radius; y <= centerY + authority.radius; y += 1) {
    for (let z = centerZ - authority.radius; z <= centerZ + authority.radius; z += 1) {
      for (let x = centerX - authority.radius; x <= centerX + authority.radius; x += 1) {
        const dx = x + 0.5 - authority.center.x;
        const dy = y + 0.5 - (authority.center.y + 0.8);
        const dz = z + 0.5 - authority.center.z;
        const distanceSquared = dx * dx + dy * dy + dz * dz;
        if (distanceSquared > authority.radius * authority.radius) continue;
        candidates.push({ x, y, z, coordKey: `${x}:${y}:${z}`, distanceSquared });
      }
    }
  }
  candidates.sort((left, right) => left.distanceSquared - right.distanceSquared
    || left.y - right.y || left.x - right.x || left.z - right.z);
  return candidates.slice(0, CREEPER_EXPLOSION_MAX_BLOCKS);
}

export function creeperBlockIsProtected(block: BlockType): boolean {
  return block === "air" || block === "chest" || block === "furnace" || block === "bed"
    || block === BS.doorClosed || block === BS.doorOpen;
}

export function planCreeperTerrainDestruction(
  authority: Readonly<Pick<CreeperExplosionAuthority, "center" | "radius">>,
  readBlock: (cell: Readonly<CreeperExplosionCell>) => BlockType,
): Array<CreeperExplosionCell & { previousBlock: BlockType }> {
  const result: Array<CreeperExplosionCell & { previousBlock: BlockType }> = [];
  for (const cell of enumerateCreeperExplosionBlocks(authority)) {
    const previousBlock = readBlock(cell);
    if (!creeperBlockIsProtected(previousBlock)) result.push({ ...cell, previousBlock });
  }
  return result;
}

function protocolBlockId(block: BlockType): BlockId | null {
  if (block === "wood") return "log";
  if (block === BS.doorClosed || block === BS.doorOpen) return "door";
  if (block === BS.oakFenceGateClosed || block === BS.oakFenceGateOpen) return BS.oakFenceGate;
  return block !== "air" && block in BLOCKS ? block as BlockId : null;
}

export function planCreeperBlockDrops(
  eventId: string,
  destruction: readonly Readonly<CreeperExplosionCell & { previousBlock: BlockType }>[],
): Array<{ itemId: ItemId; count: number }> {
  const totals = new Map<ItemId, number>();
  for (const cell of destruction) {
    if (cell.previousBlock === "tnt") continue;
    // A deterministic 30% survival roll mirrors Minecraft's lossy blast drops
    // while guaranteeing every spawned item came from one destroyed block.
    const roll = Number.parseInt(hashText(`${eventId}:${cell.coordKey}`), 36) % 10;
    if (roll >= 3) continue;
    const blockId = protocolBlockId(cell.previousBlock);
    const drop = blockId ? BLOCKS[blockId].drop : null;
    if (!drop) continue;
    totals.set(drop, Math.min(64, (totals.get(drop) ?? 0) + 1));
  }
  return [...totals.entries()]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .slice(0, 8)
    .map(([itemId, count]) => ({ itemId, count }));
}

export function resolveCreeperExplosionDamage(
  authority: Readonly<Pick<CreeperExplosionAuthority, "center" | "radius">>,
  target: Readonly<{ x: number; y: number; z: number }>,
  exposure = 1,
): number {
  const distance = Math.hypot(
    target.x - authority.center.x,
    target.y + 0.9 - (authority.center.y + 0.8),
    target.z - authority.center.z,
  );
  const reach = authority.radius * 2;
  if (!Number.isFinite(distance) || distance >= reach || exposure <= 0) return 0;
  const impact = Math.max(0, Math.min(1, (1 - distance / reach) * Math.min(1, exposure)));
  return Math.max(1, Math.min(20, Math.floor((impact * impact + impact) * 7 + 1)));
}

function exposureRayCells(
  authority: Readonly<Pick<CreeperExplosionAuthority, "center" | "radius">>,
  target: Readonly<{ x: number; y: number; z: number }>,
  targetY: number,
): CreeperExplosionProbeCell[] {
  const cells = new Map<string, CreeperExplosionProbeCell>();
  const dx = target.x - authority.center.x;
  const dy = targetY - (authority.center.y + 0.8);
  const dz = target.z - authority.center.z;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy, dz) * 2.5));
  for (let step = 1; step < steps; step += 1) {
    const ratio = step / steps;
    if (ratio < 0.2) continue;
    const x = Math.floor(authority.center.x + dx * ratio);
    const y = Math.floor(authority.center.y + 0.8 + dy * ratio);
    const z = Math.floor(authority.center.z + dz * ratio);
    const coordKey = `${x}:${y}:${z}`;
    cells.set(coordKey, { x, y, z, coordKey });
  }
  return [...cells.values()].sort((left, right) => left.y - right.y || left.x - right.x || left.z - right.z);
}

export function creeperExplosionExposureCells(
  authority: Readonly<Pick<CreeperExplosionAuthority, "center" | "radius">>,
  target: Readonly<{ x: number; y: number; z: number }>,
): CreeperExplosionProbeCell[] {
  const cells = new Map<string, CreeperExplosionProbeCell>();
  for (const targetY of [target.y + 0.2, target.y + 0.9, target.y + 1.6]) {
    for (const cell of exposureRayCells(authority, target, targetY)) cells.set(cell.coordKey, cell);
  }
  return [...cells.values()].sort((left, right) => left.y - right.y || left.x - right.x || left.z - right.z);
}

export function sampleCreeperExplosionExposure(
  authority: Readonly<Pick<CreeperExplosionAuthority, "center" | "radius">>,
  target: Readonly<{ x: number; y: number; z: number }>,
  readBlock: (cell: Readonly<CreeperExplosionProbeCell>) => BlockType,
): number {
  let clear = 0;
  for (const targetY of [target.y + 0.2, target.y + 0.9, target.y + 1.6]) {
    const cells = exposureRayCells(authority, target, targetY);
    const occluded = cells.some((cell) => {
      const block = readBlock(cell);
      return block !== "air" && block !== "torch" && block !== "ladder"
        && block !== BS.doorOpen && block !== BS.oakFenceGateOpen;
    });
    if (!occluded) clear += 1;
  }
  return clear / 3;
}

export function decideCreeperExplosionCommit(
  storedFingerprint: string | null,
  fingerprint: string,
): "commit" | "replay" | "event_collision" {
  return storedFingerprint === null ? "commit"
    : storedFingerprint === fingerprint ? "replay" : "event_collision";
}
