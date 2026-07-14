export const WORLD_EDIT_CHUNK_SIZE = 8;
export const WORLD_EDIT_MIN_XZ = -64;
export const WORLD_EDIT_MAX_XZ = 64;
export const WORLD_EDIT_MIN_Y = -4;
export const WORLD_EDIT_MAX_Y = 64;
export const MAX_VISIBLE_WORLD_CHUNKS = 49;
export const MAX_WORLD_CHUNK_SNAPSHOT_BYTES = 16_384;
/** Five-bit v2 reserves code zero for an untouched cell. */
export const WORLD_CHUNK_CODEC_MAX_BLOCK_TYPES = 31;

export const WORLD_CHUNK_BLOCK_TYPES = [
  "air",
  "grass",
  "dirt",
  "stone",
  "wood",
  "leaves",
  "planks",
  "crafting_table",
  "torch",
  "chest",
  "bed",
  "door_closed",
  "door_open",
  "coal_ore",
  "iron_ore",
  "furnace",
  "ladder",
] as const;

export type WorldChunkBlockType = (typeof WORLD_CHUNK_BLOCK_TYPES)[number];

if (WORLD_CHUNK_BLOCK_TYPES.length > WORLD_CHUNK_CODEC_MAX_BLOCK_TYPES) {
  throw new Error("World chunk block palette exceeds the five-bit codec capacity.");
}

export interface WorldChunkEditInput {
  id?: string;
  x: number | string;
  y: number | string;
  z: number | string;
  blockType: string;
  editedAt?: string;
}

export interface DecodedWorldChunkEdit {
  coordKey: string;
  x: string;
  y: string;
  z: string;
  blockType: WorldChunkBlockType;
}

export type WorldChunkKeyValidation =
  | { ok: true; chunkKey: string; chunkX: number; chunkZ: number }
  | { ok: false; reason: "invalid_chunk_key" };

export type VisibleWorldChunkKeysValidation =
  | { ok: true; chunkKeys: string[] }
  | { ok: false; reason: "invalid_chunk_keys" | "too_many_chunks" };

export type WorldChunkSnapshotResult =
  | { ok: true; snapshotJson: string; editCount: number }
  | { ok: false; reason: "invalid_chunk_key" | "invalid_edit" | "invalid_snapshot" | "snapshot_too_large" };

export type WorldChunkDecodeResult =
  | { ok: true; edits: DecodedWorldChunkEdit[] }
  | { ok: false; reason: "invalid_chunk_key" | "invalid_snapshot" | "snapshot_too_large" };

const Y_LEVELS = WORLD_EDIT_MAX_Y - WORLD_EDIT_MIN_Y + 1;
const CELLS_PER_Y = WORLD_EDIT_CHUNK_SIZE * WORLD_EDIT_CHUNK_SIZE;
const CELL_COUNT = Y_LEVELS * CELLS_PER_Y;
const LEGACY_BLOCK_TYPE_COUNT = 13;
const LEGACY_PACKED_BYTE_COUNT = Math.ceil(CELL_COUNT / 2);
const CURRENT_BITS_PER_CELL = 5;
const CURRENT_CODE_MASK = (1 << CURRENT_BITS_PER_CELL) - 1;
const CURRENT_PACKED_BYTE_COUNT = Math.ceil(CELL_COUNT * CURRENT_BITS_PER_CELL / 8);
const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BLOCK_CODE = new Map<string, number>(WORLD_CHUNK_BLOCK_TYPES.map((block, index) => [block, index + 1]));

type PackedSnapshot = { version: 1 | 2; packed: Uint8Array };

export function worldEditChunkCoordinate(coordinate: number): number {
  return Math.floor(coordinate / WORLD_EDIT_CHUNK_SIZE);
}

export function worldEditChunkKey(x: number, z: number): string {
  return `${worldEditChunkCoordinate(x)}:${worldEditChunkCoordinate(z)}`;
}

export function validateWorldChunkKey(rawChunkKey: string): WorldChunkKeyValidation {
  const match = /^(-?\d{1,2}):(-?\d{1,2})$/.exec(rawChunkKey.trim());
  if (!match) return { ok: false, reason: "invalid_chunk_key" };
  const chunkX = Number(match[1]);
  const chunkZ = Number(match[2]);
  const minimumChunk = worldEditChunkCoordinate(WORLD_EDIT_MIN_XZ);
  const maximumChunk = worldEditChunkCoordinate(WORLD_EDIT_MAX_XZ);
  if (chunkX < minimumChunk || chunkX > maximumChunk || chunkZ < minimumChunk || chunkZ > maximumChunk) {
    return { ok: false, reason: "invalid_chunk_key" };
  }
  return { ok: true, chunkKey: `${chunkX}:${chunkZ}`, chunkX, chunkZ };
}

export function validateVisibleWorldChunkKeys(rawChunkKeys: unknown): VisibleWorldChunkKeysValidation {
  if (!Array.isArray(rawChunkKeys)) return { ok: false, reason: "invalid_chunk_keys" };
  if (rawChunkKeys.length > MAX_VISIBLE_WORLD_CHUNKS) return { ok: false, reason: "too_many_chunks" };
  const unique = new Set<string>();
  for (const raw of rawChunkKeys) {
    if (typeof raw !== "string") return { ok: false, reason: "invalid_chunk_keys" };
    const validation = validateWorldChunkKey(raw);
    if (!validation.ok) return { ok: false, reason: "invalid_chunk_keys" };
    unique.add(validation.chunkKey);
  }
  return { ok: true, chunkKeys: [...unique].sort(chunkKeyCompare) };
}

function chunkKeyCompare(a: string, b: string): number {
  const [ax, az] = a.split(":").map(Number);
  const [bx, bz] = b.split(":").map(Number);
  return ax - bx || az - bz;
}

function finiteInteger(value: number | string): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function cellIndex(x: number, y: number, z: number, chunkX: number, chunkZ: number): number | null {
  if (
    x < WORLD_EDIT_MIN_XZ || x > WORLD_EDIT_MAX_XZ
    || z < WORLD_EDIT_MIN_XZ || z > WORLD_EDIT_MAX_XZ
    || y < WORLD_EDIT_MIN_Y || y > WORLD_EDIT_MAX_Y
    || worldEditChunkCoordinate(x) !== chunkX
    || worldEditChunkCoordinate(z) !== chunkZ
  ) return null;
  const localX = x - chunkX * WORLD_EDIT_CHUNK_SIZE;
  const localZ = z - chunkZ * WORLD_EDIT_CHUNK_SIZE;
  return (y - WORLD_EDIT_MIN_Y) * CELLS_PER_Y + localZ * WORLD_EDIT_CHUNK_SIZE + localX;
}

function setNibble(packed: Uint8Array, index: number, code: number): void {
  const byteIndex = index >> 1;
  if ((index & 1) === 0) packed[byteIndex] = (packed[byteIndex] & 0xf0) | code;
  else packed[byteIndex] = (packed[byteIndex] & 0x0f) | (code << 4);
}

function getNibble(packed: Uint8Array, index: number): number {
  const value = packed[index >> 1];
  return (index & 1) === 0 ? value & 0x0f : value >> 4;
}

function setCurrentCode(packed: Uint8Array, index: number, code: number): void {
  const bitIndex = index * CURRENT_BITS_PER_CELL;
  const byteIndex = bitIndex >> 3;
  const shift = bitIndex & 7;
  packed[byteIndex] = (packed[byteIndex] & ~(CURRENT_CODE_MASK << shift)) | ((code << shift) & 0xff);
  if (shift > 8 - CURRENT_BITS_PER_CELL) {
    const firstBits = 8 - shift;
    const spillBits = CURRENT_BITS_PER_CELL - firstBits;
    const spillMask = (1 << spillBits) - 1;
    packed[byteIndex + 1] = (packed[byteIndex + 1] & ~spillMask) | ((code >> firstBits) & spillMask);
  }
}

function getCurrentCode(packed: Uint8Array, index: number): number {
  const bitIndex = index * CURRENT_BITS_PER_CELL;
  const byteIndex = bitIndex >> 3;
  const shift = bitIndex & 7;
  let code = packed[byteIndex] >> shift;
  if (shift > 8 - CURRENT_BITS_PER_CELL) code |= packed[byteIndex + 1] << (8 - shift);
  return code & CURRENT_CODE_MASK;
}

function getSnapshotCode(snapshot: PackedSnapshot, index: number): number {
  return snapshot.version === 1 ? getNibble(snapshot.packed, index) : getCurrentCode(snapshot.packed, index);
}

function migrateToCurrent(snapshot: PackedSnapshot): Uint8Array {
  if (snapshot.version === 2) return snapshot.packed.slice();
  const current = new Uint8Array(CURRENT_PACKED_BYTE_COUNT);
  for (let index = 0; index < CELL_COUNT; index += 1) setCurrentCode(current, index, getNibble(snapshot.packed, index));
  return current;
}

function encodeBase64(bytes: Uint8Array): string {
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index];
    const hasB = index + 1 < bytes.length;
    const hasC = index + 2 < bytes.length;
    const b = hasB ? bytes[index + 1] : 0;
    const c = hasC ? bytes[index + 2] : 0;
    output += BASE64[a >> 2];
    output += BASE64[((a & 3) << 4) | (b >> 4)];
    output += hasB ? BASE64[((b & 15) << 2) | (c >> 6)] : "=";
    output += hasC ? BASE64[c & 63] : "=";
  }
  return output;
}

function decodeBase64(value: string): Uint8Array | null {
  if (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return null;
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const output = new Uint8Array((value.length / 4) * 3 - padding);
  let outputIndex = 0;
  for (let index = 0; index < value.length; index += 4) {
    const a = BASE64.indexOf(value[index]);
    const b = BASE64.indexOf(value[index + 1]);
    const c = value[index + 2] === "=" ? 0 : BASE64.indexOf(value[index + 2]);
    const d = value[index + 3] === "=" ? 0 : BASE64.indexOf(value[index + 3]);
    if (a < 0 || b < 0 || c < 0 || d < 0) return null;
    if (outputIndex < output.length) output[outputIndex++] = (a << 2) | (b >> 4);
    if (outputIndex < output.length) output[outputIndex++] = ((b & 15) << 4) | (c >> 2);
    if (outputIndex < output.length) output[outputIndex++] = ((c & 3) << 6) | d;
  }
  return output;
}

function serializePacked(packed: Uint8Array): string {
  return JSON.stringify({ v: 2, cells: encodeBase64(packed) });
}

function parsePacked(snapshotJson: string): PackedSnapshot | null {
  if (snapshotJson.length > MAX_WORLD_CHUNK_SNAPSHOT_BYTES) return null;
  try {
    const parsed = JSON.parse(snapshotJson) as { v?: unknown; cells?: unknown };
    if ((parsed.v !== 1 && parsed.v !== 2) || typeof parsed.cells !== "string") return null;
    const packed = decodeBase64(parsed.cells);
    const expectedLength = parsed.v === 1 ? LEGACY_PACKED_BYTE_COUNT : CURRENT_PACKED_BYTE_COUNT;
    return packed?.length === expectedLength ? { version: parsed.v, packed } : null;
  } catch {
    return null;
  }
}

function editOrder(edit: WorldChunkEditInput): [number, string] {
  const timestamp = Number(edit.editedAt ?? "0");
  return [Number.isFinite(timestamp) ? timestamp : 0, edit.id ?? ""];
}

function isLaterEdit(candidate: WorldChunkEditInput, previous: WorldChunkEditInput): boolean {
  const [candidateTime, candidateId] = editOrder(candidate);
  const [previousTime, previousId] = editOrder(previous);
  return candidateTime > previousTime || (candidateTime === previousTime && candidateId > previousId);
}

export function createWorldChunkSnapshot(
  rawChunkKey: string,
  edits: readonly WorldChunkEditInput[],
): WorldChunkSnapshotResult {
  const chunk = validateWorldChunkKey(rawChunkKey);
  if (!chunk.ok) return { ok: false, reason: chunk.reason };
  const latest = new Map<number, WorldChunkEditInput>();
  for (const edit of edits) {
    const x = finiteInteger(edit.x);
    const y = finiteInteger(edit.y);
    const z = finiteInteger(edit.z);
    const code = BLOCK_CODE.get(edit.blockType);
    if (x === null || y === null || z === null || code === undefined) continue;
    const index = cellIndex(x, y, z, chunk.chunkX, chunk.chunkZ);
    if (index === null) continue;
    const previous = latest.get(index);
    if (!previous || isLaterEdit(edit, previous)) latest.set(index, edit);
  }
  const packed = new Uint8Array(CURRENT_PACKED_BYTE_COUNT);
  for (const [index, edit] of latest) setCurrentCode(packed, index, BLOCK_CODE.get(edit.blockType) as number);
  const snapshotJson = serializePacked(packed);
  return snapshotJson.length <= MAX_WORLD_CHUNK_SNAPSHOT_BYTES
    ? { ok: true, snapshotJson, editCount: latest.size }
    : { ok: false, reason: "snapshot_too_large" };
}

export function applyWorldChunkEdit(
  rawChunkKey: string,
  snapshotJson: string,
  edit: WorldChunkEditInput,
): WorldChunkSnapshotResult {
  const chunk = validateWorldChunkKey(rawChunkKey);
  if (!chunk.ok) return { ok: false, reason: chunk.reason };
  if (snapshotJson.length > MAX_WORLD_CHUNK_SNAPSHOT_BYTES) return { ok: false, reason: "snapshot_too_large" };
  const previous = parsePacked(snapshotJson);
  if (!previous) return { ok: false, reason: "invalid_snapshot" };
  const x = finiteInteger(edit.x);
  const y = finiteInteger(edit.y);
  const z = finiteInteger(edit.z);
  const code = BLOCK_CODE.get(edit.blockType);
  if (x === null || y === null || z === null || code === undefined) return { ok: false, reason: "invalid_edit" };
  const index = cellIndex(x, y, z, chunk.chunkX, chunk.chunkZ);
  if (index === null) return { ok: false, reason: "invalid_edit" };
  const packed = migrateToCurrent(previous);
  setCurrentCode(packed, index, code);
  const nextSnapshotJson = serializePacked(packed);
  let editCount = 0;
  for (let cell = 0; cell < CELL_COUNT; cell += 1) if (getCurrentCode(packed, cell) !== 0) editCount += 1;
  return { ok: true, snapshotJson: nextSnapshotJson, editCount };
}

export function decodeWorldChunkSnapshot(rawChunkKey: string, snapshotJson: string): WorldChunkDecodeResult {
  const chunk = validateWorldChunkKey(rawChunkKey);
  if (!chunk.ok) return { ok: false, reason: chunk.reason };
  if (snapshotJson.length > MAX_WORLD_CHUNK_SNAPSHOT_BYTES) return { ok: false, reason: "snapshot_too_large" };
  const snapshot = parsePacked(snapshotJson);
  if (!snapshot) return { ok: false, reason: "invalid_snapshot" };
  const edits: DecodedWorldChunkEdit[] = [];
  for (let index = 0; index < CELL_COUNT; index += 1) {
    const code = getSnapshotCode(snapshot, index);
    if (code === 0) continue;
    if (snapshot.version === 1 && code > LEGACY_BLOCK_TYPE_COUNT) return { ok: false, reason: "invalid_snapshot" };
    const blockType = WORLD_CHUNK_BLOCK_TYPES[code - 1];
    if (!blockType) return { ok: false, reason: "invalid_snapshot" };
    const yOffset = Math.floor(index / CELLS_PER_Y);
    const horizontal = index % CELLS_PER_Y;
    const localZ = Math.floor(horizontal / WORLD_EDIT_CHUNK_SIZE);
    const localX = horizontal % WORLD_EDIT_CHUNK_SIZE;
    const x = chunk.chunkX * WORLD_EDIT_CHUNK_SIZE + localX;
    const y = WORLD_EDIT_MIN_Y + yOffset;
    const z = chunk.chunkZ * WORLD_EDIT_CHUNK_SIZE + localZ;
    edits.push({ coordKey: `${x}:${y}:${z}`, x: String(x), y: String(y), z: String(z), blockType });
  }
  return { ok: true, edits };
}
