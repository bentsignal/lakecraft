import { DEFAULT_PLAYER_SKIN_RGBA } from "./generated/defaultPlayerSkin.ts";

export const PLAYER_SKIN_MAX_BYTES = 2 * 1024 * 1024;
export const PLAYER_SKIN_SIZES = Object.freeze([64, 128] as const);
export const PLAYER_SKIN_STORAGE_KEY = "lakecraft.player-skin.v1";
export const PLAYER_SKIN_MAX_DATA_URL_CHARS = 2_796_240;
export const PLAYER_SKIN_WIRE_BYTES = 64 * 64 * 4;
export const PLAYER_SKIN_WIRE_BASE64_CHARS = 21_848;

export type PlayerSkinModel = "wide" | "slim";

export type PlayerSkinFileInfo = Readonly<{
  width: 64 | 128;
  height: 64 | 128;
  bytes: number;
}>;

export type PersistedPlayerSkin = Readonly<{
  version: 1;
  name: string;
  width: 64 | 128;
  height: 64 | 128;
  model: PlayerSkinModel;
  dataUrl: string;
}>;

export type HydratedPlayerSkin = Readonly<{
  id: string;
  model: PlayerSkinModel;
  pixels: Uint8Array;
  source: HTMLImageElement | null;
}>;

export type PlayerSkinStorageAdapter = Readonly<{
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}>;

const PNG_SIGNATURE = Object.freeze([137, 80, 78, 71, 13, 10, 26, 10]);
const PLAYER_SKIN_STORAGE_FIELD_COUNT = 6;
const PLAYER_SKIN_STORAGE_MODEL_KEY = "model";
const PLAYER_SKIN_STORAGE_DATA_URL_KEY = "dataUrl";

function invalidSkin(message: string): never {
  throw new Error(message);
}

function uint32(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] * 16_777_216 + bytes[offset + 1] * 65_536
    + bytes[offset + 2] * 256 + bytes[offset + 3]) >>> 0;
}

/** Reads only the PNG signature and IHDR. No image pixels are decoded here. */
export function inspectPlayerSkinPng(bytes: Uint8Array): PlayerSkinFileInfo {
  if (!bytes.length || bytes.length > PLAYER_SKIN_MAX_BYTES) {
    invalidSkin(`Choose a PNG smaller than ${PLAYER_SKIN_MAX_BYTES / 1024 / 1024} MB.`);
  }
  if (bytes.length < 33 || PNG_SIGNATURE.some((value, index) => bytes[index] !== value)) {
    invalidSkin("Choose a valid PNG image.");
  }
  if (uint32(bytes, 8) !== 13
    || bytes[12] !== 73 || bytes[13] !== 72 || bytes[14] !== 68 || bytes[15] !== 82) {
    invalidSkin("The PNG is missing its standard IHDR header.");
  }
  const width = uint32(bytes, 16);
  const height = uint32(bytes, 20);
  if ((width !== 64 && width !== 128) || height !== width) {
    invalidSkin("Use a modern 64×64 skin, or a pixel-perfect 128×128 version.");
  }
  // Browsers normalize every legal PNG color format to RGBA when the decoded
  // image is uploaded to WebGL. Accept indexed skins (including tRNS alpha),
  // grayscale exports, 16-bit exports, and Adam7 interlacing rather than
  // imposing an encoder-specific restriction on an otherwise standard skin.
  const bitDepth = bytes[24];
  const colorType = bytes[25];
  const validDepths: Readonly<Record<number, readonly number[]>> = Object.freeze({
    0: Object.freeze([1, 2, 4, 8, 16]),
    2: Object.freeze([8, 16]),
    3: Object.freeze([1, 2, 4, 8]),
    4: Object.freeze([8, 16]),
    6: Object.freeze([8, 16]),
  });
  if (!validDepths[colorType]?.includes(bitDepth)) {
    invalidSkin("Use a PNG with a standard grayscale, indexed, RGB, or RGBA color format.");
  }
  if (bytes[26] !== 0 || bytes[27] !== 0 || (bytes[28] !== 0 && bytes[28] !== 1)) {
    invalidSkin("Use a PNG with standard compression, filtering, and interlacing.");
  }
  return Object.freeze({ width, height, bytes: bytes.length }) as PlayerSkinFileInfo;
}

export async function inspectPlayerSkinFile(file: File): Promise<PlayerSkinFileInfo> {
  if (file.type && file.type !== "image/png") invalidSkin("Choose a PNG skin file.");
  if (!file.size || file.size > PLAYER_SKIN_MAX_BYTES) {
    invalidSkin(`Choose a PNG smaller than ${PLAYER_SKIN_MAX_BYTES / 1024 / 1024} MB.`);
  }
  return inspectPlayerSkinPng(new Uint8Array(await file.arrayBuffer()));
}

/** Reads and validates a skin once, returning a browser-local persistence URL. */
export async function readPlayerSkinFile(file: File): Promise<Readonly<{
  info: PlayerSkinFileInfo;
  dataUrl: string;
}>> {
  const info = await inspectPlayerSkinFile(file);
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("The browser could not read this PNG."));
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("The browser could not read this PNG."));
        return;
      }
      const separator = reader.result.indexOf(",");
      if (separator < 0) {
        reject(new Error("The browser could not read this PNG."));
        return;
      }
      resolve(`data:image/png;base64,${reader.result.slice(separator + 1)}`);
    };
    reader.readAsDataURL(file);
  });
  if (dataUrl.length > PLAYER_SKIN_MAX_DATA_URL_CHARS) {
    invalidSkin(`Choose a PNG smaller than ${PLAYER_SKIN_MAX_BYTES / 1024 / 1024} MB.`);
  }
  return Object.freeze({ info, dataUrl });
}

function canonicalPersistedPlayerSkin(value: unknown): PersistedPlayerSkin | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (Object.keys(candidate).length !== PLAYER_SKIN_STORAGE_FIELD_COUNT) return null;
  const version = candidate.version;
  const name = candidate.name;
  const width = candidate.width;
  const height = candidate.height;
  const model = candidate[PLAYER_SKIN_STORAGE_MODEL_KEY];
  const dataUrl = candidate[PLAYER_SKIN_STORAGE_DATA_URL_KEY];
  if (version !== 1
    || typeof name !== "string"
    || name.length === 0
    || name.length > 160
    || (width !== 64 && width !== 128)
    || height !== width
    || (model !== "wide" && model !== "slim")
    || typeof dataUrl !== "string"
    || !dataUrl.startsWith("data:image/png;base64,")
    || dataUrl.length > PLAYER_SKIN_MAX_DATA_URL_CHARS) {
    return null;
  }
  return Object.freeze({
    version,
    name,
    width,
    height,
    [PLAYER_SKIN_STORAGE_MODEL_KEY]: model,
    [PLAYER_SKIN_STORAGE_DATA_URL_KEY]: dataUrl,
  }) as PersistedPlayerSkin;
}

/** Loads one origin-local skin selection. Invalid/unavailable storage is inert. */
export function loadPersistedPlayerSkin(storage: PlayerSkinStorageAdapter): PersistedPlayerSkin | null {
  try {
    const raw = storage.getItem(PLAYER_SKIN_STORAGE_KEY);
    if (!raw || raw.length > PLAYER_SKIN_MAX_DATA_URL_CHARS + 512) return null;
    const parsed: unknown = JSON.parse(raw);
    return canonicalPersistedPlayerSkin(parsed);
  } catch {
    return null;
  }
}

/** Commits one validated skin selection with readback verification. */
export function savePersistedPlayerSkin(
  storage: PlayerSkinStorageAdapter,
  skin: PersistedPlayerSkin,
): boolean {
  const canonical = canonicalPersistedPlayerSkin(skin);
  if (!canonical) return false;
  try {
    const serialized = JSON.stringify(canonical);
    storage.setItem(PLAYER_SKIN_STORAGE_KEY, serialized);
    return storage.getItem(PLAYER_SKIN_STORAGE_KEY) === serialized;
  } catch {
    return false;
  }
}

/** Restores the installed standard skin without disturbing world saves. */
export function clearPersistedPlayerSkin(storage: PlayerSkinStorageAdapter): boolean {
  if (typeof storage.removeItem !== "function") return false;
  try {
    storage.removeItem(PLAYER_SKIN_STORAGE_KEY);
    return storage.getItem(PLAYER_SKIN_STORAGE_KEY) === null;
  } catch {
    return false;
  }
}

/**
 * Dominant colors sampled from the installed standard player skin. Keeping
 * these public lets low-detail/distance renderers match the exact UV texture.
 */
export const LAKECRAFT_DEFAULT_SKIN_PALETTE = Object.freeze({
  skin: Object.freeze([170, 114, 89] as const),
  skinShade: Object.freeze([129, 83, 57] as const),
  hair: Object.freeze([43, 30, 13] as const),
  jacket: Object.freeze([0, 175, 175] as const),
  jacketShade: Object.freeze([0, 127, 127] as const),
  trousers: Object.freeze([65, 53, 155] as const),
  boots: Object.freeze([55, 55, 55] as const),
  scarf: Object.freeze([10, 188, 188] as const),
  eyes: Object.freeze([0, 104, 104] as const),
  badge: Object.freeze([0, 204, 204] as const),
});

/** Installed standard skin used when a player has not supplied a local skin. */
export function createLakecraftDefaultSkinPixels(): Uint8Array {
  return DEFAULT_PLAYER_SKIN_RGBA;
}

/** Content-addresses the exact bounded pixels relayed by a realtime server. */
export async function playerSkinWireId(pixels: Uint8Array): Promise<string> {
  if (pixels.byteLength !== PLAYER_SKIN_WIRE_BYTES) throw new Error("Player skin pixels must be exactly 64×64 RGBA.");
  const digest = await crypto.subtle.digest("SHA-256", pixels);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function encodePlayerSkinWirePixels(pixels: Uint8Array): string {
  if (pixels.byteLength !== PLAYER_SKIN_WIRE_BYTES) throw new Error("Player skin pixels must be exactly 64×64 RGBA.");
  let binary = "";
  for (let offset = 0; offset < pixels.length; offset += 4_096) {
    binary += String.fromCharCode(...pixels.subarray(offset, offset + 4_096));
  }
  return btoa(binary);
}

export function decodePlayerSkinWirePixels(value: unknown): Uint8Array | null {
  if (typeof value !== "string" || value.length !== PLAYER_SKIN_WIRE_BASE64_CHARS
    || !/^[A-Za-z0-9+/]{21846}==$/.test(value)) return null;
  try {
    const binary = atob(value);
    if (binary.length !== PLAYER_SKIN_WIRE_BYTES) return null;
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function loadSkinImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The saved skin could not be decoded."));
    image.src = dataUrl;
  });
}

/**
 * Hydrates the browser's selected skin once for both the local rig and the
 * bounded realtime appearance payload. Imported 128px skins are reduced with
 * nearest-neighbor sampling to the standard 64px wire layout.
 */
export async function hydrateSelectedPlayerSkin(storage: PlayerSkinStorageAdapter): Promise<HydratedPlayerSkin> {
  const persisted = loadPersistedPlayerSkin(storage);
  if (!persisted) {
    return Object.freeze({ id: "default", model: "wide", pixels: createLakecraftDefaultSkinPixels(), source: null });
  }
  try {
    const source = await loadSkinImage(persisted.dataUrl);
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("The saved skin could not be sampled.");
    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, 64, 64);
    context.drawImage(source, 0, 0, 64, 64);
    const pixels = new Uint8Array(context.getImageData(0, 0, 64, 64).data);
    return Object.freeze({ id: await playerSkinWireId(pixels), model: persisted.model, pixels, source });
  } catch {
    clearPersistedPlayerSkin(storage);
    return Object.freeze({ id: "default", model: "wide", pixels: createLakecraftDefaultSkinPixels(), source: null });
  }
}
