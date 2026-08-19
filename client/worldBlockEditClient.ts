import type { ItemId } from "../shared/game.ts";
import {
  isReplaceableWorldBlock,
  isToggleableWorldBlock,
  toggledWorldBlock,
  type WorldBlockOperationRequest,
} from "../shared/worldBlockOperations.ts";
import type { WorldChunkBlockType } from "../shared/worldChunks.ts";

export type WorldBlockEditPose = {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
};

export type SerializedWorldBlockEditPose = readonly [
  x: string,
  y: string,
  z: string,
  yaw: string,
  pitch: string,
];

export type WorldBlockRequestInput = {
  operationId: string;
  x: number;
  y: number;
  z: number;
  previousBlock: WorldChunkBlockType;
  nextBlock: WorldChunkBlockType;
  selectedHotbar: number;
  expectedHeldItem: ItemId | null;
  expectedInventoryRevision: string;
  expectedChunkRevision: string;
};

export type ClientWorldEdit = { x: number; y: number; z: number; block: number };

export function createWorldBlockOperationId(
  sequence: number,
  now = Date.now(),
  randomPart = typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID().replaceAll("-", "")
    : Math.floor(Math.random() * Number.MAX_SAFE_INTEGER).toString(36),
): string {
  const safeSequence = Math.max(0, Math.floor(sequence)).toString(36);
  const safeRandom = randomPart.replace(/[^A-Za-z0-9_-]/g, "").padEnd(16, "0");
  return `block_${Math.max(0, Math.floor(now)).toString(36)}_${safeSequence}_${safeRandom}`.slice(0, 64);
}

export function serializeWorldBlockEditPose(pose: WorldBlockEditPose): SerializedWorldBlockEditPose {
  return [String(pose.x), String(pose.y), String(pose.z), String(pose.yaw), String(pose.pitch)];
}

export function buildWorldBlockOperationRequest(
  input: WorldBlockRequestInput,
): WorldBlockOperationRequest | null {
  const base = {
    operationId: input.operationId,
    x: input.x,
    y: input.y,
    z: input.z,
  };
  const previousToggle = isToggleableWorldBlock(input.previousBlock) ? input.previousBlock : null;
  const togglesBlock = previousToggle !== null
    && isToggleableWorldBlock(input.nextBlock)
    && toggledWorldBlock(previousToggle) === input.nextBlock;
  if (togglesBlock) {
    return {
      ...base,
      kind: "toggle",
      expectedBlock: previousToggle,
      expectedChunkRevision: input.expectedChunkRevision,
    };
  }
  const inventoryFields = {
    selectedHotbar: input.selectedHotbar,
    expectedHeldItem: input.expectedHeldItem,
    expectedInventoryRevision: input.expectedInventoryRevision,
    expectedChunkRevision: input.expectedChunkRevision,
  };
  if (input.nextBlock === "air" && input.previousBlock !== "air") {
    return {
      ...base,
      ...inventoryFields,
      kind: "mine",
      expectedBlock: input.previousBlock,
    };
  }
  if (isReplaceableWorldBlock(input.previousBlock) && input.nextBlock !== "air") {
    return {
      ...base,
      ...inventoryFields,
      kind: "place",
      expectedBlock: input.previousBlock,
      placedBlock: input.nextBlock,
    };
  }
  return null;
}

/** Appending the pending edit makes it win over a stale authoritative snapshot. */
export function overlayPendingWorldBlockEdit<T extends ClientWorldEdit>(
  authoritative: readonly T[],
  pending: T | null,
): T[] {
  return pending ? [...authoritative, pending] : [...authoritative];
}

export function isDecimalRevisionAtLeast(value: string, expected: string): boolean {
  if (!/^(0|[1-9]\d{0,15})$/.test(value) || !/^(0|[1-9]\d{0,15})$/.test(expected)) return false;
  const parsed = Number(value);
  const parsedExpected = Number(expected);
  return Number.isSafeInteger(parsed) && Number.isSafeInteger(parsedExpected) && parsed >= parsedExpected;
}

/** A transport failure gets exactly one replay with the byte-identical arguments. */
export async function invokeWorldBlockEditWithOneRetry<T>(
  invoke: (...args: [string, string, string, string, string, string]) => Promise<T>,
  args: readonly [string, string, string, string, string, string],
): Promise<{ result: T; attempts: 1 | 2 }> {
  try {
    return { result: await invoke(...args), attempts: 1 };
  } catch {
    return { result: await invoke(...args), attempts: 2 };
  }
}
