import {
  MAX_PLAYER_NAME_LENGTH,
  MAX_REMOTE_PLAYERS,
  advanceRemoteAvatarMotion,
  type RemoteAvatarMotion,
} from "./avatar.ts";
import { ITEMS, type ArmorId, type ItemId } from "../../shared/game.ts";
import { getBowIconArt, getItemIconArt, type ItemIconArt } from "../components/itemIconArt.ts";
import { BOX_FACE_SHADES, BOX_VERTEX_COORDINATES, NAMEPLATE_FONT } from "./generated/renderGeometry.ts";
import { LAKECRAFT_DEFAULT_SKIN_PALETTE } from "./playerSkin.ts";

type Vec3 = readonly [number, number, number];

const FLOATS_PER_VERTEX = 6;
const VERTICES_PER_BOX = 36;
export const REMOTE_DEFAULT_PLAYER_BOX_COUNT = 17;
export const REMOTE_DEFAULT_PLAYER_HEIGHT = 2;
const BASE_AVATAR_BOXES = REMOTE_DEFAULT_PLAYER_BOX_COUNT;
const MAX_ARMOR_BOXES = 10;
export const REMOTE_HELD_ITEM_LOGICAL_SIZE = 8;
export const REMOTE_HELD_ITEM_MAX_RECTS = 24;
const VERTICES_PER_HELD_ITEM_RECT = 6;
const MAX_GLYPH_PIXELS = 15;
const REMOTE_RENDER_DISTANCE_SQUARED = 64 * 64;

export const REMOTE_MESH_INTERVAL_MS = 1_000 / 30;
export const BASE_AVATAR_VERTICES_PER_PLAYER = BASE_AVATAR_BOXES * VERTICES_PER_BOX;
export const MAX_ARMOR_VERTICES_PER_PLAYER = MAX_ARMOR_BOXES * VERTICES_PER_BOX;
export const MAX_HELD_ITEM_VERTICES_PER_PLAYER = REMOTE_HELD_ITEM_MAX_RECTS * VERTICES_PER_HELD_ITEM_RECT;
/** Worst-case fixed avatar capacity, including a bounded canonical sprite and all armor. */
export const AVATAR_VERTICES_PER_PLAYER = BASE_AVATAR_VERTICES_PER_PLAYER
  + MAX_ARMOR_VERTICES_PER_PLAYER
  + MAX_HELD_ITEM_VERTICES_PER_PLAYER;
export const MAX_NAMEPLATE_VERTICES_PER_PLAYER = 6 + MAX_PLAYER_NAME_LENGTH * MAX_GLYPH_PIXELS * 6;

function normalizedColor(color: readonly [number, number, number]): Vec3 {
  return Object.freeze([color[0] / 255, color[1] / 255, color[2] / 255]) as Vec3;
}

const COLORS = {
  skin: normalizedColor(LAKECRAFT_DEFAULT_SKIN_PALETTE.skin),
  jacket: normalizedColor(LAKECRAFT_DEFAULT_SKIN_PALETTE.jacket),
  trousers: normalizedColor(LAKECRAFT_DEFAULT_SKIN_PALETTE.trousers),
  boots: normalizedColor(LAKECRAFT_DEFAULT_SKIN_PALETTE.boots),
  hair: normalizedColor(LAKECRAFT_DEFAULT_SKIN_PALETTE.hair),
  eye: normalizedColor(LAKECRAFT_DEFAULT_SKIN_PALETTE.eyes),
  mouth: normalizedColor(LAKECRAFT_DEFAULT_SKIN_PALETTE.skinShade),
  scarf: normalizedColor(LAKECRAFT_DEFAULT_SKIN_PALETTE.scarf),
  leatherArmor: [0.48, 0.25, 0.11] as Vec3,
  ironArmor: [0.72, 0.74, 0.72] as Vec3,
  goldArmor: [0.92, 0.72, 0.12] as Vec3,
  diamondArmor: [0.20, 0.76, 0.74] as Vec3,
  nameBackground: [0.025, 0.028, 0.035] as Vec3,
  nameText: [0.94, 0.95, 0.90] as Vec3,
};

interface VertexWriter {
  data: Float32Array;
  offset: number;
}

export type RemoteHeldItemRect = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
  color: Vec3;
}>;

type MutableHeldRect = {
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  order: number;
};

function parseIconColor(color: string): Vec3 {
  if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error(`Invalid remote held-item color: ${color}`);
  return Object.freeze([
    Number.parseInt(color.slice(1, 3), 16) / 255,
    Number.parseInt(color.slice(3, 5), 16) / 255,
    Number.parseInt(color.slice(5, 7), 16) / 255,
  ]) as Vec3;
}

/**
 * Builds an 8×8 remote-distance mip directly from the canonical 16×16 icon.
 * Each 2×2 source cell chooses its most frequent opaque canonical color; equal
 * counts preserve source scan order. Same-color cells are greedily merged, and
 * the 24 largest stable rectangles retain at least the recognizable silhouette
 * while strictly bounding the 32-player retained batch.
 */
function buildRemoteHeldItemRects(art: ItemIconArt): readonly RemoteHeldItemRect[] {
  const source = Array.from({ length: 16 }, () => Array<string | null>(16).fill(null));
  for (const run of art.runs) for (let x = run.x; x < run.x + run.width; x += 1) source[run.y][x] = run.color;
  const mip = Array.from(
    { length: REMOTE_HELD_ITEM_LOGICAL_SIZE },
    () => Array<string | null>(REMOTE_HELD_ITEM_LOGICAL_SIZE).fill(null),
  );
  for (let y = 0; y < REMOTE_HELD_ITEM_LOGICAL_SIZE; y += 1) for (let x = 0; x < REMOTE_HELD_ITEM_LOGICAL_SIZE; x += 1) {
    const counts = new Map<string, number>();
    for (let offsetY = 0; offsetY < 2; offsetY += 1) for (let offsetX = 0; offsetX < 2; offsetX += 1) {
      const color = source[y * 2 + offsetY][x * 2 + offsetX];
      if (color) counts.set(color, (counts.get(color) ?? 0) + 1);
    }
    let selected: string | null = null;
    let selectedCount = 0;
    for (const [color, count] of counts) if (count > selectedCount) {
      selected = color;
      selectedCount = count;
    }
    mip[y][x] = selected;
  }
  const rectangles: MutableHeldRect[] = [];
  for (let y = 0; y < REMOTE_HELD_ITEM_LOGICAL_SIZE; y += 1) for (let x = 0; x < REMOTE_HELD_ITEM_LOGICAL_SIZE; x += 1) {
    const color = mip[y][x];
    if (!color) continue;
    let width = 1;
    while (x + width < REMOTE_HELD_ITEM_LOGICAL_SIZE && mip[y][x + width] === color) width += 1;
    let height = 1;
    heightLoop: while (y + height < REMOTE_HELD_ITEM_LOGICAL_SIZE) {
      for (let nextX = x; nextX < x + width; nextX += 1) if (mip[y + height][nextX] !== color) break heightLoop;
      height += 1;
    }
    rectangles.push({ x, y, width, height, color, order: rectangles.length });
    for (let nextY = y; nextY < y + height; nextY += 1) {
      for (let nextX = x; nextX < x + width; nextX += 1) mip[nextY][nextX] = null;
    }
  }
  return Object.freeze(rectangles
    .sort((left, right) => right.width * right.height - left.width * left.height || left.order - right.order)
    .slice(0, REMOTE_HELD_ITEM_MAX_RECTS)
    .sort((left, right) => left.order - right.order)
    .map((rect) => Object.freeze({
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      color: parseIconColor(rect.color),
    })));
}

const REMOTE_HELD_ITEM_RECTS: Readonly<Record<ItemId, readonly RemoteHeldItemRect[]>> = Object.freeze(
  Object.fromEntries(Object.keys(ITEMS).map((itemId) => [itemId, buildRemoteHeldItemRects(getItemIconArt(itemId as ItemId))])) as
    Record<ItemId, readonly RemoteHeldItemRect[]>,
);
const REMOTE_DRAWN_BOW_RECTS = buildRemoteHeldItemRects(getBowIconArt(3));

export function remoteHeldItemRects(itemId: ItemId, bowDrawing = false): readonly RemoteHeldItemRect[] {
  return itemId === "bow" && bowDrawing ? REMOTE_DRAWN_BOW_RECTS : REMOTE_HELD_ITEM_RECTS[itemId];
}

export function remoteHeldItemVertexCount(itemId: ItemId, bowDrawing = false): number {
  return remoteHeldItemRects(itemId, bowDrawing).length * VERTICES_PER_HELD_ITEM_RECT;
}

export interface RemoteGeometryStats {
  avatarVertexCount: number;
  nameplateVertexCount: number;
  visiblePlayerCount: number;
}

export interface RemotePlayerRenderStats extends RemoteGeometryStats {
  meshMs: number;
  uploadBytes: number;
  meshUpdates: number;
  updated: boolean;
}

export interface RemotePlayerRenderer {
  readonly avatarBuffer: WebGLBuffer;
  readonly nameplateBuffer: WebGLBuffer;
  readonly stats: RemotePlayerRenderStats;
  update(
    states: ReadonlyMap<string, RemoteAvatarMotion>,
    now: number,
    deltaSeconds: number,
    camera: Vec3,
  ): RemotePlayerRenderStats;
  destroy(): void;
}

export function remotePlayerBufferCapacity(playerCount = MAX_REMOTE_PLAYERS): {
  avatarFloats: number;
  nameplateFloats: number;
  totalBytes: number;
} {
  const count = Math.max(0, Math.min(MAX_REMOTE_PLAYERS, Math.floor(playerCount)));
  const avatarFloats = count * AVATAR_VERTICES_PER_PLAYER * FLOATS_PER_VERTEX;
  const nameplateFloats = count * MAX_NAMEPLATE_VERTICES_PER_PLAYER * FLOATS_PER_VERTEX;
  return {
    avatarFloats,
    nameplateFloats,
    totalBytes: (avatarFloats + nameplateFloats) * Float32Array.BYTES_PER_ELEMENT,
  };
}

function writeVertex(writer: VertexWriter, x: number, y: number, z: number, color: Vec3, shade = 1): void {
  writer.data[writer.offset++] = x;
  writer.data[writer.offset++] = y;
  writer.data[writer.offset++] = z;
  writer.data[writer.offset++] = color[0] * shade;
  writer.data[writer.offset++] = color[1] * shade;
  writer.data[writer.offset++] = color[2] * shade;
}

function appendBox(
  writer: VertexWriter,
  state: RemoteAvatarMotion,
  yaw: number,
  pitch: number,
  pivotY: number,
  pivotZ: number,
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
  color: Vec3,
): void {
  const cosPitch = Math.cos(pitch);
  const sinPitch = Math.sin(pitch);
  const cosYaw = Math.cos(yaw);
  const sinYaw = Math.sin(yaw);
  for (let faceIndex = 0, point = 0; faceIndex < BOX_FACE_SHADES.length; faceIndex += 1) {
    const shade = BOX_FACE_SHADES[faceIndex];
    for (let vertexIndex = 0; vertexIndex < 6; vertexIndex += 1) {
      const localX = minX + BOX_VERTEX_COORDINATES[point++] * (maxX - minX);
      const unrotatedY = minY + BOX_VERTEX_COORDINATES[point++] * (maxY - minY);
      const unrotatedZ = minZ + BOX_VERTEX_COORDINATES[point++] * (maxZ - minZ);
      const offsetY = unrotatedY - pivotY;
      const offsetZ = unrotatedZ - pivotZ;
      const localY = pivotY + offsetY * cosPitch - offsetZ * sinPitch;
      const localZ = pivotZ + offsetY * sinPitch + offsetZ * cosPitch;
      writeVertex(
        writer,
        state.rendered.x + localX * cosYaw - localZ * sinYaw,
        state.rendered.y + localY,
        state.rendered.z + localX * sinYaw + localZ * cosYaw,
        color,
        shade,
      );
    }
  }
}

function armorColor(itemId: ArmorId): Vec3 {
  if (itemId.startsWith("diamond_")) return COLORS.diamondArmor;
  if (itemId.startsWith("golden_")) return COLORS.goldArmor;
  return itemId.startsWith("iron_") ? COLORS.ironArmor : COLORS.leatherArmor;
}

function appendArmor(writer: VertexWriter, state: RemoteAvatarMotion, stride: number, rightArmPitch: number): void {
  const headYaw = state.rendered.yaw;
  const headPitch = state.rendered.pitch * 0.32;
  if (state.armorHead) {
    const color = armorColor(state.armorHead);
    appendBox(writer,state,headYaw,headPitch,1.75,0,-0.28,1.91,-0.28,0.28,2.05,0.28,color);
    appendBox(writer,state,headYaw,headPitch,1.75,0,-0.28,1.52,-0.28,-0.23,1.94,0.28,color);
    appendBox(writer,state,headYaw,headPitch,1.75,0,0.23,1.52,-0.28,0.28,1.94,0.28,color);
  }
  if (state.armorChest) {
    const color = armorColor(state.armorChest);
    appendBox(writer,state,state.bodyYaw,0,0,0,-0.27,0.73,-0.15,0.27,1.52,0.15,color);
    appendBox(writer,state,state.bodyYaw,-stride*0.9,1.50,0,-0.52,1.20,-0.15,-0.23,1.52,0.15,color);
    appendBox(writer,state,state.bodyYaw,rightArmPitch,1.50,0,0.23,1.20,-0.15,0.52,1.52,0.15,color);
  }
  if (state.armorLegs) {
    const color = armorColor(state.armorLegs);
    appendBox(writer,state,state.bodyYaw,stride,0.75,0,-0.27,0.10,-0.15,0.01,0.77,-0.13,color);
    appendBox(writer,state,state.bodyYaw,-stride,0.75,0,-0.01,0.10,-0.15,0.27,0.77,-0.13,color);
  }
  if (state.armorFeet) {
    const color = armorColor(state.armorFeet);
    appendBox(writer,state,state.bodyYaw,stride,0.75,0,-0.27,-0.01,-0.15,0.01,0.27,0.18,color);
    appendBox(writer,state,state.bodyYaw,-stride,0.75,0,-0.01,-0.01,-0.15,0.27,0.27,0.18,color);
  }
}

const HELD_ITEM_QUAD = Object.freeze([
  Object.freeze([0, 0]), Object.freeze([1, 0]), Object.freeze([1, 1]),
  Object.freeze([0, 0]), Object.freeze([1, 1]), Object.freeze([0, 1]),
] as const);

function appendHeldItem(writer: VertexWriter, state: RemoteAvatarMotion, rightArmPitch: number): void {
  const itemId = state.heldItem;
  if (!itemId) return;
  const rectangles = remoteHeldItemRects(itemId, state.bowDrawing);
  const unit = 0.066;
  const socketX = 0.445;
  const socketY = 0.70;
  const socketZ = -0.165;
  const pivotX = 4;
  const pivotY = 6.4;
  const cosPitch = Math.cos(rightArmPitch);
  const sinPitch = Math.sin(rightArmPitch);
  const cosYaw = Math.cos(state.bodyYaw);
  const sinYaw = Math.sin(state.bodyYaw);
  for (const rect of rectangles) for (const point of HELD_ITEM_QUAD) {
    const localX = socketX + (rect.x + rect.width * point[0] - pivotX) * unit;
    const unrotatedY = socketY + (pivotY - rect.y - rect.height * point[1]) * unit;
    const offsetY = unrotatedY - 1.50;
    const localY = 1.50 + offsetY * cosPitch - socketZ * sinPitch;
    const localZ = offsetY * sinPitch + socketZ * cosPitch;
    writeVertex(
      writer,
      state.rendered.x + localX * cosYaw - localZ * sinYaw,
      state.rendered.y + localY,
      state.rendered.z + localX * sinYaw + localZ * cosYaw,
      rect.color,
      0.94,
    );
  }
}

function appendAvatar(writer: VertexWriter, state: RemoteAvatarMotion): void {
  const stride = Math.min(0.72, state.horizontalSpeed * 0.16) * Math.sin(state.walkPhase);
  const rightArmPitch = state.bowDrawing ? -1.12 : stride * 0.9 - state.armActionPhase * 1.8;
  // Core proportions match the bundled standard-skin rig exactly: 4 px legs
  // and arms, an 8×12 px torso, and an 8 px head at 1/16 world units/pixel.
  appendBox(writer,state,state.bodyYaw,stride,0.75,0,-0.25,0,-0.125,0,0.75,0.125,COLORS.trousers);
  appendBox(writer,state,state.bodyYaw,-stride,0.75,0,0,0,-0.125,0.25,0.75,0.125,COLORS.trousers);
  appendBox(writer,state,state.bodyYaw,stride,0.75,0,-0.25,0,-0.13,0,0.25,0.13,COLORS.boots);
  appendBox(writer,state,state.bodyYaw,-stride,0.75,0,0,0,-0.13,0.25,0.25,0.13,COLORS.boots);
  appendBox(writer,state,state.bodyYaw,0,0,0,-0.25,0.75,-0.125,0.25,1.50,0.125,COLORS.jacket);
  appendBox(writer,state,state.bodyYaw,-stride*0.9,1.50,0,-0.50,0.75,-0.125,-0.25,1.50,0.125,COLORS.skin);
  appendBox(writer,state,state.bodyYaw,rightArmPitch,1.50,0,0.25,0.75,-0.125,0.50,1.50,0.125,COLORS.skin);
  appendBox(writer,state,state.bodyYaw,-stride*0.9,1.50,0,-0.505,1.25,-0.13,-0.245,1.505,0.13,COLORS.jacket);
  appendBox(writer,state,state.bodyYaw,rightArmPitch,1.50,0,0.245,1.25,-0.13,0.505,1.505,0.13,COLORS.jacket);
  const headYaw = state.rendered.yaw;
  const headPitch = state.rendered.pitch * 0.32;
  appendBox(writer,state,headYaw,headPitch,1.75,0,-0.25,1.50,-0.25,0.25,2.00,0.25,COLORS.skin);
  appendBox(writer,state,headYaw,headPitch,1.75,0,-0.255,1.93,-0.255,0.255,2.005,0.255,COLORS.hair);
  appendBox(writer,state,headYaw,headPitch,1.75,0,-0.255,1.72,0.245,0.255,1.94,0.255,COLORS.hair);
  appendBox(writer,state,headYaw,headPitch,1.75,0,-0.19,1.83,-0.255,0.19,1.94,-0.245,COLORS.hair);
  // The bright scarf is the bundled explorer's distance-readable signature.
  appendBox(writer,state,state.bodyYaw,0,0,0,-0.13,1.365,-0.14,0.13,1.485,-0.125,COLORS.scarf);
  appendBox(writer,state,headYaw,headPitch,1.75,0,-0.15,1.69,-0.255,-0.06,1.75,-0.245,COLORS.eye);
  appendBox(writer,state,headYaw,headPitch,1.75,0,0.06,1.69,-0.255,0.15,1.75,-0.245,COLORS.eye);
  appendBox(writer,state,headYaw,headPitch,1.75,0,-0.08,1.57,-0.256,0.08,1.61,-0.245,COLORS.mouth);
  appendArmor(writer, state, stride, rightArmPitch);
  appendHeldItem(writer, state, rightArmPitch);
}

function appendBillboardQuad(
  writer: VertexWriter,
  centerX: number,
  centerY: number,
  centerZ: number,
  rightX: number,
  rightZ: number,
  normalX: number,
  normalZ: number,
  left: number,
  bottom: number,
  width: number,
  height: number,
  depth: number,
  color: Vec3,
): void {
  const ax = centerX + rightX * left + normalX * depth;
  const az = centerZ + rightZ * left + normalZ * depth;
  const bx = centerX + rightX * (left + width) + normalX * depth;
  const bz = centerZ + rightZ * (left + width) + normalZ * depth;
  const lowY = centerY + bottom;
  const highY = lowY + height;
  writeVertex(writer, ax, lowY, az, color);
  writeVertex(writer, bx, lowY, bz, color);
  writeVertex(writer, bx, highY, bz, color);
  writeVertex(writer, ax, lowY, az, color);
  writeVertex(writer, bx, highY, bz, color);
  writeVertex(writer, ax, highY, az, color);
}

function appendNameplate(writer: VertexWriter, state: RemoteAvatarMotion, camera: Vec3): void {
  const centerX = state.rendered.x;
  const centerY = state.rendered.y + 2.13;
  const centerZ = state.rendered.z;
  let normalX = camera[0] - centerX;
  let normalZ = camera[2] - centerZ;
  const length = Math.hypot(normalX, normalZ) || 1;
  normalX /= length;
  normalZ /= length;
  const rightX = normalZ;
  const rightZ = -normalX;
  const pixel = 0.025;
  const advance = pixel * 4;
  const textWidth = Math.max(pixel * 3, state.name.length * advance - pixel);
  appendBillboardQuad(writer,centerX,centerY,centerZ,rightX,rightZ,normalX,normalZ,-textWidth/2-0.055,-0.045,textWidth+0.11,0.225,0,COLORS.nameBackground);
  const startX = -textWidth / 2;
  for (let characterIndex = 0; characterIndex < state.name.length; characterIndex += 1) {
    const character = state.name[characterIndex].toUpperCase();
    const glyph = character.length === 1 ? NAMEPLATE_FONT[character.charCodeAt(0)] ?? NAMEPLATE_FONT[63] : NAMEPLATE_FONT[63];
    for (let row = 0; row < 5; row += 1) {
      for (let column = 0; column < 3; column += 1) {
        if (!(glyph & 1 << (14 - row * 3 - column))) continue;
        appendBillboardQuad(
          writer, centerX, centerY, centerZ, rightX, rightZ, normalX, normalZ,
          startX + characterIndex * advance + column * pixel,
          0.015 + (4 - row) * pixel,
          pixel * 0.82, pixel * 0.82, 0.006, COLORS.nameText,
        );
      }
    }
  }
}

/** Writes into caller-owned fixed buffers without allocating geometry arrays. */
export function writeRemotePlayerGeometry(
  states: ReadonlyMap<string, RemoteAvatarMotion>,
  camera: Vec3,
  avatarData: Float32Array,
  nameplateData: Float32Array,
  stats: RemoteGeometryStats,
): RemoteGeometryStats {
  const avatarWriter: VertexWriter = { data: avatarData, offset: 0 };
  const nameplateWriter: VertexWriter = { data: nameplateData, offset: 0 };
  let visited = 0;
  let visible = 0;
  for (const state of states.values()) {
    if (visited >= MAX_REMOTE_PLAYERS) break;
    visited += 1;
    const dx = state.rendered.x - camera[0];
    const dz = state.rendered.z - camera[2];
    if (dx * dx + dz * dz > REMOTE_RENDER_DISTANCE_SQUARED) continue;
    appendAvatar(avatarWriter, state);
    appendNameplate(nameplateWriter, state, camera);
    visible += 1;
  }
  stats.avatarVertexCount = avatarWriter.offset / FLOATS_PER_VERTEX;
  stats.nameplateVertexCount = nameplateWriter.offset / FLOATS_PER_VERTEX;
  stats.visiblePlayerCount = visible;
  return stats;
}

export function createRemotePlayerRenderer(gl: WebGLRenderingContext): RemotePlayerRenderer {
  const avatarBuffer = gl.createBuffer();
  const nameplateBuffer = gl.createBuffer();
  if (!avatarBuffer || !nameplateBuffer) throw new Error("Unable to allocate remote player buffers.");
  const capacity = remotePlayerBufferCapacity();
  const avatarData = new Float32Array(capacity.avatarFloats);
  const nameplateData = new Float32Array(capacity.nameplateFloats);
  let avatarUploadView = avatarData.subarray(0, 0);
  let nameplateUploadView = nameplateData.subarray(0, 0);
  let avatarUploadFloats = 0;
  let nameplateUploadFloats = 0;
  let lastMeshAt = -Infinity;
  const stats: RemotePlayerRenderStats = {
    avatarVertexCount: 0,
    nameplateVertexCount: 0,
    visiblePlayerCount: 0,
    meshMs: 0,
    uploadBytes: 0,
    meshUpdates: 0,
    updated: false,
  };
  gl.bindBuffer(gl.ARRAY_BUFFER, avatarBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, avatarData.byteLength, gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, nameplateBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, nameplateData.byteLength, gl.DYNAMIC_DRAW);

  return {
    avatarBuffer,
    nameplateBuffer,
    stats,
    update(states, now, deltaSeconds, camera) {
      for (const state of states.values()) advanceRemoteAvatarMotion(state, now, deltaSeconds);
      stats.updated = false;
      if (states.size === 0) {
        stats.avatarVertexCount = 0;
        stats.nameplateVertexCount = 0;
        stats.visiblePlayerCount = 0;
        stats.meshMs = 0;
        stats.uploadBytes = 0;
        return stats;
      }
      if (now - lastMeshAt < REMOTE_MESH_INTERVAL_MS) return stats;
      const startedAt = performance.now();
      writeRemotePlayerGeometry(states, camera, avatarData, nameplateData, stats);
      const nextAvatarFloats = stats.avatarVertexCount * FLOATS_PER_VERTEX;
      const nextNameplateFloats = stats.nameplateVertexCount * FLOATS_PER_VERTEX;
      // Views are recreated only when visible geometry size changes, never in steady state.
      if (nextAvatarFloats !== avatarUploadFloats) {
        avatarUploadFloats = nextAvatarFloats;
        avatarUploadView = avatarData.subarray(0, avatarUploadFloats);
      }
      if (nextNameplateFloats !== nameplateUploadFloats) {
        nameplateUploadFloats = nextNameplateFloats;
        nameplateUploadView = nameplateData.subarray(0, nameplateUploadFloats);
      }
      if (avatarUploadFloats > 0) {
        gl.bindBuffer(gl.ARRAY_BUFFER, avatarBuffer);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, avatarUploadView);
      }
      if (nameplateUploadFloats > 0) {
        gl.bindBuffer(gl.ARRAY_BUFFER, nameplateBuffer);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, nameplateUploadView);
      }
      stats.meshMs = performance.now() - startedAt;
      stats.uploadBytes = (avatarUploadFloats + nameplateUploadFloats) * Float32Array.BYTES_PER_ELEMENT;
      stats.meshUpdates += 1;
      stats.updated = true;
      lastMeshAt = now;
      return stats;
    },
    destroy() {
      gl.deleteBuffer(avatarBuffer);
      gl.deleteBuffer(nameplateBuffer);
    },
  };
}
