import {
  BLOCK,
  type BedDirection,
  type BedStructure,
  type BlockCoordinate,
  type BlockId,
  type WorldEdit,
} from "./types.ts";
import { blockCollisionHeight } from "./blockGeometry.ts";
import {
  WORLD_EDIT_MAX_XZ,
  WORLD_EDIT_MAX_Y,
  WORLD_EDIT_MIN_XZ,
  WORLD_EDIT_MIN_Y,
} from "../../shared/worldChunks.ts";

export type BedPlacementFailure = "invalid_coordinate" | "occupied" | "unsupported" | "player_collision";

export type BedPlacementPlan =
  | { ok: true; bed: BedStructure; edits: readonly [WorldEdit, WorldEdit] }
  | { ok: false; reason: BedPlacementFailure };

const DIRECTIONS: Record<BedDirection, readonly [number, number]> = {
  north: [0, -1],
  south: [0, 1],
  east: [1, 0],
  west: [-1, 0],
};

export function bedCellKey(cell: Readonly<BlockCoordinate>): string {
  return `${cell.x},${cell.y},${cell.z}`;
}

export function bedStructureKey(bed: Readonly<BedStructure>): string {
  return bedCellKey(bed.foot);
}

export function bedDirectionFromYaw(yaw: number): BedDirection {
  if (!Number.isFinite(yaw)) return "north";
  const x = Math.sin(yaw);
  const z = -Math.cos(yaw);
  if (Math.abs(x) >= Math.abs(z)) return x >= 0 ? "east" : "west";
  return z >= 0 ? "south" : "north";
}

export function createBedStructure(foot: Readonly<BlockCoordinate>, direction: BedDirection): BedStructure {
  const [dx, dz] = DIRECTIONS[direction];
  return {
    foot: { x: foot.x, y: foot.y, z: foot.z },
    head: { x: foot.x + dx, y: foot.y, z: foot.z + dz },
    direction,
  };
}

export function isValidBedStructure(value: unknown): value is BedStructure {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 3 || !Object.keys(record).every((key) => ["foot", "head", "direction"].includes(key))) return false;
  if (record.direction !== "north" && record.direction !== "south" && record.direction !== "east" && record.direction !== "west") return false;
  const coordinate = (candidate: unknown): candidate is BlockCoordinate => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return false;
    const cell = candidate as Record<string, unknown>;
    return Object.keys(cell).length === 3
      && Object.keys(cell).every((key) => ["x", "y", "z"].includes(key))
      && Number.isSafeInteger(cell.x) && Number.isSafeInteger(cell.y) && Number.isSafeInteger(cell.z)
      && Number(cell.x) >= WORLD_EDIT_MIN_XZ && Number(cell.x) <= WORLD_EDIT_MAX_XZ
      && Number(cell.y) >= WORLD_EDIT_MIN_Y && Number(cell.y) <= WORLD_EDIT_MAX_Y
      && Number(cell.z) >= WORLD_EDIT_MIN_XZ && Number(cell.z) <= WORLD_EDIT_MAX_XZ;
  };
  if (!coordinate(record.foot) || !coordinate(record.head)) return false;
  const expected = createBedStructure(record.foot, record.direction);
  return expected.head.x === record.head.x && expected.head.y === record.head.y && expected.head.z === record.head.z;
}

export function validateBedStructures(
  value: unknown,
  edits: readonly WorldEdit[],
  maximum: number,
): BedStructure[] | null {
  if (!Array.isArray(value) || value.length > maximum) return null;
  const blocks = new Map(edits.map((edit) => [bedCellKey(edit), edit.block]));
  const occupied = new Set<string>();
  const structures: BedStructure[] = [];
  for (const candidate of value) {
    if (!isValidBedStructure(candidate)) return null;
    const footKey = bedCellKey(candidate.foot);
    const headKey = bedCellKey(candidate.head);
    if (occupied.has(footKey) || occupied.has(headKey)
      || blocks.get(footKey) !== BLOCK.BED || blocks.get(headKey) !== BLOCK.BED) return null;
    occupied.add(footKey);
    occupied.add(headKey);
    structures.push(createBedStructure(candidate.foot, candidate.direction));
  }
  return structures.sort((left, right) => bedStructureKey(left).localeCompare(bedStructureKey(right)));
}

export function blockSupportsBed(block: BlockId): boolean {
  return blockCollisionHeight(block) === 1
    && block !== BLOCK.AIR
    && block !== BLOCK.TORCH
    && block !== BLOCK.CHEST
    && block !== BLOCK.BED
    && block !== BLOCK.DOOR_CLOSED
    && block !== BLOCK.DOOR_OPEN
    && block !== BLOCK.LADDER
    && block !== BLOCK.SAPLING
    && block !== BLOCK.OAK_FENCE
    && block !== BLOCK.OAK_FENCE_GATE_CLOSED
    && block !== BLOCK.OAK_FENCE_GATE_OPEN;
}

export function planBedPlacement(input: {
  foot: Readonly<BlockCoordinate>;
  yaw: number;
  getBlock: (x: number, y: number, z: number) => BlockId;
  intersectsPlayer?: (x: number, y: number, z: number) => boolean;
}): BedPlacementPlan {
  const direction = bedDirectionFromYaw(input.yaw);
  const bed = createBedStructure(input.foot, direction);
  if (!isValidBedStructure(bed)) return { ok: false, reason: "invalid_coordinate" };
  for (const cell of [bed.foot, bed.head]) {
    if (input.getBlock(cell.x, cell.y, cell.z) !== BLOCK.AIR) return { ok: false, reason: "occupied" };
    if (!blockSupportsBed(input.getBlock(cell.x, cell.y - 1, cell.z))) return { ok: false, reason: "unsupported" };
    if (input.intersectsPlayer?.(cell.x, cell.y, cell.z)) return { ok: false, reason: "player_collision" };
  }
  return {
    ok: true,
    bed,
    edits: [
      { ...bed.foot, block: BLOCK.BED },
      { ...bed.head, block: BLOCK.BED },
    ],
  };
}

export function bedStructureAt(
  beds: readonly BedStructure[],
  x: number,
  y: number,
  z: number,
): BedStructure | null {
  const key = bedCellKey({ x, y, z });
  const found = beds.find((bed) => bedCellKey(bed.foot) === key || bedCellKey(bed.head) === key);
  return found ? createBedStructure(found.foot, found.direction) : null;
}

/** Returns both AIR edits with the selected half first, so one mining callback pays/drops once. */
export function bedBreakEdits(
  bed: Readonly<BedStructure>,
  selected: Readonly<BlockCoordinate>,
): readonly [WorldEdit, WorldEdit] | null {
  const selectedKey = bedCellKey(selected);
  const footKey = bedCellKey(bed.foot);
  const headKey = bedCellKey(bed.head);
  if (selectedKey !== footKey && selectedKey !== headKey) return null;
  const other = selectedKey === footKey ? bed.head : bed.foot;
  return [
    { ...selected, block: BLOCK.AIR },
    { ...other, block: BLOCK.AIR },
  ];
}
