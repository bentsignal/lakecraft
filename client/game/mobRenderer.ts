import {
  HARD_MAX_MOB_POPULATION,
  MAX_MOB_PROJECTILES,
  type MobKind,
  type MobPoseSnapshot,
  type MobProjectileSnapshot,
} from "./mobs.ts";
import { TNT_FUSE_MS, TNT_MAX_ACTIVE_FUSES } from "../../shared/tntAuthority.ts";
import { decodeStaticBytes } from "../staticData.ts";
import type { PrimedTntVisualFuse } from "./types.ts";
import { BOX_FACE_SHADES, BOX_VERTEX_COORDINATES } from "./generated/renderGeometry.ts";

type Vec3 = readonly [number, number, number];

const VERTICES_PER_KIND: Readonly<Record<MobKind, number>> = Object.freeze({
  pig: 348,
  cow: 354,
  sheep: 282,
  chicken: 348,
  zombie: 252,
  skeleton: 342,
  creeper: 252,
  spider: 432,
});

// Quantized [minX,minY,maxX,maxY,z,r,g,b] quads add pixel-scale face and
// surface marks without paying a complete 36-vertex box per mark.
const MOB_GEOMETRY_BYTES = decodeStaticBytes("0bLhJp&jnf1pf?OLPQlMh&W.rw*kdJG?s,l2MOQGC5g#_0#e=!vWnbxAy_HMFoRFc1!2-hap4#HoM(}f3(M{ny?)](x+*zr2+hVFap90SDq5(f1@Cc=mVFO#0cHL^l,>zj0#0dwCv+uf1oF(!tA&lowh56)FcXRlk+EE?ap69aScCS?04rV40&B?kBcR+P8WDAD17CI:As$xO9V@5hO]$xo03JK_Wvs[H2MLRCyO,D/90/U]2z.jxap8_L0frS>arRXnMh[99c(6ROIK3P0ap97lJfB)^xAgRLu[6a)2:>shM@:+hneCXmDuk2{3{zV&03^7jqN.]&iSJXvU=*^GvM(!Uz7#Ral?%zHdLUNmW#hr2Fk/(EH?p/Jape3Ch=jx+-9jr]3_qJhO}#xu01}SLlGTUr@.9>CdPQD7xm@okpdv1bzO>yOaphQwWWRc,8upP<yE3#CrpQ265*Fv(q)/g(H?/^SwJ^Hi0bO!zurz2pTPjO>:DPeeCrk?bIa^AM2]L5!hB9TfrSB7Bl>:b0IJOb{d%F-rwT&A6auyFxwKHQep[NU706ky0C::llp5{9-ur:SFxnF{O31v_2O@%p=wb%G_OwH/%r:>.[9-3U_LNN@02veBeQEJ3a00+-ve5lA):&)<)0?5qwNih*o", 516, 523);

const FLOATS_PER_VERTEX = 6;
const VERTICES_PER_BOX = 36;
const MAX_BOXES_PER_MOB = 12;
const RENDER_DISTANCE_SQUARED = 30 * 30;
const PRIMED_TNT_RENDER_DISTANCE_SQUARED = 48 * 48;
const MOB_HURT_FLASH_SECONDS = 0.5;
const MOB_HURT_FLASH_MIX = 0.62;

export const MAX_PRIMED_TNT_VISUALS = TNT_MAX_ACTIVE_FUSES;
const PRIMED_TNT_LABEL_TRIANGLES_PER_SIDE = 7;
const PRIMED_TNT_SIDE_COUNT = 4;
export const PRIMED_TNT_LABEL_VERTICES = PRIMED_TNT_SIDE_COUNT * PRIMED_TNT_LABEL_TRIANGLES_PER_SIDE * 3;
export const PRIMED_TNT_VERTICES_PER_ENTITY = VERTICES_PER_BOX + 4 * 6 + PRIMED_TNT_LABEL_VERTICES + 5 * 6;
export const MOB_MESH_INTERVAL_MS = 1_000 / 30;

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
    frameNowMs?: number,
  ): MobRenderStats;
  destroy(): void;
}

export function mobVertexCountForKind(kind: MobKind): number {
  return VERTICES_PER_KIND[kind];
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
  hurtMix: number;
  deathCos: number;
  deathSin: number;
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
  for (let faceIndex = 0, point = 0; faceIndex < BOX_FACE_SHADES.length; faceIndex += 1) {
    const shade = BOX_FACE_SHADES[faceIndex];
    for (let vertexIndex = 0; vertexIndex < 6; vertexIndex += 1) {
      const localX = minX + BOX_VERTEX_COORDINATES[point++] * (maxX - minX);
      const unrotatedY = minY + BOX_VERTEX_COORDINATES[point++] * (maxY - minY);
      const unrotatedZ = minZ + BOX_VERTEX_COORDINATES[point++] * (maxZ - minZ);
      const offsetY = unrotatedY - pivotY;
      const offsetZ = unrotatedZ - pivotZ;
      const pitchedY = pivotY + offsetY * cosPitch - offsetZ * sinPitch;
      const pitchedZ = pivotZ + offsetY * sinPitch + offsetZ * cosPitch;
      const deathY = 0.72 + (pitchedY - 0.72) * writer.deathCos - pitchedZ * writer.deathSin;
      const deathZ = (pitchedY - 0.72) * writer.deathSin + pitchedZ * writer.deathCos;
      writer.data[writer.offset++] = originX + localX * cosYaw - deathZ * sinYaw;
      writer.data[writer.offset++] = originY + deathY;
      writer.data[writer.offset++] = originZ + localX * sinYaw + deathZ * cosYaw;
      const baseRed = red * shade;
      const baseGreen = green * shade;
      const baseBlue = blue * shade;
      const hurtMix = writer.hurtMix;
      writer.data[writer.offset++] = baseRed + (shade - baseRed) * hurtMix;
      writer.data[writer.offset++] = baseGreen + (shade * 0.06 - baseGreen) * hurtMix;
      writer.data[writer.offset++] = baseBlue + (shade * 0.06 - baseBlue) * hurtMix;
    }
  }
}

function appendMobPatches(
  writer: VertexWriter,
  originX: number,
  originY: number,
  originZ: number,
  yaw: number,
  start: number,
  end: number,
): void {
  const cosYaw = Math.cos(yaw);
  const sinYaw = Math.sin(yaw);
  const unit = 0.01;
  for (let patch = start; patch < end; patch += 8) {
    const minX = (MOB_GEOMETRY_BYTES[patch] - 128) * unit;
    const minY = MOB_GEOMETRY_BYTES[patch + 1] * unit;
    const width = (MOB_GEOMETRY_BYTES[patch + 2] - MOB_GEOMETRY_BYTES[patch]) * unit;
    const height = (MOB_GEOMETRY_BYTES[patch + 3] - MOB_GEOMETRY_BYTES[patch + 1]) * unit;
    const localZ = MOB_GEOMETRY_BYTES[patch + 4] * unit + 0.002;
    const red = MOB_GEOMETRY_BYTES[patch + 5] * unit;
    const green = MOB_GEOMETRY_BYTES[patch + 6] * unit;
    const blue = MOB_GEOMETRY_BYTES[patch + 7] * unit;
    for (let point = 0; point < 6; point += 1) {
      const corner = point === 1 || point === 2 || point === 4 ? 1 : 0;
      const top = point >= 2 && point <= 4 ? 1 : 0;
      const localX = minX + corner * width;
      const localY = minY + top * height;
      const deathY = 0.72 + (localY - 0.72) * writer.deathCos - localZ * writer.deathSin;
      const deathZ = (localY - 0.72) * writer.deathSin + localZ * writer.deathCos;
      writer.data[writer.offset++] = originX + localX * cosYaw - deathZ * sinYaw;
      writer.data[writer.offset++] = originY + deathY;
      writer.data[writer.offset++] = originZ + localX * sinYaw + deathZ * cosYaw;
      const hurtMix = writer.hurtMix;
      writer.data[writer.offset++] = red + (1 - red) * hurtMix;
      writer.data[writer.offset++] = green + (0.06 - green) * hurtMix;
      writer.data[writer.offset++] = blue + (0.06 - blue) * hurtMix;
    }
  }
}

function appendStaticBoxes(
  writer: VertexWriter,
  x: number,
  y: number,
  z: number,
  yaw: number,
  start: number,
  end: number,
): void {
  const unit = 0.01;
  for (let box = start; box < end; box += 9) {
    appendBox(
      writer,x,y,z,yaw,0,0,0,
      (MOB_GEOMETRY_BYTES[box] - 128) * unit,
      MOB_GEOMETRY_BYTES[box + 1] * unit,
      (MOB_GEOMETRY_BYTES[box + 2] - 128) * unit,
      (MOB_GEOMETRY_BYTES[box + 3] - 128) * unit,
      MOB_GEOMETRY_BYTES[box + 4] * unit,
      (MOB_GEOMETRY_BYTES[box + 5] - 128) * unit,
      MOB_GEOMETRY_BYTES[box + 6] * unit,
      MOB_GEOMETRY_BYTES[box + 7] * unit,
      MOB_GEOMETRY_BYTES[box + 8] * unit,
    );
  }
}

function mixWhite(value: number, amount: number): number {
  return value + (1 - value) * amount;
}

function appendColoredTriangle(
  writer: VertexWriter,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
  red: number, green: number, blue: number,
): void {
  writer.data[writer.offset++] = ax; writer.data[writer.offset++] = ay; writer.data[writer.offset++] = az;
  writer.data[writer.offset++] = red; writer.data[writer.offset++] = green; writer.data[writer.offset++] = blue;
  writer.data[writer.offset++] = bx; writer.data[writer.offset++] = by; writer.data[writer.offset++] = bz;
  writer.data[writer.offset++] = red; writer.data[writer.offset++] = green; writer.data[writer.offset++] = blue;
  writer.data[writer.offset++] = cx; writer.data[writer.offset++] = cy; writer.data[writer.offset++] = cz;
  writer.data[writer.offset++] = red; writer.data[writer.offset++] = green; writer.data[writer.offset++] = blue;
}

function appendColoredQuad(
  writer: VertexWriter,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
  dx: number, dy: number, dz: number,
  red: number, green: number, blue: number,
): void {
  appendColoredTriangle(writer, ax, ay, az, bx, by, bz, cx, cy, cz, red, green, blue);
  appendColoredTriangle(writer, ax, ay, az, cx, cy, cz, dx, dy, dz, red, green, blue);
}

function appendPrimedTntSideQuad(
  writer: VertexWriter,
  side: number,
  centerX: number,
  minY: number,
  centerZ: number,
  half: number,
  maxY: number,
  offset: number,
  red: number,
  green: number,
  blue: number,
): void {
  if (side === 0) appendColoredQuad(writer,
    centerX + half + offset, minY, centerZ + half,
    centerX + half + offset, minY, centerZ - half,
    centerX + half + offset, maxY, centerZ - half,
    centerX + half + offset, maxY, centerZ + half, red, green, blue);
  else if (side === 1) appendColoredQuad(writer,
    centerX - half - offset, minY, centerZ - half,
    centerX - half - offset, minY, centerZ + half,
    centerX - half - offset, maxY, centerZ + half,
    centerX - half - offset, maxY, centerZ - half, red, green, blue);
  else if (side === 2) appendColoredQuad(writer,
    centerX - half, minY, centerZ + half + offset,
    centerX + half, minY, centerZ + half + offset,
    centerX + half, maxY, centerZ + half + offset,
    centerX - half, maxY, centerZ + half + offset, red, green, blue);
  else appendColoredQuad(writer,
    centerX + half, minY, centerZ - half - offset,
    centerX - half, minY, centerZ - half - offset,
    centerX - half, maxY, centerZ - half - offset,
    centerX + half, maxY, centerZ - half - offset, red, green, blue);
}

function appendPrimedTntGlyphTriangle(
  writer: VertexWriter,
  side: number,
  centerX: number,
  centerY: number,
  centerZ: number,
  half: number,
  scale: number,
  au: number, av: number,
  bu: number, bv: number,
  cu: number, cv: number,
  red: number, green: number, blue: number,
): void {
  const plane = half + 0.002;
  const ax = centerX + (side === 0 ? plane : side === 1 ? -plane : side === 2 ? au * scale : -au * scale);
  const ay = centerY + av * scale;
  const az = centerZ + (side === 0 ? -au * scale : side === 1 ? au * scale : side === 2 ? plane : -plane);
  const bx = centerX + (side === 0 ? plane : side === 1 ? -plane : side === 2 ? bu * scale : -bu * scale);
  const by = centerY + bv * scale;
  const bz = centerZ + (side === 0 ? -bu * scale : side === 1 ? bu * scale : side === 2 ? plane : -plane);
  const cx = centerX + (side === 0 ? plane : side === 1 ? -plane : side === 2 ? cu * scale : -cu * scale);
  const cy = centerY + cv * scale;
  const cz = centerZ + (side === 0 ? -cu * scale : side === 1 ? cu * scale : side === 2 ? plane : -plane);
  // Glyph coordinates prioritize a readable silhouette. Normalize their
  // winding once here so every side remains visible under back-face culling.
  const winding = (bu - au) * (cv - av) - (bv - av) * (cu - au);
  if (winding > 0) appendColoredTriangle(writer, ax, ay, az, bx, by, bz, cx, cy, cz, red, green, blue);
  else appendColoredTriangle(writer, ax, ay, az, cx, cy, cz, bx, by, bz, red, green, blue);
}

function appendPrimedTntSideLabel(
  writer: VertexWriter,
  side: number,
  centerX: number,
  centerY: number,
  centerZ: number,
  half: number,
  scale: number,
  red: number,
  green: number,
  blue: number,
): void {
  // Seven fixed triangles form a compact T·N·T silhouette. Keeping every side
  // in one axis-aligned basis makes swelling a pure scale, never a rotation.
  appendPrimedTntGlyphTriangle(writer, side, centerX, centerY, centerZ, half, scale,
    -0.36, 0.12, -0.12, 0.12, -0.24, 0.035, red, green, blue);
  appendPrimedTntGlyphTriangle(writer, side, centerX, centerY, centerZ, half, scale,
    -0.285, 0.06, -0.195, 0.06, -0.24, -0.13, red, green, blue);
  appendPrimedTntGlyphTriangle(writer, side, centerX, centerY, centerZ, half, scale,
    -0.1, -0.13, -0.1, 0.12, -0.055, -0.13, red, green, blue);
  appendPrimedTntGlyphTriangle(writer, side, centerX, centerY, centerZ, half, scale,
    -0.1, -0.13, -0.055, -0.13, 0.1, 0.12, red, green, blue);
  appendPrimedTntGlyphTriangle(writer, side, centerX, centerY, centerZ, half, scale,
    0.055, 0.12, 0.1, -0.13, 0.1, 0.12, red, green, blue);
  appendPrimedTntGlyphTriangle(writer, side, centerX, centerY, centerZ, half, scale,
    0.12, 0.12, 0.36, 0.12, 0.24, 0.035, red, green, blue);
  appendPrimedTntGlyphTriangle(writer, side, centerX, centerY, centerZ, half, scale,
    0.195, 0.06, 0.285, 0.06, 0.24, -0.13, red, green, blue);
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
  appendBox(writer, centerX, centerY, centerZ, 0, 0, 0, 0, -half, -half, -half, half, half, half, red, green, blue);
  const ink = mixWhite(0.08, flash * 0.75);
  for (let side = 0; side < PRIMED_TNT_SIDE_COUNT; side += 1) {
    appendPrimedTntSideQuad(writer, side, centerX, centerY + low, centerZ, half, centerY + high, 0.001,
      bandRed, bandGreen, bandBlue);
    appendPrimedTntSideLabel(writer, side, centerX, centerY, centerZ, half, scale, ink, ink, ink);
  }
  const cap = scale * 0.075;
  const dark = mixWhite(0.08, flash * 0.65);
  const capMinY = centerY + half + 0.002;
  const capMaxY = centerY + half + cap;
  for (let side = 0; side < PRIMED_TNT_SIDE_COUNT; side += 1) {
    appendPrimedTntSideQuad(writer, side, centerX, capMinY, centerZ, cap, capMaxY, 0, dark, dark, dark);
  }
  appendColoredQuad(writer,
    centerX - cap, capMaxY, centerZ - cap,
    centerX - cap, capMaxY, centerZ + cap,
    centerX + cap, capMaxY, centerZ + cap,
    centerX + cap, capMaxY, centerZ - cap,
    dark, dark, dark);
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
  appendStaticBoxes(writer,x,y,z,yaw,264,309);
  appendMobPatches(writer,x,y,z,yaw,0,32);
}

function appendCow(writer: VertexWriter, x: number, y: number, z: number, yaw: number, swing: number): void {
  appendQuadrupedLegs(writer,x,y,z,yaw,swing,0.24,0.46,-0.43,0.63,0.14,0.24,0.16,0.08);
  appendStaticBoxes(writer,x,y,z,yaw,309,354);
  appendMobPatches(writer,x,y,z,yaw,32,72);
}

function appendSheep(writer: VertexWriter, x: number, y: number, z: number, yaw: number, swing: number, sheared: boolean): void {
  appendQuadrupedLegs(writer,x,y,z,yaw,swing,0.2,0.42,-0.4,0.58,0.12,0.19,0.16,0.13);
  if (sheared) appendBox(writer,x,y,z,yaw,0,0,0,-0.36,0.52,-0.57,0.36,1.06,0.54,0.78,0.56,0.52);
  else appendBox(writer,x,y,z,yaw,0,0,0,-0.47,0.48,-0.66,0.47,1.17,0.61,0.86,0.84,0.72);
  appendStaticBoxes(writer,x,y,z,yaw,354,372);
  appendMobPatches(writer,x,y,z,yaw,72,112);
}

function appendChicken(writer: VertexWriter, x: number, y: number, z: number, yaw: number, swing: number): void {
  // The white body/head, tiny beak and dangling red wattle follow the classic
  // chicken silhouette. Narrow yellow legs and side wings animate without
  // leaving the shared mob batch or allocating any per-frame objects.
  appendStaticBoxes(writer,x,y,z,yaw,372,408);
  appendBox(writer,x,y,z,yaw,swing,0.34,-0.04,-0.23,0,-0.12,-0.11,0.38,0.1,0.86,0.57,0.09);
  appendBox(writer,x,y,z,yaw,-swing,0.34,-0.04,0.11,0,-0.12,0.23,0.38,0.1,0.86,0.57,0.09);
  appendBox(writer,x,y,z,yaw,-swing*0.42,0.68,-0.08,-0.45,0.4,-0.34,-0.34,0.76,0.03,0.79,0.79,0.73);
  appendBox(writer,x,y,z,yaw,swing*0.42,0.68,-0.08,0.34,0.4,-0.34,0.45,0.76,0.03,0.79,0.79,0.73);
  appendStaticBoxes(writer,x,y,z,yaw,408,417);
  appendMobPatches(writer,x,y,z,yaw,112,144);
}

function appendZombie(writer: VertexWriter, x: number, y: number, z: number, yaw: number, swing: number): void {
  appendBox(writer,x,y,z,yaw,swing,0.68,0,-0.24,0,-0.15,-0.02,0.72,0.15,0.18,0.22,0.43);
  appendBox(writer,x,y,z,yaw,-swing,0.68,0,0.02,0,-0.15,0.24,0.72,0.15,0.18,0.22,0.43);
  appendStaticBoxes(writer,x,y,z,yaw,417,426);
  appendBox(writer,x,y,z,yaw,-swing*0.8,1.32,0,-0.55,0.77,-0.13,-0.34,1.36,0.13,0.3,0.58,0.27);
  appendBox(writer,x,y,z,yaw,swing*0.8,1.32,0,0.34,0.77,-0.13,0.55,1.36,0.13,0.3,0.58,0.27);
  appendStaticBoxes(writer,x,y,z,yaw,426,435);
  appendMobPatches(writer,x,y,z,yaw,144,192);
}

function appendSkeleton(writer: VertexWriter, x: number, y: number, z: number, yaw: number, swing: number): void {
  const boneR = 0.78;
  const boneG = 0.8;
  const boneB = 0.73;
  // Two narrow legs, pelvis, spine, crossed ribs, bow arms, and a square skull.
  appendBox(writer,x,y,z,yaw,swing,0.7,0,-0.19,0,-0.11,-0.04,0.72,0.11,boneR,boneG,boneB);
  appendBox(writer,x,y,z,yaw,-swing,0.7,0,0.04,0,-0.11,0.19,0.72,0.11,boneR,boneG,boneB);
  appendStaticBoxes(writer,x,y,z,yaw,435,471);
  appendBox(writer,x,y,z,yaw,-0.48,1.34,0,-0.52,0.82,-0.1,-0.3,1.37,0.1,boneR,boneG,boneB);
  appendBox(writer,x,y,z,yaw,0.48,1.34,0,0.3,0.82,-0.1,0.52,1.37,0.1,boneR,boneG,boneB);
  appendStaticBoxes(writer,x,y,z,yaw,471,480);
  appendMobPatches(writer,x,y,z,yaw,192,216);
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
  appendMobPatches(writer,x,y,z,yaw,216,264);
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
  appendStaticBoxes(writer,x,y,z,yaw,480,516);
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
    (HARD_MAX_MOB_POPULATION * MAX_BOXES_PER_MOB * VERTICES_PER_BOX
      + MAX_MOB_PROJECTILES * VERTICES_PER_BOX
      + MAX_PRIMED_TNT_VISUALS * PRIMED_TNT_VERTICES_PER_ENTITY)
      * FLOATS_PER_VERTEX,
  );
  const primedPositions = new Int32Array(MAX_PRIMED_TNT_VISUALS * 3);
  const primedTimes = new Float64Array(MAX_PRIMED_TNT_VISUALS * 2);
  const primedSample: PrimedTntVisualSample = { progress: 0, scale: 0.98, flashMix: 0 };
  let primedCount = 0;
  let primedClockOffset = 0;
  const writer: VertexWriter = { data: vertices, offset: 0, hurtMix: 0, deathCos: 1, deathSin: 0 };
  const observedHealth = new Map<string, number>();
  const hurtUntilSeconds = new Map<string, number>();
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
  let lastMeshAt = -Infinity;
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
    rebuild(poses, cameraX, cameraZ, facingX, facingZ, interpolation, animationSeconds, projectiles = [], frameNowMs) {
      if (Number.isFinite(frameNowMs)) {
        const frameClock = frameNowMs as number;
        if (frameClock >= lastMeshAt && frameClock - lastMeshAt + 0.001 < MOB_MESH_INTERVAL_MS) return stats;
        lastMeshAt = frameClock;
      }
      writer.offset = 0;
      stats.totalMobCount = poses.length;
      stats.visibleMobCount = 0;
      const alpha = Math.max(0, Math.min(1, interpolation));
      const visualSeconds = Number.isFinite(animationSeconds) ? animationSeconds : 0;
      for (let index = 0; index < poses.length; index += 1) {
        const pose = poses[index];
        const currentHealth = Number.isFinite(pose.health) ? Math.max(0, pose.health) : 0;
        const previousHealth = observedHealth.get(pose.id);
        if (previousHealth !== undefined) {
          if (currentHealth < previousHealth) {
            hurtUntilSeconds.set(pose.id, visualSeconds + MOB_HURT_FLASH_SECONDS);
          } else if (currentHealth > previousHealth) {
            hurtUntilSeconds.delete(pose.id);
          }
        }
        observedHealth.set(pose.id, currentHealth);
        const hurtUntil = hurtUntilSeconds.get(pose.id) ?? 0;
        writer.hurtMix = pose.sunBurning ? 0.38
          : visualSeconds < hurtUntil ? MOB_HURT_FLASH_MIX : 0;
        const deathFall = Number.isFinite(pose.deathFall)
          ? Math.max(0, Math.min(1, pose.deathFall))
          : 0;
        const deathAngle = deathFall * Math.PI * 0.5;
        writer.deathCos = Math.cos(deathAngle);
        writer.deathSin = Math.sin(deathAngle);
        if (hurtUntil > 0 && visualSeconds >= hurtUntil) hurtUntilSeconds.delete(pose.id);
        const x = pose.previousX + (pose.x - pose.previousX) * alpha;
        const y = pose.previousY + (pose.y - pose.previousY) * alpha;
        const z = pose.previousZ + (pose.z - pose.previousZ) * alpha;
        const dx = x - cameraX;
        const dz = z - cameraZ;
        const distanceSquared = dx * dx + dz * dz;
        if (distanceSquared > RENDER_DISTANCE_SQUARED) continue;
        if (distanceSquared > 10 * 10 && dx * facingX + dz * facingZ < -2) continue;
        const tickMovementX = pose.x - pose.previousX;
        const tickMovementZ = pose.z - pose.previousZ;
        const moving = tickMovementX * tickMovementX + tickMovementZ * tickMovementZ > 0.000001;
        // Terrain collision may slide one axis or reject a requested step. Face
        // and animate from the displacement that actually happened so mobs do
        // not moonwalk or walk in place when their AI still says chase/wander.
        const yaw = moving
          ? Math.atan2(tickMovementX, tickMovementZ)
          : pose.previousYaw + shortestAngle(pose.previousYaw, pose.yaw) * alpha;
        const swing = moving
          ? Math.sin(animationSeconds * (pose.behavior === "chase" ? 9 : 6) + index * 1.71) * 0.46
          : 0;
        if (pose.kind === "pig") appendPig(writer, x, y, z, yaw, swing);
        else if (pose.kind === "cow") appendCow(writer, x, y, z, yaw, swing);
        else if (pose.kind === "sheep") appendSheep(writer, x, y, z, yaw, swing, pose.sheared);
        else if (pose.kind === "chicken") appendChicken(writer, x, y, z, yaw, swing);
        else if (pose.kind === "zombie") appendZombie(writer, x, y, z, yaw, swing);
        else if (pose.kind === "skeleton") appendSkeleton(writer, x, y, z, yaw, swing);
        else if (pose.kind === "creeper") appendCreeper(writer, x, y, z, yaw, swing, pose.fuseProgress);
        else appendSpider(writer, x, y, z, yaw, swing);
        stats.visibleMobCount += 1;
      }
      // Hurt color is entity-local. Projectiles and primed TNT share this
      // writer but must retain their own palettes.
      writer.hurtMix = 0;
      writer.deathCos = 1;
      writer.deathSin = 0;
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
      observedHealth.clear();
      hurtUntilSeconds.clear();
      gl.deleteBuffer(buffer);
    },
  };
}
