import { OAK_TREE_MAX_EDITS, type OakTreeGrowthEdit } from "../shared/treeGrowth.ts";
import { WORLD_CHUNK_BLOCK_TYPES, worldEditChunkKey, type WorldChunkBlockType } from "../shared/worldChunks.ts";

export const MAX_TREE_GROWTH_RECEIPTS_PER_USER = 32;
export const TREE_GROWTH_RECEIPT_PRUNE_LIMIT = 8;
export const TREE_GROWTH_RECEIPT_TTL_MS = 15 * 60 * 1_000;
export const MAX_TREE_GROWTH_CHUNKS = 4;

const MAX_TREE_GROWTH_RECEIPT_BYTES = 32_768;

export type TreeGrowthChunkRevision = {
  chunkKey: string;
  revision: string;
};

export type TreeGrowthReceiptResult = {
  ok: true;
  replayed: false;
  operationId: string;
  x: number;
  y: number;
  z: number;
  consumed: "bone_meal";
  inventoryRevision: string;
  edits: Array<{ x: number; y: number; z: number; blockType: WorldChunkBlockType }>;
  chunks: TreeGrowthChunkRevision[];
  serverNow: number;
};

export function isValidTreeGrowthOperationId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(value);
}

export function treeGrowthFingerprint(
  operationId: string,
  x: number,
  y: number,
  z: number,
): string {
  return JSON.stringify([1, operationId, x, y, z]);
}

export function treeGrowthProtocolEdit(edit: OakTreeGrowthEdit): TreeGrowthReceiptResult["edits"][number] {
  return {
    x: edit.x,
    y: edit.y,
    z: edit.z,
    blockType: edit.block === "log" ? "wood" : edit.block,
  } as TreeGrowthReceiptResult["edits"][number];
}

export function encodeTreeGrowthReceipt(result: TreeGrowthReceiptResult): string {
  return JSON.stringify(result);
}

export function decodeTreeGrowthReceipt(raw: string): TreeGrowthReceiptResult | null {
  if (typeof raw !== "string" || raw.length > MAX_TREE_GROWTH_RECEIPT_BYTES) return null;
  try {
    const value = JSON.parse(raw) as Partial<TreeGrowthReceiptResult>;
    if (!value || value.ok !== true || value.replayed !== false
      || !isValidTreeGrowthOperationId(value.operationId)
      || !Number.isSafeInteger(value.x) || !Number.isSafeInteger(value.y) || !Number.isSafeInteger(value.z)
      || value.consumed !== "bone_meal"
      || typeof value.inventoryRevision !== "string" || !/^\d{1,16}$/.test(value.inventoryRevision)
      || !Number.isSafeInteger(value.serverNow) || (value.serverNow as number) < 0
      || !Array.isArray(value.edits) || value.edits.length === 0 || value.edits.length > OAK_TREE_MAX_EDITS
      || value.edits.some((edit) => !edit || !Number.isSafeInteger(edit.x) || !Number.isSafeInteger(edit.y)
        || !Number.isSafeInteger(edit.z) || (edit.blockType !== "wood" && edit.blockType !== "leaves")
        || !WORLD_CHUNK_BLOCK_TYPES.includes(edit.blockType))
      || !Array.isArray(value.chunks) || value.chunks.length === 0 || value.chunks.length > MAX_TREE_GROWTH_CHUNKS
      || value.chunks.some((chunk) => !chunk || typeof chunk.chunkKey !== "string"
        || !/^-?\d+:-?\d+$/.test(chunk.chunkKey) || typeof chunk.revision !== "string"
        || !/^\d{1,16}$/.test(chunk.revision))) return null;
    const edits = value.edits as TreeGrowthReceiptResult["edits"];
    const chunks = value.chunks as TreeGrowthReceiptResult["chunks"];
    const editKeys = new Set(edits.map((edit) => `${edit.x}:${edit.y}:${edit.z}`));
    const chunkKeys = new Set(chunks.map((chunk) => chunk.chunkKey));
    if (editKeys.size !== edits.length || chunkKeys.size !== chunks.length
      || !edits.some((edit) => edit.x === value.x && edit.y === value.y && edit.z === value.z && edit.blockType === "wood")
      || edits.some((edit) => !chunkKeys.has(worldEditChunkKey(edit.x, edit.z)))) return null;
    return value as TreeGrowthReceiptResult;
  } catch {
    return null;
  }
}

export function selectTreeGrowthReceiptOverflow(
  newestRows: readonly { id: string }[],
  committedReceiptId: string,
): string[] {
  const kept = new Set(
    newestRows.slice(0, MAX_TREE_GROWTH_RECEIPTS_PER_USER).map((row) => row.id),
  );
  kept.add(committedReceiptId);
  return newestRows
    .filter((row) => row.id !== committedReceiptId && !kept.has(row.id))
    .slice(0, TREE_GROWTH_RECEIPT_PRUNE_LIMIT)
    .map((row) => row.id);
}
