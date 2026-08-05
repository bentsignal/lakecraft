export const PLAYER_SKIN_MAX_BYTES = 2 * 1024 * 1024;
export const PLAYER_SKIN_SIZES = Object.freeze([64, 128] as const);
export const PLAYER_SKIN_STORAGE_KEY = "lakecraft.player-skin.v1";
export const PLAYER_SKIN_MAX_DATA_URL_CHARS = 2_796_240;

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

/** Restores the bundled-original skin without disturbing world saves. */
export function clearPersistedPlayerSkin(storage: PlayerSkinStorageAdapter): boolean {
  if (typeof storage.removeItem !== "function") return false;
  try {
    storage.removeItem(PLAYER_SKIN_STORAGE_KEY);
    return storage.getItem(PLAYER_SKIN_STORAGE_KEY) === null;
  } catch {
    return false;
  }
}

type Rgba = readonly [red: number, green: number, blue: number, alpha?: number];

/**
 * Canonical palette for Lakecraft's bundled-original explorer. Keeping these
 * colors public lets low-detail/distance renderers match the authored skin
 * without copying a second, eventually divergent approximation.
 */
export const LAKECRAFT_DEFAULT_SKIN_PALETTE = Object.freeze({
  skin: Object.freeze([174, 112, 75] as const),
  skinShade: Object.freeze([142, 83, 57] as const),
  hair: Object.freeze([50, 34, 26] as const),
  jacket: Object.freeze([57, 78, 54] as const),
  jacketShade: Object.freeze([38, 57, 39] as const),
  trousers: Object.freeze([44, 51, 61] as const),
  boots: Object.freeze([32, 27, 25] as const),
  scarf: Object.freeze([179, 80, 38] as const),
  eyes: Object.freeze([40, 70, 73] as const),
  badge: Object.freeze([191, 155, 74] as const),
});

/** Original Lakecraft explorer skin used when a player has not supplied a local skin. */
export function createLakecraftDefaultSkinPixels(): Uint8Array {
  const pixels = new Uint8Array(64 * 64 * 4);
  const fill = (x: number, y: number, width: number, height: number, color: Rgba): void => {
    for (let py = y; py < y + height; py += 1) for (let px = x; px < x + width; px += 1) {
      const offset = (py * 64 + px) * 4;
      pixels[offset] = color[0]; pixels[offset + 1] = color[1]; pixels[offset + 2] = color[2];
      pixels[offset + 3] = color[3] ?? 255;
    }
  };
  const dot = (x: number, y: number, color: Rgba): void => fill(x, y, 1, 1, color);
  const {
    skin, skinShade, hair, jacket, jacketShade, trousers, boots, scarf, eyes, badge,
  } = LAKECRAFT_DEFAULT_SKIN_PALETTE;

  fill(0, 0, 32, 16, skin);
  fill(8, 0, 8, 8, hair); fill(24, 8, 8, 8, hair);
  fill(8, 8, 8, 3, hair); fill(0, 8, 8, 4, hair); fill(16, 8, 8, 4, hair);
  dot(10, 12, eyes); dot(13, 12, eyes);
  fill(11, 14, 3, 1, skinShade);

  fill(16, 16, 24, 16, jacket); fill(16, 20, 4, 12, jacketShade);
  fill(20, 20, 8, 2, scarf); dot(23, 23, badge);
  fill(40, 16, 16, 16, skin); fill(40, 20, 16, 4, jacket);
  fill(0, 16, 16, 16, trousers); fill(0, 28, 16, 4, boots);

  fill(16, 48, 16, 16, trousers); fill(16, 60, 16, 4, boots);
  fill(32, 48, 16, 16, skin); fill(32, 52, 16, 4, jacket);

  // Outer-layer pixels are transparent except for a restrained collar, cuffs,
  // hair fringe, and boot trim. That keeps third-party overlay expectations intact.
  fill(32, 0, 32, 16, [0, 0, 0, 0]);
  fill(40, 8, 8, 2, hair); dot(40, 10, hair); dot(47, 10, hair);
  fill(16, 32, 24, 16, [0, 0, 0, 0]); fill(20, 36, 8, 2, scarf);
  fill(40, 32, 16, 16, [0, 0, 0, 0]); fill(44, 42, 4, 2, jacketShade);
  fill(0, 32, 16, 16, [0, 0, 0, 0]); fill(4, 42, 4, 2, boots);
  fill(0, 48, 16, 16, [0, 0, 0, 0]); fill(4, 58, 4, 2, boots);
  fill(48, 48, 16, 16, [0, 0, 0, 0]); fill(52, 58, 4, 2, jacketShade);
  return pixels;
}
