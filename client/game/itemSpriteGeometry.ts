import type { ItemIconArt } from "../components/itemIconArt.ts";
import { CUBE_FACES } from "./cubeFaces.ts";

export const ITEM_SPRITE_LOGICAL_SIZE = 16;
export const ITEM_SPRITE_DEFAULT_DEPTH = 1 / 16;
export const ITEM_SPRITE_MAX_VERTICES = 4_608;
export const ITEM_SPRITE_VERTEX_FLOATS = 6;

type Vec3 = readonly [number, number, number];
type Grid = Array<Array<string | null>>;

export type ItemSpriteGeometryOptions = Readonly<{
  center?: Vec3;
  size?: number;
  depth?: number;
  rotationDegrees?: Vec3;
  /** Pixel-space point in the 16x16 artwork that should sit at `center`. */
  pivotPixels?: readonly [number, number];
}>;

const FACE_SHADE = Object.freeze({
  east: 0.79,
  west: 0.68,
  top: 1,
  bottom: 0.52,
  south: 1,
  north: 0.73,
});

function parseColor(color: string): Vec3 {
  if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error(`Invalid item sprite color: ${color}`);
  return [
    Number.parseInt(color.slice(1, 3), 16) / 255,
    Number.parseInt(color.slice(3, 5), 16) / 255,
    Number.parseInt(color.slice(5, 7), 16) / 255,
  ];
}

function spriteGrid(art: ItemIconArt): Grid {
  const grid: Grid = Array.from(
    { length: ITEM_SPRITE_LOGICAL_SIZE },
    () => Array<string | null>(ITEM_SPRITE_LOGICAL_SIZE).fill(null),
  );
  for (const run of art.runs) {
    if (!Number.isInteger(run.x) || !Number.isInteger(run.y) || !Number.isInteger(run.width)
      || run.x < 0 || run.y < 0 || run.width < 1
      || run.x + run.width > ITEM_SPRITE_LOGICAL_SIZE || run.y >= ITEM_SPRITE_LOGICAL_SIZE) {
      throw new Error("Item sprite run is outside its 16x16 canvas.");
    }
    parseColor(run.color);
    for (let x = run.x; x < run.x + run.width; x += 1) {
      if (grid[run.y][x]) throw new Error("Item sprite runs overlap.");
      grid[run.y][x] = run.color;
    }
  }
  return grid;
}

function appendPoint(
  output: number[],
  point: Vec3,
  color: Vec3,
  shade: number,
  center: Vec3,
  rotation: Vec3,
  pivot: Vec3,
): void {
  let x = point[0] - pivot[0];
  let y = point[1] - pivot[1];
  let z = point[2] - pivot[2];
  const rx = rotation[0] * Math.PI / 180;
  const ry = rotation[1] * Math.PI / 180;
  const rz = rotation[2] * Math.PI / 180;
  if (rx) {
    const cosine = Math.cos(rx); const sine = Math.sin(rx);
    const nextY = y * cosine - z * sine;
    z = y * sine + z * cosine;
    y = nextY;
  }
  if (ry) {
    const cosine = Math.cos(ry); const sine = Math.sin(ry);
    const nextX = x * cosine + z * sine;
    z = -x * sine + z * cosine;
    x = nextX;
  }
  if (rz) {
    const cosine = Math.cos(rz); const sine = Math.sin(rz);
    const nextX = x * cosine - y * sine;
    y = x * sine + y * cosine;
    x = nextX;
  }
  output.push(
    x + center[0], y + center[1], z + center[2],
    Math.min(1, color[0] * shade),
    Math.min(1, color[1] * shade),
    Math.min(1, color[2] * shade),
  );
}

function appendFace(
  output: number[],
  faceName: "east" | "west" | "top" | "bottom" | "south" | "north",
  bounds: readonly [x0: number, y0: number, z0: number, x1: number, y1: number, z1: number],
  color: string,
  center: Vec3,
  rotation: Vec3,
  pivot: Vec3,
): void {
  const face = CUBE_FACES.find(([name]) => name === faceName);
  if (!face) throw new Error(`Missing cube face ${faceName}.`);
  const rgb = parseColor(color);
  const [x0, y0, z0, x1, y1, z1] = bounds;
  for (const point of face[5]) {
    appendPoint(output, [
      x0 + (x1 - x0) * point[0],
      y0 + (y1 - y0) * point[1],
      z0 + (z1 - z0) * point[2],
    ], rgb, FACE_SHADE[faceName], center, rotation, pivot);
  }
}

function pixelBounds(
  x: number,
  y: number,
  width: number,
  size: number,
  depth: number,
): readonly [number, number, number, number, number, number] {
  const unit = size / ITEM_SPRITE_LOGICAL_SIZE;
  const x0 = (x - ITEM_SPRITE_LOGICAL_SIZE / 2) * unit;
  const x1 = (x + width - ITEM_SPRITE_LOGICAL_SIZE / 2) * unit;
  const y1 = (ITEM_SPRITE_LOGICAL_SIZE / 2 - y) * unit;
  const y0 = (ITEM_SPRITE_LOGICAL_SIZE / 2 - y - 1) * unit;
  return [x0, y0, -depth / 2, x1, y1, depth / 2];
}

/**
 * Converts the same deterministic pixel runs used by inventory UI into a thin
 * opaque-edge 3D sprite. Front/back spans are merged by run; only silhouette
 * boundaries emit side faces, so transparent corners remain transparent.
 */
export function appendItemSpriteGeometry(
  output: number[],
  art: ItemIconArt,
  options: ItemSpriteGeometryOptions = {},
): number {
  const start = output.length;
  const center = options.center ?? [0, 0, 0];
  const size = options.size ?? 1;
  const depth = options.depth ?? size * ITEM_SPRITE_DEFAULT_DEPTH;
  const rotation = options.rotationDegrees ?? [0, 0, 0];
  const pivotPixels = options.pivotPixels ?? [ITEM_SPRITE_LOGICAL_SIZE / 2, ITEM_SPRITE_LOGICAL_SIZE / 2];
  const unit = size / ITEM_SPRITE_LOGICAL_SIZE;
  const pivot: Vec3 = [
    (pivotPixels[0] - ITEM_SPRITE_LOGICAL_SIZE / 2) * unit,
    (ITEM_SPRITE_LOGICAL_SIZE / 2 - pivotPixels[1]) * unit,
    0,
  ];
  if (!Number.isFinite(size) || size <= 0 || !Number.isFinite(depth) || depth <= 0
    || !center.every(Number.isFinite) || !rotation.every(Number.isFinite)
    || !pivotPixels.every((value) => Number.isFinite(value) && value >= 0 && value <= ITEM_SPRITE_LOGICAL_SIZE)) {
    throw new Error("Item sprite geometry options must be finite and visible.");
  }
  const grid = spriteGrid(art);

  for (const run of art.runs) {
    const bounds = pixelBounds(run.x, run.y, run.width, size, depth);
    appendFace(output, "south", bounds, run.color, center, rotation, pivot);
    appendFace(output, "north", bounds, run.color, center, rotation, pivot);
  }

  for (let y = 0; y < ITEM_SPRITE_LOGICAL_SIZE; y += 1) {
    for (let x = 0; x < ITEM_SPRITE_LOGICAL_SIZE; x += 1) {
      const color = grid[y][x];
      if (!color) continue;
      const bounds = pixelBounds(x, y, 1, size, depth);
      if (!grid[y][x - 1]) appendFace(output, "west", bounds, color, center, rotation, pivot);
      if (!grid[y][x + 1]) appendFace(output, "east", bounds, color, center, rotation, pivot);
      if (!grid[y - 1]?.[x]) appendFace(output, "top", bounds, color, center, rotation, pivot);
      if (!grid[y + 1]?.[x]) appendFace(output, "bottom", bounds, color, center, rotation, pivot);
    }
  }

  const vertices = (output.length - start) / ITEM_SPRITE_VERTEX_FLOATS;
  if (vertices > ITEM_SPRITE_MAX_VERTICES) {
    output.length = start;
    throw new Error(`Item sprite exceeded ${ITEM_SPRITE_MAX_VERTICES} vertices.`);
  }
  return vertices;
}
