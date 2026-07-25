import type { BlockId } from "./game.ts";
import {
  WORLD_EDIT_MAX_XZ,
  WORLD_EDIT_MAX_Y,
  WORLD_EDIT_MIN_XZ,
  WORLD_EDIT_MIN_Y,
} from "./worldChunks.ts";

export const OAK_TREE_MAX_EDITS = 70;
export const OAK_TREE_MAX_PROBE_CELLS = OAK_TREE_MAX_EDITS + 1;

export type OakTreeGrowthEdit = {
  x: number;
  y: number;
  z: number;
  block: Extract<BlockId, "log" | "leaves">;
};

export type OakTreeGrowthProbeCell = {
  x: number;
  y: number;
  z: number;
};

export type OakTreeGrowthFailureReason =
  | "invalid_coordinate"
  | "not_sapling"
  | "invalid_support"
  | "blocked";

export type OakTreeGrowthResult =
  | { ok: true; edits: readonly OakTreeGrowthEdit[] }
  | { ok: false; reason: OakTreeGrowthFailureReason };

export type OakTreeGrowthInput = {
  x: number;
  y: number;
  z: number;
  blockAt: (x: number, y: number, z: number) => BlockId | "air";
};

function coordinateKey(x: number, y: number, z: number): string {
  return `${x}:${y}:${z}`;
}

function coordinateInWorld(x: number, y: number, z: number): boolean {
  return Number.isSafeInteger(x) && x >= WORLD_EDIT_MIN_XZ && x <= WORLD_EDIT_MAX_XZ
    && Number.isSafeInteger(y) && y >= WORLD_EDIT_MIN_Y && y <= WORLD_EDIT_MAX_Y
    && Number.isSafeInteger(z) && z >= WORLD_EDIT_MIN_XZ && z <= WORLD_EDIT_MAX_XZ;
}

/** Coordinate-derived height keeps offline and authoritative growth byte-identical. */
export function oakTreeTrunkHeight(x: number, y: number, z: number): 4 | 5 {
  const hash = (Math.imul(x, 73_856_093) ^ Math.imul(y, 19_349_663)
    ^ Math.imul(z, 83_492_791) ^ 0x7f4a7c15) >>> 0;
  return (hash & 1) === 0 ? 4 : 5;
}

function plannedTreeEdits(x: number, y: number, z: number): OakTreeGrowthEdit[] {
  const trunkHeight = oakTreeTrunkHeight(x, y, z);
  const crownY = y + trunkHeight - 1;
  const edits = new Map<string, OakTreeGrowthEdit>();

  for (let layer = -2; layer <= 1; layer += 1) {
    const radius = layer === 1 ? 1 : 2;
    for (let dz = -radius; dz <= radius; dz += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (radius === 2 && Math.abs(dx) === 2 && Math.abs(dz) === 2) continue;
        if (layer === 1 && Math.abs(dx) + Math.abs(dz) > 1) continue;
        const edit = { x: x + dx, y: crownY + layer, z: z + dz, block: "leaves" as const };
        edits.set(coordinateKey(edit.x, edit.y, edit.z), edit);
      }
    }
  }

  // Logs overwrite the canopy center, matching the canonical solid oak trunk.
  for (let offset = 0; offset < trunkHeight; offset += 1) {
    const edit = { x, y: y + offset, z, block: "log" as const };
    edits.set(coordinateKey(edit.x, edit.y, edit.z), edit);
  }

  return [...edits.values()].sort((left, right) => {
    if (left.block !== right.block) return left.block === "log" ? -1 : 1;
    return left.y - right.y || left.x - right.x || left.z - right.z;
  });
}

/** Bounded support/clearance coordinates an authority must resolve before planning. */
export function oakTreeGrowthProbeCells(x: number, y: number, z: number): readonly OakTreeGrowthProbeCell[] {
  if (!coordinateInWorld(x, y, z)) return [];
  const edits = plannedTreeEdits(x, y, z);
  if (edits.length > OAK_TREE_MAX_EDITS
    || !coordinateInWorld(x, y - 1, z)
    || edits.some((edit) => !coordinateInWorld(edit.x, edit.y, edit.z))) return [];
  return [
    { x, y: y - 1, z },
    ...edits.map(({ x: editX, y: editY, z: editZ }) => ({ x: editX, y: editY, z: editZ })),
  ];
}

/**
 * Plans one whole oak from authoritative block facts. The planner has no RNG,
 * clock, storage, or partial-success path: support and every replaceable cell
 * are checked before the bounded edit set is returned.
 */
export function planOakTreeGrowth(input: Readonly<OakTreeGrowthInput>): OakTreeGrowthResult {
  const probes = oakTreeGrowthProbeCells(input.x, input.y, input.z);
  if (probes.length === 0 || typeof input.blockAt !== "function") {
    return { ok: false, reason: "invalid_coordinate" };
  }

  let sapling: BlockId | "air";
  let support: BlockId | "air";
  try {
    sapling = input.blockAt(input.x, input.y, input.z);
    support = input.blockAt(input.x, input.y - 1, input.z);
  } catch {
    return { ok: false, reason: "blocked" };
  }
  if (sapling !== "sapling") return { ok: false, reason: "not_sapling" };
  if (support !== "grass" && support !== "dirt") return { ok: false, reason: "invalid_support" };

  const edits = plannedTreeEdits(input.x, input.y, input.z);
  try {
    for (const edit of edits) {
      if (edit.x === input.x && edit.y === input.y && edit.z === input.z) continue;
      const current = input.blockAt(edit.x, edit.y, edit.z);
      if (current !== "air" && current !== "leaves") return { ok: false, reason: "blocked" };
    }
  } catch {
    return { ok: false, reason: "blocked" };
  }
  return { ok: true, edits };
}
