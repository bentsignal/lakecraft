import {
  MAX_PLAYER_NAME_LENGTH,
  MAX_REMOTE_PLAYERS,
  advanceRemoteAvatarMotion,
  resolveRemoteAvatarRigPose,
  writeRemoteAvatarDeathLocal,
  type RemoteAvatarMotion,
} from "./avatar.ts";
import { type ItemId } from "../../shared/game.ts";
import { NAMEPLATE_FONT } from "./generated/renderGeometry.ts";
import { PLAYER_SKIN_BOX_COUNT, PLAYER_SKIN_VERTEX_COUNT } from "./playerSkinGeometry.ts";
import { writePlayerRigPartMatrix, type PlayerRigPart, type PlayerRigPose } from "./playerRig.ts";
import { REMOTE_ARMOR_VERTICES_PER_PLAYER as MAX_ARMOR_VERTICES_PER_PLAYER } from "./remotePlayerSkinRenderer.ts";
import { buildThirdPersonHeldItemGeometry } from "./thirdPersonHeldItem.ts";
import { BLOCK_ITEM_CUBE_MAX_VERTICES } from "./blockItemCubeGeometry.ts";

type Vec3 = readonly [number, number, number];

const FLOATS_PER_VERTEX = 6;
export const REMOTE_DEFAULT_PLAYER_BOX_COUNT = PLAYER_SKIN_BOX_COUNT;
export const REMOTE_DEFAULT_PLAYER_HEIGHT = 2;
const MAX_GLYPH_RECTS = 21;
const REMOTE_RENDER_DISTANCE_SQUARED = (21 * 16) ** 2;

export const REMOTE_MESH_INTERVAL_MS = 1_000 / 30;
export const BASE_AVATAR_VERTICES_PER_PLAYER = PLAYER_SKIN_VERTEX_COUNT;
export { MAX_ARMOR_VERTICES_PER_PLAYER };
/** Exact shared local/remote block cube, or the largest installed extruded sprite. */
export const MAX_HELD_ITEM_VERTICES_PER_PLAYER = Math.max(BLOCK_ITEM_CUBE_MAX_VERTICES, 2_040);
/** Worst-case visible avatar capacity across the textured skin/armor and colored held-item batches. */
export const AVATAR_VERTICES_PER_PLAYER = BASE_AVATAR_VERTICES_PER_PLAYER
  + MAX_ARMOR_VERTICES_PER_PLAYER
  + MAX_HELD_ITEM_VERTICES_PER_PLAYER;
export const MAX_NAMEPLATE_VERTICES_PER_PLAYER = 6 + MAX_PLAYER_NAME_LENGTH * MAX_GLYPH_RECTS * 6;

const COLORS = {
  nameBackground: [0.025, 0.028, 0.035] as Vec3,
  nameText: [0.94, 0.95, 0.90] as Vec3,
};
const GEAR_PART_MATRIX = new Float32Array(16);
const GEAR_RIG_SCRATCH_MATRIX = new Float32Array(16);
const GEAR_RIG_POSE = {} as PlayerRigPose;
const GEAR_DEATH_LOCAL = new Float32Array(2);

interface VertexWriter {
  data: Float32Array;
  offset: number;
}

const REMOTE_HELD_ITEM_GEOMETRY = new Map<string, Float32Array>();

export function remoteHeldItemGeometry(itemId: ItemId, bowDrawing = false): Float32Array {
  const key = `${itemId}:${Number(bowDrawing)}`;
  let geometry = REMOTE_HELD_ITEM_GEOMETRY.get(key);
  if (!geometry) {
    geometry = buildThirdPersonHeldItemGeometry(itemId, undefined, bowDrawing);
    if (geometry.length / FLOATS_PER_VERTEX > MAX_HELD_ITEM_VERTICES_PER_PLAYER) {
      throw new Error(`Remote held item ${itemId} exceeded its reviewed geometry budget.`);
    }
    REMOTE_HELD_ITEM_GEOMETRY.set(key, geometry);
  }
  return geometry;
}

export function remoteHeldItemVertexCount(itemId: ItemId, bowDrawing = false): number {
  return remoteHeldItemGeometry(itemId, bowDrawing).length / FLOATS_PER_VERTEX;
}

export interface RemoteGeometryStats {
  avatarVertexCount: number;
  skinVertexCount: number;
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
  skinFloats: number;
  nameplateFloats: number;
  totalBytes: number;
} {
  const count = Math.max(0, Math.min(MAX_REMOTE_PLAYERS, Math.floor(playerCount)));
  const avatarFloats = count * MAX_HELD_ITEM_VERTICES_PER_PLAYER * FLOATS_PER_VERTEX;
  const skinFloats = count * BASE_AVATAR_VERTICES_PER_PLAYER * FLOATS_PER_VERTEX;
  const nameplateFloats = count * MAX_NAMEPLATE_VERTICES_PER_PLAYER * FLOATS_PER_VERTEX;
  return {
    avatarFloats,
    nameplateFloats,
    skinFloats,
    totalBytes: (avatarFloats + skinFloats + nameplateFloats) * Float32Array.BYTES_PER_ELEMENT,
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

function writeRigVertex(
  writer: VertexWriter,
  state: RemoteAvatarMotion,
  cosine: number,
  sine: number,
  x: number,
  y: number,
  z: number,
  color: Vec3,
  shade = 1,
): void {
  const localX = GEAR_PART_MATRIX[0] * x + GEAR_PART_MATRIX[4] * y + GEAR_PART_MATRIX[8] * z + GEAR_PART_MATRIX[12];
  const localY = GEAR_PART_MATRIX[1] * x + GEAR_PART_MATRIX[5] * y + GEAR_PART_MATRIX[9] * z + GEAR_PART_MATRIX[13];
  const localZ = GEAR_PART_MATRIX[2] * x + GEAR_PART_MATRIX[6] * y + GEAR_PART_MATRIX[10] * z + GEAR_PART_MATRIX[14];
  writeRemoteAvatarDeathLocal(state, localX, localY, GEAR_DEATH_LOCAL);
  const deathX = GEAR_DEATH_LOCAL[0];
  const deathY = GEAR_DEATH_LOCAL[1];
  writeVertex(
    writer,
    state.rendered.x + cosine * deathX + sine * localZ,
    state.rendered.y + deathY,
    state.rendered.z - sine * deathX + cosine * localZ,
    state.hurtFlash
      ? [Math.min(1, color[0] * 0.45 + 0.55), color[1] * 0.35, color[2] * 0.35]
      : color,
    shade,
  );
}

function selectGearPart(part: PlayerRigPart, pose: PlayerRigPose, remapStandardSkinSides = false): void {
  writePlayerRigPartMatrix(GEAR_PART_MATRIX, part, pose, "wide", remapStandardSkinSides, GEAR_RIG_SCRATCH_MATRIX);
}

function appendHeldItem(
  writer: VertexWriter,
  state: RemoteAvatarMotion,
  rig: PlayerRigPose,
  cosine: number,
  sine: number,
): void {
  const itemId = state.heldItem;
  if (!itemId) return;
  const geometry = remoteHeldItemGeometry(itemId, state.bowDrawing);
  selectGearPart("rightArm", rig, true);
  for (let offset = 0; offset < geometry.length; offset += FLOATS_PER_VERTEX) {
    writeRigVertex(writer, state, cosine, sine, geometry[offset], geometry[offset + 1], geometry[offset + 2], [
      geometry[offset + 3], geometry[offset + 4], geometry[offset + 5],
    ]);
  }
}

function appendAvatarGear(writer: VertexWriter, state: RemoteAvatarMotion): void {
  const rig = resolveRemoteAvatarRigPose(state, GEAR_RIG_POSE);
  const angle = Math.PI - state.bodyYaw;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  appendHeldItem(writer, state, rig, cosine, sine);
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
  const pixel = 0.018;
  const advance = pixel * 6;
  const textWidth = Math.max(pixel * 5, state.name.length * advance - pixel);
  appendBillboardQuad(writer,centerX,centerY,centerZ,rightX,rightZ,normalX,normalZ,-textWidth/2-0.05,-0.035,textWidth+0.1,0.205,0,COLORS.nameBackground);
  const startX = -textWidth / 2;
  for (let characterIndex = 0; characterIndex < state.name.length; characterIndex += 1) {
    const character = state.name[characterIndex].toUpperCase();
    const code = character.length === 1 && character.charCodeAt(0) < 96 ? character.charCodeAt(0) : 63;
    for (let row = 0; row < 7; row += 1) {
      const bits = NAMEPLATE_FONT[code * 7 + row];
      for (let column = 0; column < 5;) {
        if (!(bits & 1 << (4 - column))) { column += 1; continue; }
        let run = 1;
        while (column + run < 5 && (bits & 1 << (4 - column - run))) run += 1;
        appendBillboardQuad(
          writer, centerX, centerY, centerZ, rightX, rightZ, normalX, normalZ,
          startX + characterIndex * advance + column * pixel,
          0.01 + (6 - row) * pixel,
          pixel * (run - 0.16), pixel * 0.84, 0.006, COLORS.nameText,
        );
        column += run;
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
    if (state.deathHidden) continue;
    const dx = state.rendered.x - camera[0];
    const dz = state.rendered.z - camera[2];
    if (dx * dx + dz * dz > REMOTE_RENDER_DISTANCE_SQUARED) continue;
    appendAvatarGear(avatarWriter, state);
    appendNameplate(nameplateWriter, state, camera);
    visible += 1;
  }
  stats.avatarVertexCount = avatarWriter.offset / FLOATS_PER_VERTEX;
  stats.skinVertexCount = visible * BASE_AVATAR_VERTICES_PER_PLAYER;
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
    skinVertexCount: 0,
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
        stats.skinVertexCount = 0;
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
