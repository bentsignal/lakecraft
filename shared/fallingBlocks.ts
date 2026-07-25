import { isBlockType, type BlockType } from "./protocol.ts";
import {
  WORLD_EDIT_MAX_XZ,
  WORLD_EDIT_MAX_Y,
  WORLD_EDIT_MIN_XZ,
  WORLD_EDIT_MIN_Y,
} from "./worldChunks.ts";

/** Falling is deliberately resolved only as a bounded consequence of an edit. */
export const FALLING_BLOCK_MAX_MOVES = 8;
export const FALLING_BLOCK_MAX_VERTICAL_CELLS = 32;

export type FallingBlockMaterial = "sand" | "gravel";
export type FallingBlockCellBlock = BlockType;

export type AuthoritativeFallingBlockCell = {
  x: number;
  y: number;
  z: number;
  coordKey: string;
  /** Canonical post-trigger block observed by the authority. */
  block: FallingBlockCellBlock;
  /** Present for a stored block instance and null for untouched natural terrain. */
  blockInstanceToken: string | null;
};

export type FallingBlockTrigger = {
  x: number;
  y: number;
  z: number;
  coordKey: string;
  previousBlock: FallingBlockCellBlock;
  nextBlock: FallingBlockCellBlock;
};

export type FallingBlockMove = {
  block: FallingBlockMaterial;
  source: { x: number; y: number; z: number; coordKey: string; blockInstanceToken: string | null };
  destination: { x: number; y: number; z: number; coordKey: string };
  fallDistance: number;
};

export type FallingBlockEdit = {
  phase: "vacate" | "settle";
  x: number;
  y: number;
  z: number;
  coordKey: string;
  block: "air" | FallingBlockMaterial;
  sourceCoordKey: string;
};

export type FallingBlockResolution =
  | {
    ok: false;
    reason: "invalid_trigger" | "invalid_cell" | "too_many_cells" | "incomplete_column";
  }
  | {
    ok: true;
    moves: FallingBlockMove[];
    /** All vacates precede all settles so overlapping stack moves compose safely. */
    edits: FallingBlockEdit[];
    /** Final values for affected coordinates only, ordered from low Y to high Y. */
    finalBlocks: Record<string, "air" | FallingBlockMaterial>;
  };

const BLOCK_INSTANCE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{8,160}:\d{1,16}$/;

function coordinateKey(x: number, y: number, z: number): string {
  return `${x}:${y}:${z}`;
}

function validCoordinate(x: number, y: number, z: number): boolean {
  return Number.isSafeInteger(x) && x >= WORLD_EDIT_MIN_XZ && x <= WORLD_EDIT_MAX_XZ
    && Number.isSafeInteger(y) && y >= WORLD_EDIT_MIN_Y && y <= WORLD_EDIT_MAX_Y
    && Number.isSafeInteger(z) && z >= WORLD_EDIT_MIN_XZ && z <= WORLD_EDIT_MAX_XZ;
}

function validBlock(block: unknown): block is FallingBlockCellBlock {
  return isBlockType(block);
}

function isFallingBlock(block: FallingBlockCellBlock): block is FallingBlockMaterial {
  return block === "sand" || block === "gravel";
}

function validTrigger(trigger: Readonly<FallingBlockTrigger>): boolean {
  return validCoordinate(trigger.x, trigger.y, trigger.z)
    && trigger.coordKey === coordinateKey(trigger.x, trigger.y, trigger.z)
    && validBlock(trigger.previousBlock)
    && validBlock(trigger.nextBlock);
}

function validCell(cell: Readonly<AuthoritativeFallingBlockCell>): boolean {
  return validCoordinate(cell.x, cell.y, cell.z)
    && cell.coordKey === coordinateKey(cell.x, cell.y, cell.z)
    && validBlock(cell.block)
    && (cell.blockInstanceToken === null || BLOCK_INSTANCE_TOKEN_PATTERN.test(cell.blockInstanceToken));
}

function emptyResolution(): Extract<FallingBlockResolution, { ok: true }> {
  return { ok: true, moves: [], edits: [], finalBlocks: {} };
}

/**
 * Resolves a single vertical column from explicit post-edit facts. No clock,
 * callback, client-provided distance, timer, polling, or background scan enters
 * the plan. Reordering the same facts therefore produces the exact same result.
 *
 * A falling block placed by the trigger starts at the edited coordinate. A
 * support removal starts immediately above it, which also handles stacked
 * sand/gravel. Only air is passable; any occupied cell is a floor. The supplied
 * facts must be contiguous and prove both the landing floor and the relevant
 * top of the stack (unless the eight-move cap has already been reached).
 */
export function resolveFallingBlocks(input: Readonly<{
  trigger: Readonly<FallingBlockTrigger>;
  authoritativeCells: readonly Readonly<AuthoritativeFallingBlockCell>[];
}>): FallingBlockResolution {
  if (!validTrigger(input.trigger)) return { ok: false, reason: "invalid_trigger" };
  if (input.authoritativeCells.length > FALLING_BLOCK_MAX_VERTICAL_CELLS) {
    return { ok: false, reason: "too_many_cells" };
  }
  if (input.authoritativeCells.length === 0 || input.authoritativeCells.some((cell) => !validCell(cell))) {
    return { ok: false, reason: "invalid_cell" };
  }

  const cells = [...input.authoritativeCells].sort((left, right) => left.y - right.y);
  const cellByY = new Map<number, Readonly<AuthoritativeFallingBlockCell>>();
  for (let index = 0; index < cells.length; index += 1) {
    const cell = cells[index];
    if (cell.x !== input.trigger.x || cell.z !== input.trigger.z
      || cellByY.has(cell.y)
      || (index > 0 && cell.y !== cells[index - 1].y + 1)) {
      return { ok: false, reason: "invalid_cell" };
    }
    cellByY.set(cell.y, cell);
  }
  const triggerCell = cellByY.get(input.trigger.y);
  if (!triggerCell || triggerCell.block !== input.trigger.nextBlock) {
    return { ok: false, reason: "invalid_cell" };
  }

  const placedFallingBlock = isFallingBlock(input.trigger.nextBlock);
  const removedBlock = input.trigger.previousBlock !== "air" && input.trigger.nextBlock === "air";
  if (!placedFallingBlock && !removedBlock) return emptyResolution();

  const startY = placedFallingBlock ? input.trigger.y : input.trigger.y + 1;
  if (startY > WORLD_EDIT_MAX_Y) return emptyResolution();
  const first = cellByY.get(startY);
  if (!first) return { ok: false, reason: "incomplete_column" };
  if (!isFallingBlock(first.block)) return emptyResolution();

  let supportY = startY - 1;
  let floorProven = supportY < WORLD_EDIT_MIN_Y;
  for (let step = 0; step < FALLING_BLOCK_MAX_VERTICAL_CELLS && supportY >= WORLD_EDIT_MIN_Y; step += 1) {
    const below = cellByY.get(supportY);
    if (!below) return { ok: false, reason: "incomplete_column" };
    if (below.block !== "air") {
      floorProven = true;
      break;
    }
    supportY -= 1;
    if (supportY < WORLD_EDIT_MIN_Y) floorProven = true;
  }
  if (!floorProven) return { ok: false, reason: "incomplete_column" };
  const landingY = Math.max(WORLD_EDIT_MIN_Y, supportY + 1);
  const fallDistance = startY - landingY;
  if (fallDistance <= 0) return emptyResolution();

  const fallingCells: Readonly<AuthoritativeFallingBlockCell>[] = [];
  let cursorY = startY;
  for (let index = 0; index < FALLING_BLOCK_MAX_MOVES && cursorY <= WORLD_EDIT_MAX_Y; index += 1) {
    const cell = cellByY.get(cursorY);
    if (!cell) return { ok: false, reason: "incomplete_column" };
    if (!isFallingBlock(cell.block)) break;
    fallingCells.push(cell);
    cursorY += 1;
  }
  if (fallingCells.length < FALLING_BLOCK_MAX_MOVES && cursorY <= WORLD_EDIT_MAX_Y
    && !cellByY.has(cursorY)) {
    return { ok: false, reason: "incomplete_column" };
  }

  const moves: FallingBlockMove[] = fallingCells.map((cell) => ({
    block: cell.block as FallingBlockMaterial,
    source: {
      x: cell.x,
      y: cell.y,
      z: cell.z,
      coordKey: cell.coordKey,
      blockInstanceToken: cell.blockInstanceToken,
    },
    destination: {
      x: cell.x,
      y: cell.y - fallDistance,
      z: cell.z,
      coordKey: coordinateKey(cell.x, cell.y - fallDistance, cell.z),
    },
    fallDistance,
  }));
  const edits: FallingBlockEdit[] = [
    ...moves.map((move): FallingBlockEdit => ({
      phase: "vacate",
      ...move.source,
      block: "air",
      sourceCoordKey: move.source.coordKey,
    })),
    ...moves.map((move): FallingBlockEdit => ({
      phase: "settle",
      ...move.destination,
      block: move.block,
      sourceCoordKey: move.source.coordKey,
    })),
  ].map(({ blockInstanceToken: _ignored, ...edit }) => edit);

  const affectedKeys = new Set(edits.map((edit) => edit.coordKey));
  const finalState = new Map<string, "air" | FallingBlockMaterial>();
  for (const key of affectedKeys) {
    const cell = input.authoritativeCells.find((candidate) => candidate.coordKey === key);
    if (cell && (cell.block === "air" || isFallingBlock(cell.block))) finalState.set(key, cell.block);
  }
  for (const edit of edits) finalState.set(edit.coordKey, edit.block);
  const finalBlocks: Record<string, "air" | FallingBlockMaterial> = {};
  for (const [key, block] of [...finalState].sort((left, right) => {
    const leftY = Number(left[0].split(":")[1]);
    const rightY = Number(right[0].split(":")[1]);
    return leftY - rightY;
  })) finalBlocks[key] = block;

  return { ok: true, moves, edits, finalBlocks };
}
