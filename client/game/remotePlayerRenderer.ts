import {
  MAX_PLAYER_NAME_LENGTH,
  MAX_REMOTE_PLAYERS,
  advanceRemoteAvatarMotion,
  type RemoteAvatarMotion,
} from "./avatar.ts";
import { ITEMS, type ArmorId, type ItemId } from "../../shared/game.ts";

type Vec3 = readonly [number, number, number];

const FLOATS_PER_VERTEX = 6;
const VERTICES_PER_BOX = 36;
const BASE_AVATAR_BOXES = 17;
const MAX_ARMOR_BOXES = 10;
const MAX_HELD_ITEM_BOXES = 2;
const MAX_GLYPH_PIXELS = 15;
const REMOTE_RENDER_DISTANCE_SQUARED = 64 * 64;

export const REMOTE_MESH_INTERVAL_MS = 1_000 / 30;
export const BASE_AVATAR_VERTICES_PER_PLAYER = BASE_AVATAR_BOXES * VERTICES_PER_BOX;
export const MAX_ARMOR_VERTICES_PER_PLAYER = MAX_ARMOR_BOXES * VERTICES_PER_BOX;
export const MAX_HELD_ITEM_VERTICES_PER_PLAYER = MAX_HELD_ITEM_BOXES * VERTICES_PER_BOX;
/** Worst-case fixed avatar capacity, including a two-box tool and all armor. */
export const AVATAR_VERTICES_PER_PLAYER = BASE_AVATAR_VERTICES_PER_PLAYER
  + MAX_ARMOR_VERTICES_PER_PLAYER
  + MAX_HELD_ITEM_VERTICES_PER_PLAYER;
export const MAX_NAMEPLATE_VERTICES_PER_PLAYER = 6 + MAX_PLAYER_NAME_LENGTH * MAX_GLYPH_PIXELS * 6;

const BOX_FACES: ReadonlyArray<{ shade: number; vertices: ReadonlyArray<Vec3> }> = [
  { shade: 0.79, vertices: [[1,0,0],[1,1,0],[1,1,1],[1,0,0],[1,1,1],[1,0,1]] },
  { shade: 0.68, vertices: [[0,0,1],[0,1,1],[0,1,0],[0,0,1],[0,1,0],[0,0,0]] },
  { shade: 1, vertices: [[0,1,0],[0,1,1],[1,1,1],[0,1,0],[1,1,1],[1,1,0]] },
  { shade: 0.52, vertices: [[0,0,1],[0,0,0],[1,0,0],[0,0,1],[1,0,0],[1,0,1]] },
  { shade: 0.88, vertices: [[1,0,1],[1,1,1],[0,1,1],[1,0,1],[0,1,1],[0,0,1]] },
  { shade: 0.73, vertices: [[0,0,0],[0,1,0],[1,1,0],[0,0,0],[1,1,0],[1,0,0]] },
];

const FONT: Readonly<Record<string, string>> = {
  A: "010101111101101", B: "110101110101110", C: "011100100100011", D: "110101101101110",
  E: "111100110100111", F: "111100110100100", G: "011100101101011", H: "101101111101101",
  I: "111010010010111", J: "001001001101010", K: "101101110101101", L: "100100100100111",
  M: "101111111101101", N: "101111111111101", O: "010101101101010", P: "110101110100100",
  Q: "010101101111011", R: "110101110101101", S: "011100010001110", T: "111010010010010",
  U: "101101101101111", V: "101101101101010", W: "101101111111101", X: "101101010101101",
  Y: "101101010010010", Z: "111001010100111",
  "0": "111101101101111", "1": "010110010010111", "2": "110001111100111", "3": "110001011001110",
  "4": "101101111001001", "5": "111100110001110", "6": "011100111101111", "7": "111001010010010",
  "8": "111101111101111", "9": "111101111001110", "?": "110001010000010", "-": "000000111000000",
  "_": "000000000000111", ".": "000000000000010", " ": "000000000000000",
};

const COLORS = {
  skin: [0.72, 0.50, 0.34] as Vec3,
  skinHighlight: [0.82, 0.60, 0.43] as Vec3,
  shirt: [0.05, 0.53, 0.55] as Vec3,
  pants: [0.12, 0.20, 0.58] as Vec3,
  shoes: [0.14, 0.12, 0.13] as Vec3,
  hair: [0.18, 0.10, 0.055] as Vec3,
  eye: [0.08, 0.19, 0.30] as Vec3,
  mouth: [0.30, 0.13, 0.10] as Vec3,
  leatherArmor: [0.48, 0.25, 0.11] as Vec3,
  ironArmor: [0.72, 0.74, 0.72] as Vec3,
  goldArmor: [0.92, 0.72, 0.12] as Vec3,
  diamondArmor: [0.20, 0.76, 0.74] as Vec3,
  toolHandle: [0.43, 0.27, 0.11] as Vec3,
  woodItem: [0.58, 0.36, 0.16] as Vec3,
  stoneItem: [0.43, 0.45, 0.44] as Vec3,
  ironItem: [0.76, 0.78, 0.76] as Vec3,
  goldItem: [0.94, 0.76, 0.16] as Vec3,
  diamondItem: [0.20, 0.82, 0.79] as Vec3,
  greenItem: [0.28, 0.51, 0.20] as Vec3,
  sandItem: [0.78, 0.69, 0.45] as Vec3,
  glassItem: [0.54, 0.77, 0.79] as Vec3,
  coalItem: [0.14, 0.15, 0.14] as Vec3,
  woolItem: [0.84, 0.82, 0.76] as Vec3,
  redItem: [0.66, 0.22, 0.18] as Vec3,
  nameBackground: [0.025, 0.028, 0.035] as Vec3,
  nameText: [0.94, 0.95, 0.90] as Vec3,
};

interface VertexWriter {
  data: Float32Array;
  offset: number;
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
  for (let faceIndex = 0; faceIndex < BOX_FACES.length; faceIndex += 1) {
    const face = BOX_FACES[faceIndex];
    for (let vertexIndex = 0; vertexIndex < face.vertices.length; vertexIndex += 1) {
      const point = face.vertices[vertexIndex];
      const localX = minX + point[0] * (maxX - minX);
      const unrotatedY = minY + point[1] * (maxY - minY);
      const unrotatedZ = minZ + point[2] * (maxZ - minZ);
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
        face.shade,
      );
    }
  }
}

function armorColor(itemId: ArmorId): Vec3 {
  if (itemId.startsWith("diamond_")) return COLORS.diamondArmor;
  if (itemId.startsWith("golden_")) return COLORS.goldArmor;
  return itemId.startsWith("iron_") ? COLORS.ironArmor : COLORS.leatherArmor;
}

function heldItemColor(itemId: ItemId): Vec3 {
  const tool = ITEMS[itemId].tool;
  if (tool?.tier === "diamond") return COLORS.diamondItem;
  if (tool?.tier === "gold") return COLORS.goldItem;
  if (tool?.tier === "iron") return COLORS.ironItem;
  if (tool?.tier === "stone") return COLORS.stoneItem;
  if (tool) return COLORS.woodItem;
  switch (itemId) {
    case "grass":
    case "leaves": return COLORS.greenItem;
    case "stone":
    case "cobblestone":
    case "furnace":
    case "coal_ore": return COLORS.stoneItem;
    case "iron_ore":
    case "raw_iron":
    case "iron_ingot": return COLORS.ironItem;
    case "gold_ore":
    case "raw_gold":
    case "gold_ingot": return COLORS.goldItem;
    case "diamond_ore":
    case "diamond": return COLORS.diamondItem;
    case "sand": return COLORS.sandItem;
    case "glass": return COLORS.glassItem;
    case "coal": return COLORS.coalItem;
    case "wool": return COLORS.woolItem;
    case "bed":
    case "pork":
    case "beef":
    case "mutton":
    case "cooked_pork":
    case "cooked_beef":
    case "cooked_mutton":
    case "rotten_flesh": return COLORS.redItem;
    default: return COLORS.woodItem;
  }
}

function appendArmor(writer: VertexWriter, state: RemoteAvatarMotion, stride: number, rightArmPitch: number): void {
  const headYaw = state.rendered.yaw;
  const headPitch = state.rendered.pitch * 0.32;
  if (state.armorHead) {
    const color = armorColor(state.armorHead);
    appendBox(writer,state,headYaw,headPitch,1.62,0,-0.28,1.84,-0.28,0.28,1.94,0.28,color);
    appendBox(writer,state,headYaw,headPitch,1.62,0,-0.28,1.47,-0.28,-0.23,1.86,0.28,color);
    appendBox(writer,state,headYaw,headPitch,1.62,0,0.23,1.47,-0.28,0.28,1.86,0.28,color);
  }
  if (state.armorChest) {
    const color = armorColor(state.armorChest);
    appendBox(writer,state,state.bodyYaw,0,0,0,-0.35,0.70,-0.205,0.35,1.40,-0.18,color);
    appendBox(writer,state,state.bodyYaw,-stride*0.9,1.31,0,-0.57,1.14,-0.16,-0.33,1.42,0.16,color);
    appendBox(writer,state,state.bodyYaw,rightArmPitch,1.31,0,0.33,1.14,-0.16,0.57,1.42,0.16,color);
  }
  if (state.armorLegs) {
    const color = armorColor(state.armorLegs);
    appendBox(writer,state,state.bodyYaw,stride,0.69,0,-0.27,0.10,-0.17,-0.01,0.73,-0.14,color);
    appendBox(writer,state,state.bodyYaw,-stride,0.69,0,0.01,0.10,-0.17,0.27,0.73,-0.14,color);
  }
  if (state.armorFeet) {
    const color = armorColor(state.armorFeet);
    appendBox(writer,state,state.bodyYaw,stride,0.69,0,-0.27,-0.01,-0.17,-0.01,0.17,0.18,color);
    appendBox(writer,state,state.bodyYaw,-stride,0.69,0,0.01,-0.01,-0.17,0.27,0.17,0.18,color);
  }
}

function appendHeldItem(writer: VertexWriter, state: RemoteAvatarMotion, rightArmPitch: number): void {
  const itemId = state.heldItem;
  if (!itemId) return;
  const item = ITEMS[itemId];
  const armPitch = rightArmPitch;
  const color = heldItemColor(itemId);
  if (itemId === "bow") {
    appendBox(writer,state,state.bodyYaw,armPitch,1.31,0,0.43,0.26,-0.07,0.48,0.58,-0.02,COLORS.toolHandle);
    appendBox(writer,state,state.bodyYaw,armPitch,1.31,0,0.43,0.57,-0.07,0.48,0.91,-0.02,color);
    return;
  }
  if (!item.tool) {
    appendBox(writer,state,state.bodyYaw,armPitch,1.31,0,0.35,0.43,-0.25,0.62,0.70,0.02,color);
    return;
  }
  appendBox(writer,state,state.bodyYaw,armPitch,1.31,0,0.44,0.28,-0.08,0.50,0.80,-0.02,COLORS.toolHandle);
  switch (item.tool.kind) {
    case "sword":
      appendBox(writer,state,state.bodyYaw,armPitch,1.31,0,0.40,0.08,-0.07,0.54,0.54,-0.03,color);
      break;
    case "pickaxe":
      appendBox(writer,state,state.bodyYaw,armPitch,1.31,0,0.29,0.22,-0.08,0.65,0.34,-0.02,color);
      break;
    case "axe":
      appendBox(writer,state,state.bodyYaw,armPitch,1.31,0,0.38,0.18,-0.09,0.59,0.42,-0.01,color);
      break;
    default:
      appendBox(writer,state,state.bodyYaw,armPitch,1.31,0,0.39,0.16,-0.10,0.55,0.37,0,color);
      break;
  }
}

function appendAvatar(writer: VertexWriter, state: RemoteAvatarMotion): void {
  const stride = Math.min(0.72, state.horizontalSpeed * 0.16) * Math.sin(state.walkPhase);
  const rightArmPitch = state.bowDrawing ? -1.12 : stride * 0.9 - state.armActionPhase * 1.8;
  appendBox(writer,state,state.bodyYaw,stride,0.69,0,-0.26,0.08,-0.14,-0.02,0.72,0.14,COLORS.pants);
  appendBox(writer,state,state.bodyYaw,-stride,0.69,0,0.02,0.08,-0.14,0.26,0.72,0.14,COLORS.pants);
  appendBox(writer,state,state.bodyYaw,stride,0.69,0,-0.26,0,-0.15,-0.02,0.12,0.16,COLORS.shoes);
  appendBox(writer,state,state.bodyYaw,-stride,0.69,0,0.02,0,-0.15,0.26,0.12,0.16,COLORS.shoes);
  appendBox(writer,state,state.bodyYaw,0,0,0,-0.34,0.69,-0.18,0.34,1.39,0.18,COLORS.shirt);
  appendBox(writer,state,state.bodyYaw,-stride*0.9,1.31,0,-0.55,0.68,-0.14,-0.34,1.18,0.14,COLORS.skin);
  appendBox(writer,state,state.bodyYaw,rightArmPitch,1.31,0,0.34,0.68,-0.14,0.55,1.18,0.14,COLORS.skin);
  appendBox(writer,state,state.bodyYaw,-stride*0.9,1.31,0,-0.55,1.17,-0.145,-0.34,1.4,0.145,COLORS.shirt);
  appendBox(writer,state,state.bodyYaw,rightArmPitch,1.31,0,0.34,1.17,-0.145,0.55,1.4,0.145,COLORS.shirt);
  const headYaw = state.rendered.yaw;
  const headPitch = state.rendered.pitch * 0.32;
  appendBox(writer,state,headYaw,headPitch,1.62,0,-0.25,1.39,-0.25,0.25,1.89,0.25,COLORS.skinHighlight);
  appendBox(writer,state,headYaw,headPitch,1.62,0,-0.26,1.80,-0.26,0.26,1.91,0.26,COLORS.hair);
  appendBox(writer,state,headYaw,headPitch,1.62,0,-0.26,1.70,0.245,0.26,1.84,0.27,COLORS.hair);
  appendBox(writer,state,headYaw,headPitch,1.62,0,-0.19,1.72,-0.27,-0.04,1.79,-0.245,COLORS.hair);
  appendBox(writer,state,headYaw,headPitch,1.62,0,0.11,1.72,-0.27,0.25,1.79,-0.245,COLORS.hair);
  appendBox(writer,state,headYaw,headPitch,1.62,0,-0.15,1.63,-0.272,-0.06,1.69,-0.248,COLORS.eye);
  appendBox(writer,state,headYaw,headPitch,1.62,0,0.06,1.63,-0.272,0.15,1.69,-0.248,COLORS.eye);
  appendBox(writer,state,headYaw,headPitch,1.62,0,-0.08,1.50,-0.273,0.08,1.54,-0.248,COLORS.mouth);
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
    const glyph = FONT[state.name[characterIndex].toUpperCase()] ?? FONT["?"];
    for (let row = 0; row < 5; row += 1) {
      for (let column = 0; column < 3; column += 1) {
        if (glyph[row * 3 + column] !== "1") continue;
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

/** Writes into caller-owned fixed buffers and allocates no arrays or typed arrays. */
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
