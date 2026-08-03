
import * as BS from "./bundleStrings.ts";
export const WORLD_EDIT_CHUNK_SIZE = 8;
export const WORLD_EDIT_MIN_XZ = -1_000_000;
export const WORLD_EDIT_MAX_XZ = 1_000_000;
/** Natural bedrock occupies this layer; persisted edits must stay above it. */
export const WORLD_EDIT_MIN_Y = 0;
export const WORLD_EDIT_MAX_Y = 128;
export const WORLD_CHUNK_SECTION_HEIGHT = 8;
export const WORLD_CHUNK_CODEC_VERSION = 4;
export const MAX_VISIBLE_WORLD_CHUNKS = 49;
export const MAX_WORLD_CHUNK_SNAPSHOT_BYTES = 16_384;
/** Current snapshots reserve code zero for an untouched cell. */
export const WORLD_CHUNK_CODEC_BITS_PER_CELL = 6;
export const WORLD_CHUNK_CODEC_MAX_BLOCK_TYPES = (1 << WORLD_CHUNK_CODEC_BITS_PER_CELL) - 1;

export const WORLD_CHUNK_BLOCK_TYPES = [
  "air",
  "grass",
  "dirt",
  "stone",
  "wood",
  "leaves",
  "planks",
  BS.craftingTable,
  "torch",
  "chest",
  "bed",
  BS.doorClosed,
  BS.doorOpen,
  BS.coalOre,
  BS.ironOre,
  "furnace",
  "ladder",
  BS.cobblestone,
  "sand",
  "glass",
  /** Append-only palette: v1/v2 and deployed v3 codes must never be renumbered. */
  BS.goldOre,
  BS.diamondOre,
  "tnt",
  "gravel",
  "wool",
  "sapling",
  BS.stoneBricks,
  BS.oakFence,
  BS.oakFenceGateClosed,
  BS.oakFenceGateOpen,
  BS.stoneBrickSlab,
  "clay",
  "bricks",
] as const;

export type WorldChunkBlockType = (typeof WORLD_CHUNK_BLOCK_TYPES)[number];

if (WORLD_CHUNK_BLOCK_TYPES.length > WORLD_CHUNK_CODEC_MAX_BLOCK_TYPES) {
  throw new Error("World chunk block palette exceeds the current codec capacity.");
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

export type WorldChunkTargetedSampleResult =
  | { ok: true; blocks: Array<WorldChunkBlockType | null> }
  | { ok: false; reason: "invalid_chunk_key" | "invalid_sample" | "invalid_snapshot" | "snapshot_too_large" };

/** Production v1/v2 rows covered this exact fixed-height column. */
const LEGACY_MIN_Y = -4;
const LEGACY_MAX_Y = 64;
const LEGACY_Y_LEVELS = LEGACY_MAX_Y - LEGACY_MIN_Y + 1;
const CELLS_PER_Y = WORLD_EDIT_CHUNK_SIZE * WORLD_EDIT_CHUNK_SIZE;
const LEGACY_CELL_COUNT = LEGACY_Y_LEVELS * CELLS_PER_Y;
const LEGACY_BLOCK_TYPE_COUNT = 13;
const LEGACY_PACKED_BYTE_COUNT = Math.ceil(LEGACY_CELL_COUNT / 2);
const LEGACY_V2_V3_BITS_PER_CELL = 5;
const CURRENT_BITS_PER_CELL = WORLD_CHUNK_CODEC_BITS_PER_CELL;
const LEGACY_V2_PACKED_BYTE_COUNT = Math.ceil(LEGACY_CELL_COUNT * LEGACY_V2_V3_BITS_PER_CELL / 8);
const SECTION_CELL_COUNT = WORLD_CHUNK_SECTION_HEIGHT * CELLS_PER_Y;
const SECTION_PACKED_BYTE_COUNT = Math.ceil(SECTION_CELL_COUNT * CURRENT_BITS_PER_CELL / 8);
const LEGACY_V3_SECTION_PACKED_BYTE_COUNT = Math.ceil(SECTION_CELL_COUNT * LEGACY_V2_V3_BITS_PER_CELL / 8);
const MIN_SECTION_Y = Math.floor(WORLD_EDIT_MIN_Y / WORLD_CHUNK_SECTION_HEIGHT);
const MAX_SECTION_Y = Math.floor(WORLD_EDIT_MAX_Y / WORLD_CHUNK_SECTION_HEIGHT);
const MAX_SECTION_COUNT = MAX_SECTION_Y - MIN_SECTION_Y + 1;
const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BLOCK_CODE = new Map<string, number>(WORLD_CHUNK_BLOCK_TYPES.map((block, index) => [block, index + 1]));

type LegacyPackedSnapshot = { version: 1 | 2; packed: Uint8Array };
type SectionedSnapshot = { version: 3 | 4; sections: Map<number, Uint8Array> };
type PackedSnapshot = LegacyPackedSnapshot | SectionedSnapshot;

interface CellAddress {
  sectionY: number;
  sectionIndex: number;
  absoluteIndex: number;
}

/** Explicit fence: future writers must not accidentally make a deployed codec unreadable. */
function isSectionedCodecVersion(value: unknown): value is SectionedSnapshot["version"] {
  return value === 3 || value === 4;
}

export function worldEditChunkCoordinate(coordinate: number): number {
  return Math.floor(coordinate / WORLD_EDIT_CHUNK_SIZE);
}

export function worldEditChunkKey(x: number, z: number): string {
  return `${worldEditChunkCoordinate(x)}:${worldEditChunkCoordinate(z)}`;
}

export function validateWorldChunkKey(rawChunkKey: string): WorldChunkKeyValidation {
  const match = /^(-?\d{1,6}):(-?\d{1,6})$/.exec(rawChunkKey.trim());
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
  if (!Array.isArray(rawChunkKeys)) return { ok: false, reason: BS.invalidChunkKeys };
  if (rawChunkKeys.length > MAX_VISIBLE_WORLD_CHUNKS) return { ok: false, reason: "too_many_chunks" };
  const unique = new Set<string>();
  for (const raw of rawChunkKeys) {
    if (!BS.isString(raw)) return { ok: false, reason: BS.invalidChunkKeys };
    const validation = validateWorldChunkKey(raw);
    if (!validation.ok) return { ok: false, reason: BS.invalidChunkKeys };
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
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function cellAddress(x: number, y: number, z: number, chunkX: number, chunkZ: number): CellAddress | null {
  if (
    x < WORLD_EDIT_MIN_XZ || x > WORLD_EDIT_MAX_XZ
    || z < WORLD_EDIT_MIN_XZ || z > WORLD_EDIT_MAX_XZ
    || y < WORLD_EDIT_MIN_Y || y > WORLD_EDIT_MAX_Y
    || worldEditChunkCoordinate(x) !== chunkX
    || worldEditChunkCoordinate(z) !== chunkZ
  ) return null;
  const localX = x - chunkX * WORLD_EDIT_CHUNK_SIZE;
  const localZ = z - chunkZ * WORLD_EDIT_CHUNK_SIZE;
  const sectionY = Math.floor(y / WORLD_CHUNK_SECTION_HEIGHT);
  const localY = y - sectionY * WORLD_CHUNK_SECTION_HEIGHT;
  const horizontal = localZ * WORLD_EDIT_CHUNK_SIZE + localX;
  return {
    sectionY,
    sectionIndex: localY * CELLS_PER_Y + horizontal,
    absoluteIndex: (y - WORLD_EDIT_MIN_Y) * CELLS_PER_Y + horizontal,
  };
}

function getNibble(packed: Uint8Array, index: number): number {
  const value = packed[index >> 1];
  return (index & 1) === 0 ? value & 0x0f : value >> 4;
}

function setPackedCode(packed: Uint8Array, index: number, code: number, bitsPerCell: number): void {
  const codeMask = (1 << bitsPerCell) - 1;
  const bitIndex = index * bitsPerCell;
  const byteIndex = bitIndex >> 3;
  const shift = bitIndex & 7;
  packed[byteIndex] = (packed[byteIndex] & ~(codeMask << shift)) | ((code << shift) & 0xff);
  if (shift > 8 - bitsPerCell) {
    const firstBits = 8 - shift;
    const spillBits = bitsPerCell - firstBits;
    const spillMask = (1 << spillBits) - 1;
    packed[byteIndex + 1] = (packed[byteIndex + 1] & ~spillMask) | ((code >> firstBits) & spillMask);
  }
}

function getPackedCode(packed: Uint8Array, index: number, bitsPerCell: number): number {
  const bitIndex = index * bitsPerCell;
  const byteIndex = bitIndex >> 3;
  const shift = bitIndex & 7;
  let code = packed[byteIndex] >> shift;
  if (shift > 8 - bitsPerCell) code |= packed[byteIndex + 1] << (8 - shift);
  return code & ((1 << bitsPerCell) - 1);
}

function setCurrentCode(packed: Uint8Array, index: number, code: number): void {
  setPackedCode(packed, index, code, CURRENT_BITS_PER_CELL);
}

function getCurrentCode(packed: Uint8Array, index: number): number {
  return getPackedCode(packed, index, CURRENT_BITS_PER_CELL);
}

function getLegacyFiveBitCode(packed: Uint8Array, index: number): number {
  return getPackedCode(packed, index, LEGACY_V2_V3_BITS_PER_CELL);
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

function sectionHasEdits(section: Uint8Array): boolean {
  for (let index = 0; index < SECTION_CELL_COUNT; index += 1) {
    if (getCurrentCode(section, index) !== 0) return true;
  }
  return false;
}

function serializeSections(sections: Map<number, Uint8Array>): string {
  return JSON.stringify({
    v: WORLD_CHUNK_CODEC_VERSION,
    sections: [...sections.entries()]
      .filter(([, packed]) => sectionHasEdits(packed))
      .sort(([left], [right]) => left - right)
      .map(([y, packed]) => ({ y, cells: encodeBase64(packed) })),
  });
}

function parsePacked(snapshotJson: string): PackedSnapshot | null {
  if (snapshotJson.length > MAX_WORLD_CHUNK_SNAPSHOT_BYTES) return null;
  try {
    const parsed = JSON.parse(snapshotJson) as { v?: unknown; cells?: unknown; sections?: unknown };
    if (parsed.v === 1 || parsed.v === 2) {
      if (!BS.isString(parsed.cells)) return null;
      const packed = decodeBase64(parsed.cells);
      const expectedLength = parsed.v === 1 ? LEGACY_PACKED_BYTE_COUNT : LEGACY_V2_PACKED_BYTE_COUNT;
      return packed?.length === expectedLength ? { version: parsed.v, packed } : null;
    }
    if (!isSectionedCodecVersion(parsed.v) || !Array.isArray(parsed.sections)) return null;
    if (parsed.sections.length > MAX_SECTION_COUNT) return null;
    const sectionPackedByteCount = parsed.v === 3
      ? LEGACY_V3_SECTION_PACKED_BYTE_COUNT
      : SECTION_PACKED_BYTE_COUNT;
    const sections = new Map<number, Uint8Array>();
    for (const rawSection of parsed.sections) {
      if (!rawSection || typeof rawSection !== "object") return null;
      const section = rawSection as { y?: unknown; cells?: unknown };
      if (!Number.isInteger(section.y) || Number(section.y) < MIN_SECTION_Y || Number(section.y) > MAX_SECTION_Y) return null;
      if (!BS.isString(section.cells) || sections.has(Number(section.y))) return null;
      const packed = decodeBase64(section.cells);
      if (!packed || packed.length !== sectionPackedByteCount) return null;
      sections.set(Number(section.y), packed);
    }
    return { version: parsed.v, sections };
  } catch {
    return null;
  }
}

function snapshotToSections(snapshot: PackedSnapshot): Map<number, Uint8Array> | null {
  // Migration-only sanitation: old packed rows may contain edits at the newly
  // reserved y=0 foundation. Decoding hides those cells; all current writers
  // reject the same coordinates before mutation.
  if (snapshot.version === 3 || snapshot.version === 4) {
    const sections = new Map<number, Uint8Array>();
    for (const [y, packed] of snapshot.sections) {
      const nextPacked = snapshot.version === 4
        ? packed.slice()
        : new Uint8Array(SECTION_PACKED_BYTE_COUNT);
      for (let index = 0; index < SECTION_CELL_COUNT; index += 1) {
        const code = snapshot.version === 3
          ? getLegacyFiveBitCode(packed, index)
          : getCurrentCode(packed, index);
        if (code > WORLD_CHUNK_BLOCK_TYPES.length) return null;
        const absoluteY = y * WORLD_CHUNK_SECTION_HEIGHT + Math.floor(index / CELLS_PER_Y);
        if (code !== 0 && (absoluteY < WORLD_EDIT_MIN_Y || absoluteY > WORLD_EDIT_MAX_Y)) return null;
        if (absoluteY === WORLD_EDIT_MIN_Y) {
          if (snapshot.version === 4 && code !== 0) setCurrentCode(nextPacked, index, 0);
          continue;
        }
        if (snapshot.version === 3 && code !== 0) setCurrentCode(nextPacked, index, code);
      }
      sections.set(y, nextPacked);
    }
    return sections;
  }
  const sections = new Map<number, Uint8Array>();
  for (let index = 0; index < LEGACY_CELL_COUNT; index += 1) {
    const code = snapshot.version === 1 ? getNibble(snapshot.packed, index) : getLegacyFiveBitCode(snapshot.packed, index);
    if (code === 0) continue;
    if (snapshot.version === 1 && code > LEGACY_BLOCK_TYPE_COUNT) return null;
    if (!WORLD_CHUNK_BLOCK_TYPES[code - 1]) return null;
    const yOffset = Math.floor(index / CELLS_PER_Y);
    const horizontal = index % CELLS_PER_Y;
    const y = LEGACY_MIN_Y + yOffset;
    if (y <= WORLD_EDIT_MIN_Y || y > WORLD_EDIT_MAX_Y) continue;
    const sectionY = Math.floor(y / WORLD_CHUNK_SECTION_HEIGHT);
    const localY = y - sectionY * WORLD_CHUNK_SECTION_HEIGHT;
    const packed = sections.get(sectionY) ?? new Uint8Array(SECTION_PACKED_BYTE_COUNT);
    setCurrentCode(packed, localY * CELLS_PER_Y + horizontal, code);
    sections.set(sectionY, packed);
  }
  return sections;
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

function countSectionEdits(sections: Map<number, Uint8Array>): number {
  let count = 0;
  for (const packed of sections.values()) {
    for (let index = 0; index < SECTION_CELL_COUNT; index += 1) {
      if (getCurrentCode(packed, index) !== 0) count += 1;
    }
  }
  return count;
}

export function createWorldChunkSnapshot(
  rawChunkKey: string,
  edits: readonly WorldChunkEditInput[],
): WorldChunkSnapshotResult {
  const chunk = validateWorldChunkKey(rawChunkKey);
  if (!chunk.ok) return { ok: false, reason: chunk.reason };
  const latest = new Map<number, { edit: WorldChunkEditInput; address: CellAddress }>();
  for (const edit of edits) {
    const x = finiteInteger(edit.x);
    const y = finiteInteger(edit.y);
    const z = finiteInteger(edit.z);
    const code = BLOCK_CODE.get(edit.blockType);
    if (y === WORLD_EDIT_MIN_Y || edit.blockType === "bedrock") return { ok: false, reason: "invalid_edit" };
    if (x === null || y === null || z === null || code === undefined) continue;
    const address = cellAddress(x, y, z, chunk.chunkX, chunk.chunkZ);
    if (!address) continue;
    const previous = latest.get(address.absoluteIndex);
    if (!previous || isLaterEdit(edit, previous.edit)) latest.set(address.absoluteIndex, { edit, address });
  }
  const sections = new Map<number, Uint8Array>();
  for (const { edit, address } of latest.values()) {
    const packed = sections.get(address.sectionY) ?? new Uint8Array(SECTION_PACKED_BYTE_COUNT);
    setCurrentCode(packed, address.sectionIndex, BLOCK_CODE.get(edit.blockType) as number);
    sections.set(address.sectionY, packed);
  }
  const snapshotJson = serializeSections(sections);
  return snapshotJson.length <= MAX_WORLD_CHUNK_SNAPSHOT_BYTES
    ? { ok: true, snapshotJson, editCount: latest.size }
    : { ok: false, reason: "snapshot_too_large" };
}

export function applyWorldChunkEdit(
  rawChunkKey: string,
  snapshotJson: string,
  edit: WorldChunkEditInput,
): WorldChunkSnapshotResult {
  return applyWorldChunkEdits(rawChunkKey, snapshotJson, [edit]);
}

/** Applies a bounded transaction's edits while decoding/encoding the chunk once. */
export function applyWorldChunkEdits(
  rawChunkKey: string,
  snapshotJson: string,
  edits: readonly WorldChunkEditInput[],
): WorldChunkSnapshotResult {
  const chunk = validateWorldChunkKey(rawChunkKey);
  if (!chunk.ok) return { ok: false, reason: chunk.reason };
  if (snapshotJson.length > MAX_WORLD_CHUNK_SNAPSHOT_BYTES) return { ok: false, reason: "snapshot_too_large" };
  const previous = parsePacked(snapshotJson);
  if (!previous) return { ok: false, reason: BS.invalidSnapshot };
  const sections = snapshotToSections(previous);
  if (!sections) return { ok: false, reason: BS.invalidSnapshot };
  for (const edit of edits) {
    const x = finiteInteger(edit.x);
    const y = finiteInteger(edit.y);
    const z = finiteInteger(edit.z);
    const code = BLOCK_CODE.get(edit.blockType);
    if (x === null || y === null || z === null || code === undefined
      || y === WORLD_EDIT_MIN_Y || edit.blockType === "bedrock") return { ok: false, reason: "invalid_edit" };
    const address = cellAddress(x, y, z, chunk.chunkX, chunk.chunkZ);
    if (!address) return { ok: false, reason: "invalid_edit" };
    const packed = sections.get(address.sectionY) ?? new Uint8Array(SECTION_PACKED_BYTE_COUNT);
    setCurrentCode(packed, address.sectionIndex, code);
    sections.set(address.sectionY, packed);
  }
  const nextSnapshotJson = serializeSections(sections);
  if (nextSnapshotJson.length > MAX_WORLD_CHUNK_SNAPSHOT_BYTES) return { ok: false, reason: "snapshot_too_large" };
  return { ok: true, snapshotJson: nextSnapshotJson, editCount: countSectionEdits(sections) };
}

export function decodeWorldChunkSnapshot(rawChunkKey: string, snapshotJson: string): WorldChunkDecodeResult {
  const chunk = validateWorldChunkKey(rawChunkKey);
  if (!chunk.ok) return { ok: false, reason: chunk.reason };
  if (snapshotJson.length > MAX_WORLD_CHUNK_SNAPSHOT_BYTES) return { ok: false, reason: "snapshot_too_large" };
  const snapshot = parsePacked(snapshotJson);
  if (!snapshot) return { ok: false, reason: BS.invalidSnapshot };
  const sections = snapshotToSections(snapshot);
  if (!sections) return { ok: false, reason: BS.invalidSnapshot };
  const edits: DecodedWorldChunkEdit[] = [];
  for (const [sectionY, packed] of [...sections.entries()].sort(([left], [right]) => left - right)) {
    for (let index = 0; index < SECTION_CELL_COUNT; index += 1) {
      const code = getCurrentCode(packed, index);
      if (code === 0) continue;
      const blockType = WORLD_CHUNK_BLOCK_TYPES[code - 1];
      if (!blockType) return { ok: false, reason: BS.invalidSnapshot };
      const localY = Math.floor(index / CELLS_PER_Y);
      const horizontal = index % CELLS_PER_Y;
      const localZ = Math.floor(horizontal / WORLD_EDIT_CHUNK_SIZE);
      const localX = horizontal % WORLD_EDIT_CHUNK_SIZE;
      const x = chunk.chunkX * WORLD_EDIT_CHUNK_SIZE + localX;
      const y = sectionY * WORLD_CHUNK_SECTION_HEIGHT + localY;
      const z = chunk.chunkZ * WORLD_EDIT_CHUNK_SIZE + localZ;
      if (x < WORLD_EDIT_MIN_XZ || x > WORLD_EDIT_MAX_XZ || y < WORLD_EDIT_MIN_Y || y > WORLD_EDIT_MAX_Y
        || z < WORLD_EDIT_MIN_XZ || z > WORLD_EDIT_MAX_XZ) return { ok: false, reason: BS.invalidSnapshot };
      edits.push({ coordKey: `${x}:${y}:${z}`, x: String(x), y: String(y), z: String(z), blockType });
    }
  }
  return { ok: true, edits };
}

/**
 * Reads a bounded set of cells without allocating every edit in a potentially
 * dense 8x8 column. `null` is untouched natural terrain; `air` is an explicit
 * mined edit and must not fall back to terrain generation.
 */
export function sampleWorldChunkSnapshot(
  rawChunkKey: string,
  snapshotJson: string,
  samples: readonly { x: number; y: number; z: number }[],
): WorldChunkTargetedSampleResult {
  const chunk = validateWorldChunkKey(rawChunkKey);
  if (!chunk.ok) return { ok: false, reason: chunk.reason };
  if (snapshotJson.length > MAX_WORLD_CHUNK_SNAPSHOT_BYTES) return { ok: false, reason: "snapshot_too_large" };
  const snapshot = parsePacked(snapshotJson);
  if (!snapshot) return { ok: false, reason: BS.invalidSnapshot };
  const blocks: Array<WorldChunkBlockType | null> = [];
  for (const sample of samples) {
    if (!sample || !Number.isSafeInteger(sample.x) || !Number.isSafeInteger(sample.y)
      || !Number.isSafeInteger(sample.z)) return { ok: false, reason: "invalid_sample" };
    const address = cellAddress(sample.x, sample.y, sample.z, chunk.chunkX, chunk.chunkZ);
    if (!address) return { ok: false, reason: "invalid_sample" };
    if (sample.y === WORLD_EDIT_MIN_Y) {
      blocks.push(null);
      continue;
    }
    const section = snapshot.version === 3 || snapshot.version === 4
      ? snapshot.sections.get(address.sectionY)
      : null;
    const horizontal = address.sectionIndex % CELLS_PER_Y;
    const legacyIndex = sample.y >= LEGACY_MIN_Y && sample.y <= LEGACY_MAX_Y
      ? (sample.y - LEGACY_MIN_Y) * CELLS_PER_Y + horizontal
      : null;
    const code = snapshot.version === 1
      ? legacyIndex === null ? 0 : getNibble(snapshot.packed, legacyIndex)
      : snapshot.version === 2
        ? legacyIndex === null ? 0 : getLegacyFiveBitCode(snapshot.packed, legacyIndex)
        : section
          ? snapshot.version === 3
            ? getLegacyFiveBitCode(section, address.sectionIndex)
            : getCurrentCode(section, address.sectionIndex)
          : 0;
    if (code === 0) {
      blocks.push(null);
      continue;
    }
    if (snapshot.version === 1 && code > LEGACY_BLOCK_TYPE_COUNT) {
      return { ok: false, reason: BS.invalidSnapshot };
    }
    const block = WORLD_CHUNK_BLOCK_TYPES[code - 1];
    if (!block) return { ok: false, reason: BS.invalidSnapshot };
    blocks.push(block);
  }
  return { ok: true, blocks };
}
