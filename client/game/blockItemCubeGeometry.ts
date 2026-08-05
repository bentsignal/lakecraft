import type { ItemId } from "../../shared/game.ts";
import { blockTextureForFace, type BlockFace } from "./blockTextures.ts";
import { CUBE_FACES } from "./cubeFaces.ts";
import {
  TEXTURE_ATLAS_COLUMNS,
  TEXTURE_ATLAS_NAMES,
  TEXTURE_ATLAS_RGBA,
  TEXTURE_TILE_SIZE,
  type TextureAtlasName,
} from "./generated/textureAtlas.ts";
import { BLOCK, type BlockId } from "./types.ts";

type Vec3 = readonly [number, number, number];

export const BLOCK_ITEM_CUBE_VERTEX_FLOATS = 6;
export const BLOCK_ITEM_CUBE_MAX_VERTICES = 6 * TEXTURE_TILE_SIZE * TEXTURE_TILE_SIZE * 6;

export type BlockItemCubeOptions = Readonly<{
  center?: Vec3;
  size?: number;
  rotationDegrees?: Vec3;
}>;

const BLOCK_ITEMS: Readonly<Partial<Record<ItemId, BlockId>>> = Object.freeze({
  grass: BLOCK.GRASS,
  dirt: BLOCK.DIRT,
  stone: BLOCK.STONE,
  cobblestone: BLOCK.COBBLESTONE,
  sand: BLOCK.SAND,
  gravel: BLOCK.GRAVEL,
  glass: BLOCK.GLASS,
  coal_ore: BLOCK.COAL_ORE,
  iron_ore: BLOCK.IRON_ORE,
  gold_ore: BLOCK.GOLD_ORE,
  diamond_ore: BLOCK.DIAMOND_ORE,
  log: BLOCK.WOOD,
  leaves: BLOCK.LEAVES,
  planks: BLOCK.PLANKS,
  crafting_table: BLOCK.CRAFTING_TABLE,
  furnace: BLOCK.FURNACE,
  tnt: BLOCK.TNT,
  wool: BLOCK.WOOL,
  stone_bricks: BLOCK.STONE_BRICKS,
  clay: BLOCK.CLAY,
  bricks: BLOCK.BRICKS,
});

export function blockIdForCubeItem(itemId: ItemId): BlockId | null {
  return BLOCK_ITEMS[itemId] ?? null;
}

function atlasPixel(texture: TextureAtlasName, x: number, y: number): readonly [number, number, number, number] {
  const index = TEXTURE_ATLAS_NAMES.indexOf(texture);
  if (index < 0) throw new Error(`Unknown block-item texture ${texture}.`);
  const atlasWidth = TEXTURE_ATLAS_COLUMNS * TEXTURE_TILE_SIZE;
  const atlasX = index % TEXTURE_ATLAS_COLUMNS * TEXTURE_TILE_SIZE + x;
  const atlasY = Math.floor(index / TEXTURE_ATLAS_COLUMNS) * TEXTURE_TILE_SIZE + y;
  const offset = (atlasY * atlasWidth + atlasX) * 4;
  return [
    TEXTURE_ATLAS_RGBA[offset],
    TEXTURE_ATLAS_RGBA[offset + 1],
    TEXTURE_ATLAS_RGBA[offset + 2],
    TEXTURE_ATLAS_RGBA[offset + 3],
  ];
}

function pointAt(face: BlockFace, horizontal: number, vertical: number): Vec3 {
  if (face === "east") return [1, vertical, horizontal];
  if (face === "west") return [0, vertical, horizontal];
  if (face === "top") return [horizontal, 1, vertical];
  if (face === "bottom") return [horizontal, 0, vertical];
  if (face === "south") return [horizontal, vertical, 1];
  return [horizontal, vertical, 0];
}

function transformPoint(point: Vec3, center: Vec3, size: number, rotation: Vec3): Vec3 {
  let x = (point[0] - 0.5) * size;
  let y = (point[1] - 0.5) * size;
  let z = (point[2] - 0.5) * size;
  const rx = rotation[0] * Math.PI / 180;
  const ry = rotation[1] * Math.PI / 180;
  const rz = rotation[2] * Math.PI / 180;
  if (rx) {
    const cosine = Math.cos(rx); const sine = Math.sin(rx);
    const nextY = y * cosine - z * sine;
    z = y * sine + z * cosine; y = nextY;
  }
  if (ry) {
    const cosine = Math.cos(ry); const sine = Math.sin(ry);
    const nextX = x * cosine + z * sine;
    z = -x * sine + z * cosine; x = nextX;
  }
  if (rz) {
    const cosine = Math.cos(rz); const sine = Math.sin(rz);
    const nextX = x * cosine - y * sine;
    y = x * sine + y * cosine; x = nextX;
  }
  return [x + center[0], y + center[1], z + center[2]];
}

/**
 * Emits one true six-face cube from the exact authored world-atlas texels.
 * Each non-transparent texel becomes two color-shaded triangles, so the held
 * block remains nearest-neighbor without introducing a second texture source.
 */
export function appendBlockItemCubeGeometry(
  output: number[],
  itemId: ItemId,
  options: BlockItemCubeOptions = {},
): number {
  const block = blockIdForCubeItem(itemId);
  if (block === null) return 0;
  const center = options.center ?? [0, 0, 0];
  const size = options.size ?? 1;
  const rotation = options.rotationDegrees ?? [0, 0, 0];
  if (!Number.isFinite(size) || size <= 0 || !center.every(Number.isFinite) || !rotation.every(Number.isFinite)) {
    throw new Error("Block item cube options must be finite and visible.");
  }
  const start = output.length;
  for (const face of CUBE_FACES) {
    const texture = blockTextureForFace(block, face[0]);
    if (!texture) continue;
    const winding = face[0] === "west" || face[0] === "south"
      ? [3, 2, 1, 3, 1, 0]
      : face[0] === "bottom" ? [1, 0, 3, 1, 3, 2] : [0, 1, 2, 0, 2, 3];
    for (let pixelY = 0; pixelY < TEXTURE_TILE_SIZE; pixelY += 1) {
      const v0 = 1 - (pixelY + 1) / TEXTURE_TILE_SIZE;
      const v1 = 1 - pixelY / TEXTURE_TILE_SIZE;
      for (let pixelX = 0; pixelX < TEXTURE_TILE_SIZE; pixelX += 1) {
        const color = atlasPixel(texture, pixelX, pixelY);
        if (color[3] < 16) continue;
        const u0 = pixelX / TEXTURE_TILE_SIZE;
        const u1 = (pixelX + 1) / TEXTURE_TILE_SIZE;
        const points = [
          pointAt(face[0], u0, v0),
          pointAt(face[0], u0, v1),
          pointAt(face[0], u1, v1),
          pointAt(face[0], u1, v0),
        ];
        for (const index of winding) {
          const point = transformPoint(points[index], center, size, rotation);
          const alpha = color[3] / 255;
          output.push(
            point[0], point[1], point[2],
            color[0] / 255 * face[4] * alpha,
            color[1] / 255 * face[4] * alpha,
            color[2] / 255 * face[4] * alpha,
          );
        }
      }
    }
  }
  const vertices = (output.length - start) / BLOCK_ITEM_CUBE_VERTEX_FLOATS;
  if (vertices > BLOCK_ITEM_CUBE_MAX_VERTICES) {
    output.length = start;
    throw new Error(`Block item cube exceeded ${BLOCK_ITEM_CUBE_MAX_VERTICES} vertices.`);
  }
  return vertices;
}
