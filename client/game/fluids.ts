import { BLOCK, blockStateName, isFluidBlock, isLavaBlock, isWaterBlock, type BlockId, type WorldEdit } from "./types.ts";

export type FluidKind = "water" | "lava";
export type FluidLookup = (x: number, y: number, z: number) => BlockId;
export const PLAYER_MAX_AIR = 10;
export const WATER_MOVE_SCALE = 0.38;
export const LAVA_MOVE_SCALE = 0.2;
export const LAVA_DAMAGE_INTERVAL_SECONDS = 1;

const WATER = [BLOCK.WATER, BLOCK.WATER_FLOW_1, BLOCK.WATER_FLOW_2, BLOCK.WATER_FLOW_3,
  BLOCK.WATER_FLOW_4, BLOCK.WATER_FLOW_5, BLOCK.WATER_FLOW_6, BLOCK.WATER_FLOW_7] as const;
const LAVA = [BLOCK.LAVA, BLOCK.LAVA_FLOW_1, BLOCK.LAVA_FLOW_2, BLOCK.LAVA_FLOW_3] as const;
const HORIZONTAL = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

export function fluidKind(block: BlockId): FluidKind | null {
  return isWaterBlock(block) ? "water" : isLavaBlock(block) ? "lava" : null;
}

export function fluidLevel(block: BlockId): number {
  const kind = fluidKind(block);
  if (!kind) return -1;
  if (block === BLOCK.WATER || block === BLOCK.LAVA) return 0;
  const level = Number(blockStateName(block).slice(kind.length + 6));
  return Number.isInteger(level) ? level : -1;
}

export function fluidBlock(kind: FluidKind, level = 0): BlockId {
  const levels = kind === "water" ? WATER : LAVA;
  return levels[Math.max(0, Math.min(levels.length - 1, Math.floor(level)))] as BlockId;
}

export function isFluidSource(block: BlockId): boolean {
  return block === BLOCK.WATER || block === BLOCK.LAVA;
}

/**
 * One deterministic cellular-fluid decision. Source blocks are durable world
 * state; flowing levels are a locally derived cache rebuilt from those sources.
 */
export function planFluidCell(kind: FluidKind, x: number, y: number, z: number, getBlock: FluidLookup): WorldEdit | null {
  const current = getBlock(x, y, z);
  if (isFluidSource(current) || current !== BLOCK.AIR && !isFluidBlock(current)) return null;
  const currentKind = fluidKind(current);
  if (currentKind && currentKind !== kind) return null;
  let nextLevel = 99;
  const offer = (block: BlockId, offeredLevel: number) => {
    if (fluidKind(block) === kind) nextLevel = Math.min(nextLevel, offeredLevel);
  };
  const above = getBlock(x, y + 1, z);
  if (isFluidBlock(above)) offer(above, 1);
  for (const [dx, dz] of HORIZONTAL) {
    const neighbor = getBlock(x + dx, y, z + dz);
    if (fluidKind(neighbor) !== kind || getBlock(x + dx, y - 1, z + dz) === BLOCK.AIR) continue;
    const next = fluidLevel(neighbor) + 1;
    if (next <= (kind === "water" ? 7 : 3)) offer(neighbor, next);
  }
  const next = nextLevel < 99 ? fluidBlock(kind, nextLevel) : BLOCK.AIR;
  return next === current ? null : { x, y, z, block: next };
}

/** Cells whose incoming support may change after one fluid/world edit. */
export function fluidNeighborCells(x: number, y: number, z: number): WorldEdit[] {
  return [
    { x, y, z, block: BLOCK.AIR }, { x, y: y - 1, z, block: BLOCK.AIR },
    ...HORIZONTAL.map(([dx, dz]) => ({ x: x + dx, y, z: z + dz, block: BLOCK.AIR })),
  ];
}

export function fluidTickDelay(block: BlockId): number {
  return isLavaBlock(block) ? 700 : 180;
}

export type BreathState = Readonly<{ air: number; drain: number; damage: number }>;
export function createBreathState(): BreathState {
  return { air: PLAYER_MAX_AIR, drain: 0, damage: 0 };
}

/** Minecraft-like 15-second air supply, fast recovery, then 2 damage/second. */
export function advanceBreath(state: BreathState, submerged: boolean, elapsedSeconds: number): BreathState & { damageTaken: number } {
  const dt = Math.max(0, Math.min(Number.isFinite(elapsedSeconds) ? elapsedSeconds : 0, 1));
  let air = state.air, drain = state.drain, damage = state.damage, damageTaken = 0;
  if (!submerged) {
    drain = 0; damage = 0;
    air = Math.min(PLAYER_MAX_AIR, air + dt * 4);
  } else if (air > 0) {
    drain += dt;
    const spent = Math.min(air, Math.floor(drain / 1.5));
    air -= spent; drain -= spent * 1.5;
  } else {
    damage += dt;
    damageTaken = Math.floor(damage);
    damage -= damageTaken;
  }
  return { air, drain, damage, damageTaken: damageTaken * 2 };
}

export function raycastFluidSource(
  origin: readonly [number, number, number], direction: readonly [number, number, number],
  getBlock: FluidLookup, reach = 6,
): WorldEdit | null {
  const originX = Math.floor(origin[0]), originY = Math.floor(origin[1]), originZ = Math.floor(origin[2]);
  let last = "";
  for (let distance = 0.025; distance <= reach; distance += 0.025) {
    const x = Math.floor(origin[0] + direction[0] * distance);
    const y = Math.floor(origin[1] + direction[1] * distance);
    const z = Math.floor(origin[2] + direction[2] * distance);
    const key = `${x},${y},${z}`;
    if (key === last || x === originX && y === originY && z === originZ) continue;
    last = key;
    const block = getBlock(x, y, z);
    if (isFluidSource(block)) return { x, y, z, block };
    if (block !== BLOCK.AIR && !isFluidBlock(block)) return null;
  }
  return null;
}
