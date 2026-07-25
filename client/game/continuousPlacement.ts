import { BLOCK, type BlockId } from "./types.ts";

export const CONTINUOUS_PLACEMENT_INTERVAL_MS = 200;

export interface SecondaryPlacementHoldState {
  armed: boolean;
  lastAttemptAt: number;
}

export const IDLE_SECONDARY_PLACEMENT_HOLD: Readonly<SecondaryPlacementHoldState> = Object.freeze({
  armed: false,
  lastAttemptAt: 0,
});

/** Utility and stateful blocks remain discrete even when they reach the ordinary placement branch. */
export function isContinuousPlacementBlock(block: BlockId): boolean {
  switch (block) {
    case BLOCK.AIR:
    case BLOCK.CRAFTING_TABLE:
    case BLOCK.CHEST:
    case BLOCK.DOOR_CLOSED:
    case BLOCK.DOOR_OPEN:
    case BLOCK.BED:
    case BLOCK.FURNACE:
    case BLOCK.TNT:
    case BLOCK.SAPLING:
    case BLOCK.OAK_FENCE_GATE_CLOSED:
    case BLOCK.OAK_FENCE_GATE_OPEN:
      return false;
    default:
      return true;
  }
}

export function pressSecondaryPlacement(
  accepted: boolean,
  block: BlockId,
  now: number,
): Readonly<SecondaryPlacementHoldState> {
  return accepted && isContinuousPlacementBlock(block) && Number.isFinite(now)
    ? { armed: true, lastAttemptAt: now }
    : IDLE_SECONDARY_PLACEMENT_HOLD;
}

export function shouldRepeatSecondaryPlacement(
  state: Readonly<SecondaryPlacementHoldState>,
  now: number,
): boolean {
  return state.armed
    && Number.isFinite(now)
    && now - state.lastAttemptAt >= CONTINUOUS_PLACEMENT_INTERVAL_MS;
}

/** Records every due attempt so rejected targets cannot create a frame-rate retry storm. */
export function advanceSecondaryPlacement(
  state: Readonly<SecondaryPlacementHoldState>,
  now: number,
): Readonly<SecondaryPlacementHoldState> {
  return state.armed && Number.isFinite(now) ? { armed: true, lastAttemptAt: now } : state;
}

export function releaseSecondaryPlacement(): Readonly<SecondaryPlacementHoldState> {
  return IDLE_SECONDARY_PLACEMENT_HOLD;
}
