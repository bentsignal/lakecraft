import {
  HARD_MAX_MOB_POPULATION,
  MAX_MOB_PROJECTILES,
  type MobKind,
  type MobPoseSnapshot,
  type MobProjectileSnapshot,
} from "./mobs.ts";
import { TNT_FUSE_MS, TNT_MAX_ACTIVE_FUSES } from "../../shared/tntAuthority.ts";
import type { PrimedTntVisualFuse } from "./types.ts";

type Vec3 = readonly [number, number, number];

const BOX_FACES: ReadonlyArray<{ shade: number; vertices: ReadonlyArray<Vec3> }> = [
  { shade: 0.79, vertices: [[1,0,0],[1,1,0],[1,1,1],[1,0,0],[1,1,1],[1,0,1]] },
  { shade: 0.68, vertices: [[0,0,1],[0,1,1],[0,1,0],[0,0,1],[0,1,0],[0,0,0]] },
  { shade: 1, vertices: [[0,1,0],[0,1,1],[1,1,1],[0,1,0],[1,1,1],[1,1,0]] },
  { shade: 0.52, vertices: [[0,0,1],[0,0,0],[1,0,0],[0,0,1],[1,0,0],[1,0,1]] },
  { shade: 0.88, vertices: [[1,0,1],[1,1,1],[0,1,1],[1,0,1],[0,1,1],[0,0,1]] },
  { shade: 0.73, vertices: [[0,0,0],[0,1,0],[1,1,0],[0,0,0],[1,1,0],[1,0,0]] },
];

const BOXES_PER_KIND: Readonly<Record<MobKind, number>> = Object.freeze({
  pig: 9,
  cow: 9,
  sheep: 7,
  chicken: 9,
  zombie: 6,
  skeleton: 9,
  creeper: 9,
  spider: 12,
});

const FLOATS_PER_VERTEX = 6;
const VERTICES_PER_BOX = 36;
const MAX_BOXES_PER_MOB = 12;
const RENDER_DISTANCE_SQUARED = 30 * 30;
const PRIMED_TNT_RENDER_DISTANCE_SQUARED = 48 * 48;

export const MAX_PRIMED_TNT_VISUALS = TNT_MAX_ACTIVE_FUSES;
export const PRIMED_TNT_VERTICES_PER_ENTITY = 4 * VERTICES_PER_BOX;

export interface PrimedTntVisualSample {
  progress: number;
  scale: number;
  flashMix: number;
}

export function samplePrimedTntVisual(
  ignitedAt: number,
  dueAt: number,
  now: number,
  out: PrimedTntVisualSample,
): PrimedTntVisualSample {
  const elapsed = Math.max(0, now - ignitedAt);
  const progress = Math.max(0, Math.min(1, elapsed / Math.max(1, dueAt - ignitedAt)));
  const flashing = (Math.floor(elapsed / (380 - progress * 300)) & 1) === 1;
  out.progress = progress;
  out.flashMix = flashing ? 0.2 + progress * 0.72 : 0;
  const swell = Math.max(0, (progress - 0.72) / 0.28);
  out.scale = 0.98 + swell * swell * (flashing ? 0.1 : 0.045);
  return out;
}

export function primedTntBufferBytes(count = MAX_PRIMED_TNT_VISUALS): number {
  return Math.max(0, Math.min(MAX_PRIMED_TNT_VISUALS, Math.floor(count)))
    * PRIMED_TNT_VERTICES_PER_ENTITY * FLOATS_PER_VERTEX * Float32Array.BYTES_PER_ELEMENT;
}

export interface MobRenderStats {
  totalMobCount: number;
  visibleMobCount: number;
  vertexCount: number;
  projectileCount: number;
  projectileVertexCount: number;
  visiblePrimedTntCount: number;
  primedTntVertexCount: number;
}

export interface MobRenderer {
  readonly buffer: WebGLBuffer;
  readonly maximumPrimedTnt: number;
  setPrimedTntFuses(fuses: readonly PrimedTntVisualFuse[], authoritativeNow?: number): number;
  setLocalPrimedTnt(x: number, y: number, z: number, primed: boolean, now?: number): boolean;
  rebuild(
    poses: readonly MobPoseSnapshot[],
    cameraX: number,
    cameraZ: number,
    facingX: number,
    facingZ: number,
    interpolation: number,
    animationSeconds: number,
    projectiles?: readonly MobProjectileSnapshot[],
  ): MobRenderStats;
  destroy(): void;
}

export function mobVertexCountForKind(kind: MobKind): number {
  return BOXES_PER_KIND[kind] * VERTICES_PER_BOX;
}

function shortestAngle(from: number, to: number): number {
  let difference = (to - from) % (Math.PI * 2);
  if (difference > Math.PI) difference -= Math.PI * 2;
  if (difference < -Math.PI) difference += Math.PI * 2;
  return difference;
}

interface VertexWriter {
  data: Float32Array;
  offset: number;
}

function appendBox(
  writer: VertexWriter,
  originX: number,
  originY: number,
  originZ: number,
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
  red: number,
  green: number,
  blue: number,
): void {
  const cosYaw = Math.cos(yaw);
  const sinYaw = Math.sin(yaw);
  const cosPitch = Math.cos(pitch);
  const sinPitch = Math.sin(pitch);
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
      writer.data[writer.offset++] = originX + localX * cosYaw - localZ * sinYaw;
      writer.data[writer.offset++] = originY + localY;
      writer.data[writer.offset++] = originZ + localX * sinYaw + localZ * cosYaw;
      writer.data[writer.offset++] = red * face.shade;
      writer.data[writer.offset++] = green * face.shade;
      writer.data[writer.offset++] = blue * face.shade;
    }
  }
}

function mixWhite(value: number, amount: number): number {
  return value + (1 - value) * amount;
}

function appendPrimedTnt(
  writer: VertexWriter,
  x: number,
  y: number,
  z: number,
  scale: number,
  flash: number,
): void {
  const half = scale * 0.5;
  const low = -half + scale * 0.34;
  const high = -half + scale * 0.64;
  const centerX = x + 0.5;
  const centerY = y + 0.5;
  const centerZ = z + 0.5;
  const red = mixWhite(0.69, flash);
  const green = mixWhite(0.12, flash);
  const blue = mixWhite(0.085, flash);
  const bandRed = mixWhite(0.88, flash);
  const bandGreen = mixWhite(0.79, flash);
  const bandBlue = mixWhite(0.61, flash);
  appendBox(writer, centerX, centerY, centerZ, 0, 0, 0, 0, -half, -half, -half, half, low, half, red, green, blue);
  appendBox(writer, centerX, centerY, centerZ, 0, 0, 0, 0, -half, low, -half, half, high, half, bandRed, bandGreen, bandBlue);
  appendBox(writer, centerX, centerY, centerZ, 0, 0, 0, 0, -half, high, -half, half, half, half, red, green, blue);
  const cap = scale * 0.075;
  const dark = mixWhite(0.08, flash * 0.65);
  appendBox(
    writer, centerX, centerY, centerZ, 0, 0, 0, 0,
    -cap, half + 0.002, -cap, cap, half + cap, cap, dark, dark, dark,
  );
}

function appendQuadrupedLegs(
  writer: VertexWriter,
  x: number,
  y: number,
  z: number,
  yaw: number,
  swing: number,
  halfWidth: number,
  frontZ: number,
  backZ: number,
  legTop: number,
  width: number,
  red: number,
  green: number,
  blue: number,
): void {
  appendBox(writer,x,y,z,yaw,swing,legTop,frontZ,-halfWidth-width,0,frontZ-width,-halfWidth,legTop,frontZ+width,red,green,blue);
  appendBox(writer,x,y,z,yaw,-swing,legTop,frontZ,halfWidth,0,frontZ-width,halfWidth+width,legTop,frontZ+width,red,green,blue);
  appendBox(writer,x,y,z,yaw,-swing,legTop,backZ,-halfWidth-width,0,backZ-width,-halfWidth,legTop,backZ+width,red,green,blue);
  appendBox(writer,x,y,z,yaw,swing,legTop,backZ,halfWidth,0,backZ-width,halfWidth+width,legTop,backZ+width,red,green,blue);
}

function appendPig(writer: VertexWriter, x: number, y: number, z: number, yaw: number, swing: number): void {
  appendQuadrupedLegs(writer,x,y,z,yaw,swing,0.18,0.42,-0.38,0.43,0.13,0.72,0.38,0.43);
  appendBox(writer,x,y,z,yaw,0,0,0,-0.38,0.35,-0.55,0.38,0.82,0.55,0.92,0.53,0.58);
  appendBox(writer,x,y,z,yaw,0,0,0,-0.28,0.43,0.48,0.28,0.86,0.91,0.98,0.62,0.66);
  appendBox(writer,x,y,z,yaw,0,0,0,-0.19,0.48,0.88,0.19,0.67,1.02,0.86,0.42,0.49);
  appendBox(writer,x,y,z,yaw,0,0,0,-0.25,0.83,0.55,-0.08,0.96,0.7,0.84,0.38,0.45);
  appendBox(writer,x,y,z,yaw,0,0,0,0.08,0.83,0.55,0.25,0.96,0.7,0.84,0.38,0.45);
}

function appendCow(writer: VertexWriter, x: number, y: number, z: number, yaw: number, swing: number): void {
  appendQuadrupedLegs(writer,x,y,z,yaw,swing,0.24,0.46,-0.43,0.63,0.14,0.24,0.16,0.08);
  appendBox(writer,x,y,z,yaw,0,0,0,-0.46,0.55,-0.66,0.46,1.12,0.62,0.34,0.22,0.12);
  appendBox(writer,x,y,z,yaw,0,0,0,-0.3,0.65,0.54,0.3,1.17,1.08,0.29,0.18,0.1);
  appendBox(writer,x,y,z,yaw,0,0,0,-0.24,0.66,1.02,0.24,0.89,1.2,0.72,0.58,0.42);
  appendBox(writer,x,y,z,yaw,0,0,0,-0.42,1.1,0.66,-0.25,1.32,0.82,0.78,0.7,0.5);
  appendBox(writer,x,y,z,yaw,0,0,0,0.25,1.1,0.66,0.42,1.32,0.82,0.78,0.7,0.5);
}

function appendSheep(writer: VertexWriter, x: number, y: number, z: number, yaw: number, swing: number): void {
  appendQuadrupedLegs(writer,x,y,z,yaw,swing,0.2,0.42,-0.4,0.58,0.12,0.19,0.16,0.13);
  appendBox(writer,x,y,z,yaw,0,0,0,-0.47,0.48,-0.66,0.47,1.17,0.61,0.86,0.84,0.72);
  appendBox(writer,x,y,z,yaw,0,0,0,-0.27,0.6,0.54,0.27,1.09,1.05,0.26,0.24,0.21);
  appendBox(writer,x,y,z,yaw,0,0,0,-0.21,0.64,1,0.21,0.84,1.14,0.2,0.18,0.16);
}

function appendChicken(writer: VertexWriter, x: number, y: number, z: number, yaw: number, swing: number): void {
  // The white body/head, tiny beak and dangling red wattle follow the classic
  // chicken silhouette. Narrow yellow legs and side wings animate without
  // leaving the shared mob batch or allocating any per-frame objects.
  appendBox(writer,x,y,z,yaw,0,0,0,-0.34,0.3,-0.45,0.34,0.83,0.08,0.88,0.88,0.82);
  appendBox(writer,x,y,z,yaw,0,0,0,-0.27,0.61,-0.02,0.27,1.08,0.45,0.94,0.94,0.88);
  appendBox(writer,x,y,z,yaw,0,0,0,-0.2,0.75,0.451,0.2,0.91,0.66,0.91,0.61,0.08);
  appendBox(writer,x,y,z,yaw,0,0,0,-0.09,0.59,0.452,0.09,0.75,0.58,0.75,0.09,0.055);
  appendBox(writer,x,y,z,yaw,swing,0.34,-0.04,-0.23,0,-0.12,-0.11,0.38,0.1,0.86,0.57,0.09);
  appendBox(writer,x,y,z,yaw,-swing,0.34,-0.04,0.11,0,-0.12,0.23,0.38,0.1,0.86,0.57,0.09);
  appendBox(writer,x,y,z,yaw,-swing*0.42,0.68,-0.08,-0.45,0.4,-0.34,-0.34,0.76,0.03,0.79,0.79,0.73);
  appendBox(writer,x,y,z,yaw,swing*0.42,0.68,-0.08,0.34,0.4,-0.34,0.45,0.76,0.03,0.79,0.79,0.73);
  appendBox(writer,x,y,z,yaw,0,0,0,-0.24,0.54,-0.64,0.24,0.85,-0.42,0.94,0.94,0.88);
}

function appendZombie(writer: VertexWriter, x: number, y: number, z: number, yaw: number, swing: number): void {
  appendBox(writer,x,y,z,yaw,swing,0.68,0,-0.24,0,-0.15,-0.02,0.72,0.15,0.18,0.22,0.43);
  appendBox(writer,x,y,z,yaw,-swing,0.68,0,0.02,0,-0.15,0.24,0.72,0.15,0.18,0.22,0.43);
  appendBox(writer,x,y,z,yaw,0,0,0,-0.34,0.68,-0.18,0.34,1.38,0.18,0.05,0.43,0.43);
  appendBox(writer,x,y,z,yaw,-swing*0.8,1.32,0,-0.55,0.77,-0.13,-0.34,1.36,0.13,0.3,0.58,0.27);
  appendBox(writer,x,y,z,yaw,swing*0.8,1.32,0,0.34,0.77,-0.13,0.55,1.36,0.13,0.3,0.58,0.27);
  appendBox(writer,x,y,z,yaw,0,0,0,-0.27,1.38,-0.27,0.27,1.9,0.27,0.32,0.58,0.28);
}

function appendSkeleton(writer: VertexWriter, x: number, y: number, z: number, yaw: number, swing: number): void {
  const boneR = 0.78;
  const boneG = 0.8;
  const boneB = 0.73;
  // Two narrow legs, pelvis, spine, crossed ribs, bow arms, and a square skull.
  appendBox(writer,x,y,z,yaw,swing,0.7,0,-0.19,0,-0.11,-0.04,0.72,0.11,boneR,boneG,boneB);
  appendBox(writer,x,y,z,yaw,-swing,0.7,0,0.04,0,-0.11,0.19,0.72,0.11,boneR,boneG,boneB);
  appendBox(writer,x,y,z,yaw,0,0,0,-0.27,0.68,-0.13,0.27,0.8,0.13,0.62,0.64,0.58);
  appendBox(writer,x,y,z,yaw,0,0,0,-0.07,0.76,-0.08,0.07,1.4,0.08,boneR,boneG,boneB);
  appendBox(writer,x,y,z,yaw,0,0,0,-0.34,0.91,-0.09,0.34,1.03,0.09,boneR,boneG,boneB);
  appendBox(writer,x,y,z,yaw,0,0,0,-0.3,1.15,-0.08,0.3,1.27,0.08,boneR,boneG,boneB);
  appendBox(writer,x,y,z,yaw,-0.48,1.34,0,-0.52,0.82,-0.1,-0.3,1.37,0.1,boneR,boneG,boneB);
  appendBox(writer,x,y,z,yaw,0.48,1.34,0,0.3,0.82,-0.1,0.52,1.37,0.1,boneR,boneG,boneB);
  appendBox(writer,x,y,z,yaw,0,0,0,-0.28,1.38,-0.28,0.28,1.94,0.28,0.84,0.86,0.79);
}

function appendCreeper(
  writer: VertexWriter,
  x: number,
  y: number,
  z: number,
  yaw: number,
  swing: number,
  fuseProgress: number,
): void {
  const progress = Math.max(0, Math.min(1, fuseProgress));
  const pulse = progress >= 1 ? 0.82 : ((Math.floor(progress * 14) & 1) === 1 ? progress * 0.72 : 0);
  const greenR = 0.2 + pulse * 0.8;
  const greenG = 0.62 + pulse * 0.38;
  const greenB = 0.18 + pulse * 0.82;
  const darkR = 0.11 + pulse * 0.76;
  const darkG = 0.4 + pulse * 0.5;
  const darkB = 0.1 + pulse * 0.76;
  // Four offset feet, a narrow upright body, and the oversized square head
  // produce the unmistakable creeper silhouette without a per-mob draw call.
  appendBox(writer,x,y,z,yaw,swing,0.38,0,-0.34,0,-0.34,-0.04,0.42,-0.04,darkR,darkG,darkB);
  appendBox(writer,x,y,z,yaw,-swing,0.38,0,0.04,0,-0.34,0.34,0.42,-0.04,darkR,darkG,darkB);
  appendBox(writer,x,y,z,yaw,-swing,0.38,0,-0.34,0,0.04,-0.04,0.42,0.34,darkR,darkG,darkB);
  appendBox(writer,x,y,z,yaw,swing,0.38,0,0.04,0,0.04,0.34,0.42,0.34,darkR,darkG,darkB);
  appendBox(writer,x,y,z,yaw,0,0,0,-0.27,0.34,-0.23,0.27,1.19,0.23,greenR,greenG,greenB);
  appendBox(writer,x,y,z,yaw,0,0,0,-0.4,1.08,-0.4,0.4,1.79,0.4,greenR,greenG,greenB);
  appendBox(writer,x,y,z,yaw,0,0,0,-0.28,1.5,0.401,-0.1,1.66,0.425,0.025,0.045,0.02);
  appendBox(writer,x,y,z,yaw,0,0,0,0.1,1.5,0.401,0.28,1.66,0.425,0.025,0.045,0.02);
  appendBox(writer,x,y,z,yaw,0,0,0,-0.12,1.2,0.401,0.12,1.48,0.425,0.025,0.045,0.02);
}

function appendSpiderLeg(
  writer: VertexWriter,
  x: number,
  y: number,
  z: number,
  yaw: number,
  side: -1 | 1,
  row: number,
  swing: number,
): void {
  const rowZ = -0.43 + row * 0.27;
  const splayZ = -0.34 + row * 0.225;
  const phase = ((row + (side > 0 ? 1 : 0)) & 1) === 0 ? 1 : -1;
  const attachX = side * 0.39;
  const endX = side * 1.08;
  const endZ = rowZ + splayZ + swing * 0.28 * phase;
  const centerX = (attachX + endX) * 0.5;
  const centerZ = (rowZ + endZ) * 0.5;
  const liftedY = 0.34 + Math.max(0, swing * phase) * 0.12;
  const deltaX = endX - attachX;
  const deltaZ = endZ - rowZ;
  const length = Math.hypot(deltaX, deltaZ);
  const localYaw = Math.atan2(deltaZ, deltaX);
  const cosYaw = Math.cos(yaw);
  const sinYaw = Math.sin(yaw);
  const worldX = x + centerX * cosYaw - centerZ * sinYaw;
  const worldZ = z + centerX * sinYaw + centerZ * cosYaw;
  appendBox(
    writer,
    worldX,
    y + liftedY,
    worldZ,
    yaw + localYaw,
    0,
    0,
    0,
    -length * 0.5,
    -0.055,
    -0.055,
    length * 0.5,
    0.055,
    0.055,
    0.105,
    0.075,
    0.055,
  );
}

function appendSpider(writer: VertexWriter, x: number, y: number, z: number, yaw: number, swing: number): void {
  // A broad abdomen and forward head keep the body recognizably low while the
  // eight individually phased legs produce the iconic two-block-wide outline.
  appendBox(writer,x,y,z,yaw,0,0,0,-0.48,0.3,-0.68,0.48,0.72,0.2,0.13,0.09,0.065);
  appendBox(writer,x,y,z,yaw,0,0,0,-0.35,0.31,0.1,0.35,0.7,0.64,0.095,0.07,0.055);
  appendBox(writer,x,y,z,yaw,0,0,0,-0.25,0.43,0.641,-0.07,0.58,0.67,0.88,0.025,0.018);
  appendBox(writer,x,y,z,yaw,0,0,0,0.07,0.43,0.641,0.25,0.58,0.67,0.88,0.025,0.018);
  for (let row = 0; row < 4; row += 1) {
    appendSpiderLeg(writer, x, y, z, yaw, -1, row, swing);
    appendSpiderLeg(writer, x, y, z, yaw, 1, row, swing);
  }
}

function appendArrow(writer: VertexWriter, projectile: Readonly<MobProjectileSnapshot>, interpolation: number): void {
  const x = projectile.previousX + (projectile.x - projectile.previousX) * interpolation;
  const y = projectile.previousY + (projectile.y - projectile.previousY) * interpolation;
  const z = projectile.previousZ + (projectile.z - projectile.previousZ) * interpolation;
  appendBox(
    writer,
    x,
    y,
    z,
    projectile.yaw,
    -projectile.pitch,
    0,
    0,
    -0.035,
    -0.035,
    -0.34,
    0.035,
    0.035,
    0.34,
    0.54,
    0.37,
    0.19,
  );
}

export function createMobRenderer(gl: WebGLRenderingContext): MobRenderer {
  const buffer = gl.createBuffer();
  if (!buffer) throw new Error("Unable to allocate the mob batch buffer.");
  const vertices = new Float32Array(
    (HARD_MAX_MOB_POPULATION * MAX_BOXES_PER_MOB + MAX_MOB_PROJECTILES
      + MAX_PRIMED_TNT_VISUALS * 4)
      * VERTICES_PER_BOX
      * FLOATS_PER_VERTEX,
  );
  const primedPositions = new Int32Array(MAX_PRIMED_TNT_VISUALS * 3);
  const primedTimes = new Float64Array(MAX_PRIMED_TNT_VISUALS * 2);
  const primedSample: PrimedTntVisualSample = { progress: 0, scale: 0.98, flashMix: 0 };
  let primedCount = 0;
  let primedClockOffset = 0;
  const writer: VertexWriter = { data: vertices, offset: 0 };
  const stats: MobRenderStats = {
    totalMobCount: 0,
    visibleMobCount: 0,
    vertexCount: 0,
    projectileCount: 0,
    projectileVertexCount: 0,
    visiblePrimedTntCount: 0,
    primedTntVertexCount: 0,
  };
  let uploadFloatCount = -1;
  let uploadView = vertices;
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertices.byteLength, gl.DYNAMIC_DRAW);

  function removePrimed(index: number): void {
    const last = --primedCount;
    if (index === last) return;
    primedPositions[index * 3] = primedPositions[last * 3];
    primedPositions[index * 3 + 1] = primedPositions[last * 3 + 1];
    primedPositions[index * 3 + 2] = primedPositions[last * 3 + 2];
    primedTimes[index * 2] = primedTimes[last * 2];
    primedTimes[index * 2 + 1] = primedTimes[last * 2 + 1];
  }

  return {
    buffer,
    maximumPrimedTnt: MAX_PRIMED_TNT_VISUALS,
    setPrimedTntFuses(fuses, authoritativeNow = Date.now()) {
      primedClockOffset = Number.isFinite(authoritativeNow) ? authoritativeNow - Date.now() : 0;
      primedCount = 0;
      for (let index = 0; index < fuses.length && primedCount < MAX_PRIMED_TNT_VISUALS; index += 1) {
        const fuse = fuses[index];
        if (![fuse.x, fuse.y, fuse.z].every(Number.isSafeInteger)
          || !Number.isFinite(fuse.ignitedAt) || !Number.isFinite(fuse.dueAt)
          || fuse.dueAt <= fuse.ignitedAt) continue;
        primedPositions[primedCount * 3] = fuse.x;
        primedPositions[primedCount * 3 + 1] = fuse.y;
        primedPositions[primedCount * 3 + 2] = fuse.z;
        primedTimes[primedCount * 2] = fuse.ignitedAt;
        primedTimes[primedCount * 2 + 1] = fuse.dueAt;
        primedCount += 1;
      }
      return primedCount;
    },
    setLocalPrimedTnt(x, y, z, primed, now = Date.now()) {
      if (![x, y, z].every(Number.isSafeInteger)) return false;
      for (let index = 0; index < primedCount; index += 1) {
        const offset = index * 3;
        if (primedPositions[offset] !== x || primedPositions[offset + 1] !== y || primedPositions[offset + 2] !== z) continue;
        if (!primed) removePrimed(index);
        return true;
      }
      if (!primed) return true;
      if (primedCount >= MAX_PRIMED_TNT_VISUALS) return false;
      primedClockOffset = 0;
      primedPositions[primedCount * 3] = x;
      primedPositions[primedCount * 3 + 1] = y;
      primedPositions[primedCount * 3 + 2] = z;
      primedTimes[primedCount * 2] = now;
      primedTimes[primedCount * 2 + 1] = now + TNT_FUSE_MS;
      primedCount += 1;
      return true;
    },
    rebuild(poses, cameraX, cameraZ, facingX, facingZ, interpolation, animationSeconds, projectiles = []) {
      writer.offset = 0;
      stats.totalMobCount = poses.length;
      stats.visibleMobCount = 0;
      const alpha = Math.max(0, Math.min(1, interpolation));
      for (let index = 0; index < poses.length; index += 1) {
        const pose = poses[index];
        const x = pose.previousX + (pose.x - pose.previousX) * alpha;
        const y = pose.previousY + (pose.y - pose.previousY) * alpha;
        const z = pose.previousZ + (pose.z - pose.previousZ) * alpha;
        const dx = x - cameraX;
        const dz = z - cameraZ;
        const distanceSquared = dx * dx + dz * dz;
        if (distanceSquared > RENDER_DISTANCE_SQUARED) continue;
        if (distanceSquared > 10 * 10 && dx * facingX + dz * facingZ < -2) continue;
        const yaw = pose.previousYaw + shortestAngle(pose.previousYaw, pose.yaw) * alpha;
        const moving = pose.behavior === "wander" || pose.behavior === "chase";
        const swing = moving ? Math.sin(animationSeconds * (pose.behavior === "chase" ? 9 : 6) + index * 1.71) * 0.46 : 0;
        if (pose.kind === "pig") appendPig(writer, x, y, z, yaw, swing);
        else if (pose.kind === "cow") appendCow(writer, x, y, z, yaw, swing);
        else if (pose.kind === "sheep") appendSheep(writer, x, y, z, yaw, swing);
        else if (pose.kind === "chicken") appendChicken(writer, x, y, z, yaw, swing);
        else if (pose.kind === "zombie") appendZombie(writer, x, y, z, yaw, swing);
        else if (pose.kind === "skeleton") appendSkeleton(writer, x, y, z, yaw, swing);
        else if (pose.kind === "creeper") appendCreeper(writer, x, y, z, yaw, swing, pose.fuseProgress);
        else appendSpider(writer, x, y, z, yaw, swing);
        stats.visibleMobCount += 1;
      }
      const mobFloatCount = writer.offset;
      stats.projectileCount = Math.min(projectiles.length, MAX_MOB_PROJECTILES);
      for (let index = 0; index < stats.projectileCount; index += 1) {
        const projectile = projectiles[index];
        const dx = projectile.x - cameraX;
        const dz = projectile.z - cameraZ;
        if (dx * dx + dz * dz > RENDER_DISTANCE_SQUARED) continue;
        appendArrow(writer, projectile, alpha);
      }
      stats.projectileVertexCount = (writer.offset - mobFloatCount) / FLOATS_PER_VERTEX;
      const primedFloatStart = writer.offset;
      stats.visiblePrimedTntCount = 0;
      const primedNow = Date.now() + primedClockOffset;
      for (let index = 0; index < primedCount; index += 1) {
        const positionOffset = index * 3;
        const x = primedPositions[positionOffset];
        const y = primedPositions[positionOffset + 1];
        const z = primedPositions[positionOffset + 2];
        const dx = x + 0.5 - cameraX;
        const dz = z + 0.5 - cameraZ;
        if (dx * dx + dz * dz > PRIMED_TNT_RENDER_DISTANCE_SQUARED) continue;
        const timeOffset = index * 2;
        samplePrimedTntVisual(primedTimes[timeOffset], primedTimes[timeOffset + 1], primedNow, primedSample);
        appendPrimedTnt(writer, x, y, z, primedSample.scale, primedSample.flashMix);
        stats.visiblePrimedTntCount += 1;
      }
      stats.primedTntVertexCount = (writer.offset - primedFloatStart) / FLOATS_PER_VERTEX;
      stats.vertexCount = writer.offset / FLOATS_PER_VERTEX;
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      if (uploadFloatCount !== writer.offset) {
        uploadFloatCount = writer.offset;
        uploadView = vertices.subarray(0, writer.offset);
      }
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, uploadView);
      return stats;
    },
    destroy() {
      gl.deleteBuffer(buffer);
    },
  };
}
