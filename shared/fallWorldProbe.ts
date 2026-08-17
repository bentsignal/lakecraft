import { BLOCK_TYPES, type BlockType } from "./protocol.ts";
import * as BS from "./bundleStrings.ts";

export const FALL_PLAYER_HALF_WIDTH = 0.29;
export const FALL_SUPPORT_INSET = 0.26;
export const FALL_SUPPORT_DEPTH = 0.08;
export const FALL_SUPPORT_CONTACT_TOLERANCE = 0.12;
export const FALL_PLAYER_BODY_HEIGHT = 1.78;

export type FallProbeCell = {
  coordKey: string;
  x: number;
  y: number;
  z: number;
  support: boolean;
  slabSupport: boolean;
  doorTop: boolean;
  ladder: boolean;
};

function addProbeCell(
  cells: Map<string, FallProbeCell>,
  x: number,
  y: number,
  z: number,
  support: boolean,
  slabSupport: boolean,
  doorTop: boolean,
  ladder: boolean,
): void {
  const coordKey = `${x}:${y}:${z}`;
  const existing = cells.get(coordKey);
  if (existing) {
    existing.support ||= support;
    existing.slabSupport ||= slabSupport;
    existing.doorTop ||= doorTop;
    existing.ladder ||= ladder;
    return;
  }
  cells.set(coordKey, { coordKey, x, y, z, support, slabSupport, doorTop, ladder });
}

/** Mirrors the client collision footprint without trusting a grounded claim. */
export function fallProbeCells(pose: { x: number; y: number; z: number }): FallProbeCell[] {
  if (![pose.x, pose.y, pose.z].every(Number.isFinite)) return [];
  const cells = new Map<string, FallProbeCell>();
  const supportY = Math.floor(pose.y - FALL_SUPPORT_DEPTH);
  const touchesSupportSurface = Math.abs(pose.y - (supportY + 1)) <= FALL_SUPPORT_CONTACT_TOLERANCE;
  const touchesSlabSurface = Math.abs(pose.y - (supportY + 0.5)) <= FALL_SUPPORT_CONTACT_TOLERANCE;
  if (touchesSupportSurface || touchesSlabSurface) {
    for (const xOffset of [-FALL_SUPPORT_INSET, FALL_SUPPORT_INSET]) {
      for (const zOffset of [-FALL_SUPPORT_INSET, FALL_SUPPORT_INSET]) {
        const supportX = Math.floor(pose.x + xOffset);
        const supportZ = Math.floor(pose.z + zOffset);
        addProbeCell(cells, supportX, supportY, supportZ, touchesSupportSurface, touchesSlabSurface, false, false);
        // The client treats a closed door as a two-cell-tall collision even
        // though only its lower cell is persisted.
        if (touchesSupportSurface) addProbeCell(cells, supportX, supportY - 1, supportZ, false, false, true, false);
      }
    }
  }

  const minX = Math.floor(pose.x - FALL_PLAYER_HALF_WIDTH);
  const maxX = Math.floor(pose.x + FALL_PLAYER_HALF_WIDTH);
  const minY = Math.floor(pose.y + 0.001);
  const maxY = Math.floor(pose.y + FALL_PLAYER_BODY_HEIGHT - 0.01);
  const minZ = Math.floor(pose.z - FALL_PLAYER_HALF_WIDTH);
  const maxZ = Math.floor(pose.z + FALL_PLAYER_HALF_WIDTH);
  for (let x = minX; x <= maxX; x += 1) {
    for (let y = minY; y <= maxY; y += 1) {
      for (let z = minZ; z <= maxZ; z += 1) addProbeCell(cells, x, y, z, false, false, false, true);
    }
  }
  return [...cells.values()];
}

export function validFallProbeBlock(value: unknown): value is BlockType {
  return BS.isString(value) && (BLOCK_TYPES as readonly string[]).includes(value);
}

/** Matches the current client collision rule; ladders reset falls separately. */
export function fallSupportBlockHasCollision(block: BlockType): boolean {
  return block !== "air" && block !== "torch" && block !== BS.doorOpen
    && block !== BS.oakFenceGateOpen && block !== "ladder" && block !== "water"
    && block !== "short_grass" && block !== "dandelion" && block !== "poppy"
    && !block.endsWith("_slab");
}
