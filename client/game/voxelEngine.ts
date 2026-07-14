import { blockKey, createTerrain, raycastVoxels, terrainHeight } from "./terrain.ts";
import {
  WORLD_CHUNK_SIZE,
  chunkKeyForBlock,
  dirtyChunkKeysForEdits,
  parseChunkKey,
} from "./chunks.ts";
import {
  MAX_REMOTE_PLAYERS,
  advanceRemoteAvatarMotion,
  applyRemoteAvatarSnapshot,
  createRemoteAvatarMotion,
  type RemoteAvatarMotion,
} from "./avatar.ts";
import {
  DEFAULT_DAY_NIGHT_CONFIG,
  createDayNightState,
  sampleDayNight,
  type DayNightConfig,
} from "./dayNight.ts";
import { createMobRenderer } from "./mobRenderer.ts";
import {
  consumeMobContactDamage,
  createMobSimulation,
  createMobSpawns,
  damageMob,
  mobTargetHasClickPriority,
  raycastMobs,
  stepMobSimulation,
  writeMobPoseSnapshots,
  type MobPoseSnapshot,
} from "./mobs.ts";
import {
  BLOCK,
  type BlockId,
  type BlockTarget,
  type PlayerPose,
  type VoxelEngine,
  type VoxelEngineOptions,
  type VoxelPerformanceStats,
  type WorldEdit,
} from "./types.ts";

type Vec3 = [number, number, number];

export const PLAYER_MAX_HEALTH = 20;

interface ChunkMesh {
  buffer: WebGLBuffer;
  vertexCount: number;
  minY: number;
  maxY: number;
}

export interface TorchLightPosition {
  x: number;
  y: number;
  z: number;
}

interface RankedTorchLight extends TorchLightPosition {
  distanceSquared: number;
}

export const MAX_ACTIVE_TORCH_LIGHTS = 8;
export const TORCH_LIGHT_RADIUS = 11;
export const TORCH_MESH_VERTEX_COUNT = 72;

const VERTEX_SHADER = `
attribute vec3 aPosition;
attribute vec3 aColor;
uniform mat4 uMvp;
uniform vec3 uCamera;
uniform float uFogEnabled;
uniform float uLightingEnabled;
uniform vec3 uAmbientColor;
uniform vec3 uDirectionalColor;
uniform float uAmbientIntensity;
uniform float uDirectionalIntensity;
uniform vec4 uTorchLights[8];
varying vec3 vColor;
varying float vFog;
void main() {
  gl_Position = uMvp * vec4(aPosition, 1.0);
  vec3 lighting = vec3(0.16)
    + uAmbientColor * uAmbientIntensity * 0.75
    + uDirectionalColor * uDirectionalIntensity * 0.30;
  vec3 torchLight = vec3(0.0);
  for (int lightIndex = 0; lightIndex < 8; lightIndex++) {
    vec4 light = uTorchLights[lightIndex];
    float attenuation = step(0.001, light.w) * clamp(1.0 - length(light.xyz - aPosition) / max(light.w, 0.001), 0.0, 1.0);
    torchLight += vec3(1.0, 0.43, 0.12) * attenuation * attenuation * 0.95;
  }
  lighting += torchLight;
  vColor = aColor * mix(vec3(1.0), lighting, uLightingEnabled);
  float distanceFromCamera = length(aPosition - uCamera);
  vFog = uFogEnabled * smoothstep(18.0, 42.0, distanceFromCamera);
}`;

const FRAGMENT_SHADER = `
precision mediump float;
uniform vec3 uFogColor;
varying vec3 vColor;
varying float vFog;
void main() {
  gl_FragColor = vec4(mix(vColor, uFogColor, vFog), 1.0);
}`;

const FACE_DEFS: ReadonlyArray<{
  neighbor: Vec3;
  shade: number;
  vertices: ReadonlyArray<Vec3>;
}> = [
  { neighbor: [1, 0, 0], shade: 0.79, vertices: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 0], [1, 1, 1], [1, 0, 1]] },
  { neighbor: [-1, 0, 0], shade: 0.68, vertices: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 1], [0, 1, 0], [0, 0, 0]] },
  { neighbor: [0, 1, 0], shade: 1.0, vertices: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [0, 1, 0], [1, 1, 1], [1, 1, 0]] },
  { neighbor: [0, -1, 0], shade: 0.52, vertices: [[0, 0, 1], [0, 0, 0], [1, 0, 0], [0, 0, 1], [1, 0, 0], [1, 0, 1]] },
  { neighbor: [0, 0, 1], shade: 0.88, vertices: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [1, 0, 1], [0, 1, 1], [0, 0, 1]] },
  { neighbor: [0, 0, -1], shade: 0.73, vertices: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 0], [1, 1, 0], [1, 0, 0]] },
];

const BLOCK_COLORS: Record<BlockId, Vec3> = {
  [BLOCK.AIR]: [0, 0, 0],
  [BLOCK.GRASS]: [0.31, 0.66, 0.23],
  [BLOCK.DIRT]: [0.48, 0.31, 0.17],
  [BLOCK.STONE]: [0.48, 0.51, 0.53],
  [BLOCK.WOOD]: [0.49, 0.31, 0.14],
  [BLOCK.LEAVES]: [0.18, 0.48, 0.19],
  [BLOCK.PLANKS]: [0.69, 0.48, 0.25],
  [BLOCK.CRAFTING_TABLE]: [0.55, 0.35, 0.16],
  [BLOCK.TORCH]: [0.76, 0.46, 0.14],
};

function rankedTorchCompare(a: RankedTorchLight, b: RankedTorchLight): number {
  return a.distanceSquared - b.distanceSquared || a.x - b.x || a.y - b.y || a.z - b.z;
}

/** Selects a stable, bounded nearest set without sorting or copying the full input. */
export function selectNearestTorchLights(
  lights: Iterable<TorchLightPosition>,
  camera: readonly [number, number, number],
  limit = MAX_ACTIVE_TORCH_LIGHTS,
  radius = TORCH_LIGHT_RADIUS,
): TorchLightPosition[] {
  const boundedLimit = Math.max(0, Math.min(MAX_ACTIVE_TORCH_LIGHTS, Math.floor(limit)));
  if (boundedLimit === 0 || radius <= 0) return [];
  const radiusSquared = radius * radius;
  const ranked: RankedTorchLight[] = [];
  for (const light of lights) {
    const dx = light.x - camera[0];
    const dy = light.y - camera[1];
    const dz = light.z - camera[2];
    const distanceSquared = dx * dx + dy * dy + dz * dz;
    if (distanceSquared > radiusSquared) continue;
    const candidate: RankedTorchLight = { x: light.x, y: light.y, z: light.z, distanceSquared };
    let insertionIndex = ranked.length;
    while (insertionIndex > 0 && rankedTorchCompare(candidate, ranked[insertionIndex - 1]) < 0) {
      insertionIndex -= 1;
    }
    if (insertionIndex >= boundedLimit) continue;
    ranked.splice(insertionIndex, 0, candidate);
    if (ranked.length > boundedLimit) ranked.pop();
  }
  return ranked.map(({ x, y, z }) => ({ x, y, z }));
}

export function blockOccludesFaces(block: BlockId): boolean {
  return block !== BLOCK.AIR && block !== BLOCK.TORCH;
}

export function blockHasCollision(block: BlockId): boolean {
  return blockOccludesFaces(block);
}

function compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Unable to create a WebGL shader.");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) || "WebGL shader compilation failed.");
  }
  return shader;
}

function createProgram(gl: WebGLRenderingContext): WebGLProgram {
  const program = gl.createProgram();
  if (!program) throw new Error("Unable to create the WebGL program.");
  gl.attachShader(program, compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
  gl.attachShader(program, compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) || "WebGL program link failed.");
  }
  return program;
}

function perspective(fov: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan(fov / 2);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) / (near - far), -1,
    0, 0, (2 * far * near) / (near - far), 0,
  ]);
}

function lookAt(eye: Vec3, center: Vec3): Float32Array {
  let zx = eye[0] - center[0];
  let zy = eye[1] - center[1];
  let zz = eye[2] - center[2];
  let length = Math.hypot(zx, zy, zz) || 1;
  zx /= length; zy /= length; zz /= length;
  let xx = zz;
  let xy = 0;
  let xz = -zx;
  length = Math.hypot(xx, xy, xz) || 1;
  xx /= length; xy /= length; xz /= length;
  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;
  return new Float32Array([
    xx, yx, zx, 0,
    xy, yy, zy, 0,
    xz, yz, zz, 0,
    -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
    -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
    -(zx * eye[0] + zy * eye[1] + zz * eye[2]),
    1,
  ]);
}

function multiply(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(16);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      out[column * 4 + row] =
        a[row] * b[column * 4] +
        a[4 + row] * b[column * 4 + 1] +
        a[8 + row] * b[column * 4 + 2] +
        a[12 + row] * b[column * 4 + 3];
    }
  }
  return out;
}

function pushVertex(output: number[], position: Vec3, color: Vec3): void {
  output.push(position[0], position[1], position[2], color[0], color[1], color[2]);
}

function tint(color: Vec3, shade: number, variation = 1): Vec3 {
  return [color[0] * shade * variation, color[1] * shade * variation, color[2] * shade * variation];
}

type PointTransform = (point: Vec3) => Vec3;

function appendTransformedBox(
  output: number[],
  min: Vec3,
  max: Vec3,
  color: Vec3,
  transform: PointTransform,
): void {
  for (const face of FACE_DEFS) {
    const shaded = tint(color, face.shade);
    for (const point of face.vertices) {
      pushVertex(output, transform([
        min[0] + point[0] * (max[0] - min[0]),
        min[1] + point[1] * (max[1] - min[1]),
        min[2] + point[2] * (max[2] - min[2]),
      ]), shaded);
    }
  }
}

function appendAxisAlignedBox(output: number[], min: Vec3, max: Vec3, color: Vec3): void {
  for (const face of FACE_DEFS) {
    const shaded = tint(color, face.shade);
    for (const point of face.vertices) {
      pushVertex(output, [
        min[0] + point[0] * (max[0] - min[0]),
        min[1] + point[1] * (max[1] - min[1]),
        min[2] + point[2] * (max[2] - min[2]),
      ], shaded);
    }
  }
}

/** Adds a thin wooden stem and a bright ember cap centered in its block cell. */
export function appendTorchMesh(output: number[], x: number, y: number, z: number): void {
  appendAxisAlignedBox(
    output,
    [x + 0.42, y, z + 0.42],
    [x + 0.58, y + 0.7, z + 0.58],
    [0.53, 0.30, 0.09],
  );
  appendAxisAlignedBox(
    output,
    [x + 0.38, y + 0.67, z + 0.38],
    [x + 0.62, y + 0.88, z + 0.62],
    BLOCK_COLORS[BLOCK.TORCH],
  );
}

function avatarTransform(
  origin: Vec3,
  yaw: number,
  pitch = 0,
  pivotY = 0,
  pivotZ = 0,
): PointTransform {
  const cosPitch = Math.cos(pitch);
  const sinPitch = Math.sin(pitch);
  const cosYaw = Math.cos(yaw);
  const sinYaw = Math.sin(yaw);
  return ([localX, localY, localZ]) => {
    const offsetY = localY - pivotY;
    const offsetZ = localZ - pivotZ;
    const rotatedY = pivotY + offsetY * cosPitch - offsetZ * sinPitch;
    const rotatedZ = pivotZ + offsetY * sinPitch + offsetZ * cosPitch;
    return [
      origin[0] + localX * cosYaw - rotatedZ * sinYaw,
      origin[1] + rotatedY,
      origin[2] + localX * sinYaw + rotatedZ * cosYaw,
    ];
  };
}

const AVATAR_COLORS = {
  skin: [0.72, 0.50, 0.34] as Vec3,
  skinHighlight: [0.82, 0.60, 0.43] as Vec3,
  shirt: [0.05, 0.53, 0.55] as Vec3,
  pants: [0.12, 0.20, 0.58] as Vec3,
  shoes: [0.14, 0.12, 0.13] as Vec3,
  hair: [0.18, 0.10, 0.055] as Vec3,
  eye: [0.08, 0.19, 0.30] as Vec3,
  mouth: [0.30, 0.13, 0.10] as Vec3,
};

function appendAvatar(output: number[], state: RemoteAvatarMotion): void {
  const origin: Vec3 = [state.rendered.x, state.rendered.y, state.rendered.z];
  const stride = Math.min(0.72, state.horizontalSpeed * 0.16) * Math.sin(state.walkPhase);
  const body = avatarTransform(origin, state.bodyYaw);
  const leftLeg = avatarTransform(origin, state.bodyYaw, stride, 0.69, 0);
  const rightLeg = avatarTransform(origin, state.bodyYaw, -stride, 0.69, 0);
  const leftArm = avatarTransform(origin, state.bodyYaw, -stride * 0.9, 1.31, 0);
  const rightArm = avatarTransform(origin, state.bodyYaw, stride * 0.9, 1.31, 0);
  const head = avatarTransform(origin, state.rendered.yaw, state.rendered.pitch * 0.32, 1.62, 0);

  appendTransformedBox(output, [-0.26, 0.08, -0.14], [-0.02, 0.72, 0.14], AVATAR_COLORS.pants, leftLeg);
  appendTransformedBox(output, [0.02, 0.08, -0.14], [0.26, 0.72, 0.14], AVATAR_COLORS.pants, rightLeg);
  appendTransformedBox(output, [-0.26, 0, -0.15], [-0.02, 0.12, 0.16], AVATAR_COLORS.shoes, leftLeg);
  appendTransformedBox(output, [0.02, 0, -0.15], [0.26, 0.12, 0.16], AVATAR_COLORS.shoes, rightLeg);
  appendTransformedBox(output, [-0.34, 0.69, -0.18], [0.34, 1.39, 0.18], AVATAR_COLORS.shirt, body);

  appendTransformedBox(output, [-0.55, 0.68, -0.14], [-0.34, 1.18, 0.14], AVATAR_COLORS.skin, leftArm);
  appendTransformedBox(output, [0.34, 0.68, -0.14], [0.55, 1.18, 0.14], AVATAR_COLORS.skin, rightArm);
  appendTransformedBox(output, [-0.55, 1.17, -0.145], [-0.34, 1.4, 0.145], AVATAR_COLORS.shirt, leftArm);
  appendTransformedBox(output, [0.34, 1.17, -0.145], [0.55, 1.4, 0.145], AVATAR_COLORS.shirt, rightArm);

  appendTransformedBox(output, [-0.25, 1.39, -0.25], [0.25, 1.89, 0.25], AVATAR_COLORS.skinHighlight, head);
  appendTransformedBox(output, [-0.26, 1.80, -0.26], [0.26, 1.91, 0.26], AVATAR_COLORS.hair, head);
  appendTransformedBox(output, [-0.26, 1.70, 0.245], [0.26, 1.84, 0.27], AVATAR_COLORS.hair, head);
  appendTransformedBox(output, [-0.19, 1.72, -0.27], [-0.04, 1.79, -0.245], AVATAR_COLORS.hair, head);
  appendTransformedBox(output, [0.11, 1.72, -0.27], [0.25, 1.79, -0.245], AVATAR_COLORS.hair, head);
  appendTransformedBox(output, [-0.15, 1.63, -0.272], [-0.06, 1.69, -0.248], AVATAR_COLORS.eye, head);
  appendTransformedBox(output, [0.06, 1.63, -0.272], [0.15, 1.69, -0.248], AVATAR_COLORS.eye, head);
  appendTransformedBox(output, [-0.08, 1.50, -0.273], [0.08, 1.54, -0.248], AVATAR_COLORS.mouth, head);
}

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

function appendBillboardQuad(
  output: number[],
  center: Vec3,
  right: Vec3,
  normal: Vec3,
  left: number,
  bottom: number,
  width: number,
  height: number,
  depth: number,
  color: Vec3,
): void {
  const point = (x: number, y: number): Vec3 => [
    center[0] + right[0] * x + normal[0] * depth,
    center[1] + y,
    center[2] + right[2] * x + normal[2] * depth,
  ];
  const a = point(left, bottom);
  const b = point(left + width, bottom);
  const c = point(left + width, bottom + height);
  const d = point(left, bottom + height);
  pushVertex(output, a, color); pushVertex(output, b, color); pushVertex(output, c, color);
  pushVertex(output, a, color); pushVertex(output, c, color); pushVertex(output, d, color);
}

function appendNameplate(output: number[], state: RemoteAvatarMotion, camera: Vec3): void {
  const center: Vec3 = [state.rendered.x, state.rendered.y + 2.13, state.rendered.z];
  let normalX = camera[0] - center[0];
  let normalZ = camera[2] - center[2];
  const length = Math.hypot(normalX, normalZ) || 1;
  normalX /= length;
  normalZ /= length;
  const normal: Vec3 = [normalX, 0, normalZ];
  const right: Vec3 = [normalZ, 0, -normalX];
  const pixel = 0.025;
  const advance = pixel * 4;
  const textWidth = Math.max(pixel * 3, state.name.length * advance - pixel);
  appendBillboardQuad(output, center, right, normal, -textWidth / 2 - 0.055, -0.045, textWidth + 0.11, 0.225, 0, [0.025, 0.028, 0.035]);

  const startX = -textWidth / 2;
  for (let characterIndex = 0; characterIndex < state.name.length; characterIndex += 1) {
    const glyph = FONT[state.name[characterIndex].toUpperCase()] ?? FONT["?"];
    for (let row = 0; row < 5; row += 1) {
      for (let column = 0; column < 3; column += 1) {
        if (glyph[row * 3 + column] !== "1") continue;
        appendBillboardQuad(
          output,
          center,
          right,
          normal,
          startX + characterIndex * advance + column * pixel,
          0.015 + (4 - row) * pixel,
          pixel * 0.82,
          pixel * 0.82,
          0.006,
          [0.94, 0.95, 0.90],
        );
      }
    }
  }
}

function sameTarget(a: BlockTarget | null, b: BlockTarget | null): boolean {
  return a === b || (!!a && !!b && a.block.x === b.block.x && a.block.y === b.block.y && a.block.z === b.block.z);
}

function chunkIntersectsView(key: string, mesh: ChunkMesh, mvp: Float32Array): boolean {
  const coordinate = parseChunkKey(key);
  const minX = coordinate.x * WORLD_CHUNK_SIZE;
  const maxX = minX + WORLD_CHUNK_SIZE;
  const minZ = coordinate.z * WORLD_CHUNK_SIZE;
  const maxZ = minZ + WORLD_CHUNK_SIZE;
  const centerX = (minX + maxX) * 0.5;
  const centerY = (mesh.minY + mesh.maxY) * 0.5;
  const centerZ = (minZ + maxZ) * 0.5;
  const extentX = WORLD_CHUNK_SIZE * 0.5;
  const extentY = Math.max(0.5, (mesh.maxY - mesh.minY) * 0.5);
  const extentZ = WORLD_CHUNK_SIZE * 0.5;
  // Column-major clip matrix: each plane is row 4 +/- one axis row.
  const planes = [
    [mvp[3] + mvp[0], mvp[7] + mvp[4], mvp[11] + mvp[8], mvp[15] + mvp[12]],
    [mvp[3] - mvp[0], mvp[7] - mvp[4], mvp[11] - mvp[8], mvp[15] - mvp[12]],
    [mvp[3] + mvp[1], mvp[7] + mvp[5], mvp[11] + mvp[9], mvp[15] + mvp[13]],
    [mvp[3] - mvp[1], mvp[7] - mvp[5], mvp[11] - mvp[9], mvp[15] - mvp[13]],
    [mvp[3] + mvp[2], mvp[7] + mvp[6], mvp[11] + mvp[10], mvp[15] + mvp[14]],
    [mvp[3] - mvp[2], mvp[7] - mvp[6], mvp[11] - mvp[10], mvp[15] - mvp[14]],
  ];
  for (const plane of planes) {
    const distance = plane[0] * centerX + plane[1] * centerY + plane[2] * centerZ + plane[3];
    const radius = Math.abs(plane[0]) * extentX + Math.abs(plane[1]) * extentY + Math.abs(plane[2]) * extentZ;
    if (distance + radius < 0) return false;
  }
  return true;
}

export function createVoxelEngine(canvas: HTMLCanvasElement, options: VoxelEngineOptions = {}): VoxelEngine {
  const gl = canvas.getContext("webgl", { alpha: false, antialias: true });
  if (!gl) throw new Error("Lakecraft needs a browser with WebGL enabled.");
  const program = createProgram(gl);
  const positionLocation = gl.getAttribLocation(program, "aPosition");
  const colorLocation = gl.getAttribLocation(program, "aColor");
  const mvpLocation = gl.getUniformLocation(program, "uMvp");
  const cameraLocation = gl.getUniformLocation(program, "uCamera");
  const fogLocation = gl.getUniformLocation(program, "uFogEnabled");
  const fogColorLocation = gl.getUniformLocation(program, "uFogColor");
  const lightingLocation = gl.getUniformLocation(program, "uLightingEnabled");
  const ambientColorLocation = gl.getUniformLocation(program, "uAmbientColor");
  const directionalColorLocation = gl.getUniformLocation(program, "uDirectionalColor");
  const ambientIntensityLocation = gl.getUniformLocation(program, "uAmbientIntensity");
  const directionalIntensityLocation = gl.getUniformLocation(program, "uDirectionalIntensity");
  const torchLightsLocation = gl.getUniformLocation(program, "uTorchLights[0]");
  const remoteBuffer = gl.createBuffer();
  const nameplateBuffer = gl.createBuffer();
  const lineBuffer = gl.createBuffer();
  if (!remoteBuffer || !nameplateBuffer || !lineBuffer) throw new Error("Unable to allocate WebGL buffers.");

  const seed = options.seed ?? 7319;
  const radius = Math.max(8, Math.min(40, options.worldRadius ?? 20));
  const dayNightConfig: DayNightConfig = {
    cycleLengthMs: options.dayNight?.cycleLengthMs ?? DEFAULT_DAY_NIGHT_CONFIG.cycleLengthMs,
    epochMs: options.dayNight?.epochMs ?? DEFAULT_DAY_NIGHT_CONFIG.epochMs,
    epochPhase: options.dayNight?.epochPhase ?? DEFAULT_DAY_NIGHT_CONFIG.epochPhase,
  };
  const serverTimeOffsetMs = Number.isFinite(options.serverTimeOffsetMs)
    ? options.serverTimeOffsetMs ?? 0
    : 0;
  const dayNightState = createDayNightState();
  const blocks = createTerrain(seed, radius);
  for (const edit of options.initialEdits ?? []) {
    const key = blockKey(edit.x, edit.y, edit.z);
    if (edit.block === BLOCK.AIR) blocks.delete(key);
    else blocks.set(key, edit.block);
  }
  const torchLights = new Map<string, TorchLightPosition>();
  for (const [key, block] of blocks) {
    if (block !== BLOCK.TORCH) continue;
    const [x, y, z] = key.split(",").map(Number);
    torchLights.set(key, { x: x + 0.5, y: y + 0.76, z: z + 0.5 });
  }
  const activeTorchUniforms = new Float32Array(MAX_ACTIVE_TORCH_LIGHTS * 4);
  const chunkBlocks = new Map<string, Set<string>>();
  for (const key of blocks.keys()) {
    const separatorA = key.indexOf(",");
    const separatorB = key.indexOf(",", separatorA + 1);
    const x = Number(key.slice(0, separatorA));
    const z = Number(key.slice(separatorB + 1));
    const owner = chunkKeyForBlock(x, z);
    let owned = chunkBlocks.get(owner);
    if (!owned) {
      owned = new Set<string>();
      chunkBlocks.set(owner, owned);
    }
    owned.add(key);
  }
  const chunkMeshes = new Map<string, ChunkMesh>();
  const mobRenderer = createMobRenderer(gl);
  const mobSimulation = createMobSimulation(createMobSpawns({
    seed,
    radius: Math.max(6, radius - 2),
    terrainHeight: (x, z) => terrainHeight(x, z, seed),
    passivePopulation: Math.min(12, Math.max(6, Math.floor(radius / 2))),
    hostilePopulation: Math.min(5, Math.max(2, Math.floor(radius / 5))),
    maxPopulation: 17,
    spawnClearRadius: 6,
    isSpawnable: (_kind, x, y, z) => !blocks.has(blockKey(x, y, z)) && !blocks.has(blockKey(x, y + 1, z)),
  }));
  const mobSnapshots: MobPoseSnapshot[] = [];
  const startY = terrainHeight(0, 0, seed) + 1.02;
  const pose: PlayerPose = {
    x: options.initialPose?.x ?? 0.5,
    y: options.initialPose?.y ?? startY,
    z: options.initialPose?.z ?? 0.5,
    yaw: options.initialPose?.yaw ?? 0,
    pitch: options.initialPose?.pitch ?? -0.08,
  };
  const velocity: Vec3 = [0, 0, 0];
  const keys = new Set<string>();
  let selectedBlock = options.selectedBlock ?? BLOCK.DIRT;
  let worldVertexCount = 0;
  let remoteVertexCount = 0;
  let nameplateVertexCount = 0;
  const remoteStates = new Map<string, RemoteAvatarMotion>();
  let target: BlockTarget | null = null;
  let running = false;
  let destroyed = false;
  let frameId = 0;
  let lastFrame = 0;
  let lastPoseSent = 0;
  let poseDirty = true;
  let grounded = false;
  let miningTimer = 0;
  const frameTimes: number[] = [];
  let totalMeshRebuildMs = 0;
  let lastMeshRebuildMs = 0;
  let lastRebuiltChunkCount = 0;
  let totalRebuiltChunkCount = 0;
  let visibleChunkCount = 0;
  let drawCalls = 0;
  let avatarDrawCalls = 0;
  let mobDrawCalls = 0;
  let mobVertexCount = 0;
  let visibleMobCount = 0;
  let lastMobSimulationMs = 0;
  let mobAccumulatorSeconds = 0;
  const mobStepSeconds = 0.1;
  let playerHealth = PLAYER_MAX_HEALTH;
  let lastPerformanceSent = 0;
  let activeTorchLights = 0;
  let lastTorchSelectionAt = -Infinity;
  let lastTorchCameraX = Infinity;
  let lastTorchCameraY = Infinity;
  let lastTorchCameraZ = Infinity;

  function clearMining(): void {
    if (miningTimer) window.clearTimeout(miningTimer);
    miningTimer = 0;
  }

  const getBlock = (x: number, y: number, z: number): BlockId => {
    if (y < 0) return BLOCK.STONE;
    return blocks.get(blockKey(x, y, z)) ?? BLOCK.AIR;
  };

  function setBlock(x: number, y: number, z: number, block: BlockId): void {
    const key = blockKey(x, y, z);
    const owner = chunkKeyForBlock(x, z);
    const previous = blocks.get(key) ?? BLOCK.AIR;
    if (previous === BLOCK.TORCH) torchLights.delete(key);
    if (block === BLOCK.AIR) {
      blocks.delete(key);
      const owned = chunkBlocks.get(owner);
      owned?.delete(key);
      if (owned?.size === 0) chunkBlocks.delete(owner);
    } else {
      blocks.set(key, block);
      if (block === BLOCK.TORCH) torchLights.set(key, { x: x + 0.5, y: y + 0.76, z: z + 0.5 });
      if (previous === BLOCK.AIR) {
        let owned = chunkBlocks.get(owner);
        if (!owned) {
          owned = new Set<string>();
          chunkBlocks.set(owner, owned);
        }
        owned.add(key);
      }
    }
  }

  function rebuildChunkMesh(chunkKey: string): void {
    const vertices: number[] = [];
    let minY = Infinity;
    let maxY = -Infinity;
    for (const key of chunkBlocks.get(chunkKey) ?? []) {
      const block = blocks.get(key);
      if (block === undefined || block === BLOCK.AIR) continue;
      const [x, y, z] = key.split(",").map(Number);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y + 1);
      if (block === BLOCK.TORCH) {
        appendTorchMesh(vertices, x, y, z);
        continue;
      }
      const base = BLOCK_COLORS[block] ?? BLOCK_COLORS[BLOCK.STONE];
      const variation = 0.93 + (((Math.imul(x, 13) ^ Math.imul(y, 7) ^ Math.imul(z, 17)) & 7) / 100);
      for (const face of FACE_DEFS) {
        if (blockOccludesFaces(getBlock(x + face.neighbor[0], y + face.neighbor[1], z + face.neighbor[2]))) continue;
        const color = tint(base, face.shade, variation);
        for (const point of face.vertices) pushVertex(vertices, [x + point[0], y + point[1], z + point[2]], color);
      }
    }
    const previous = chunkMeshes.get(chunkKey);
    worldVertexCount -= previous?.vertexCount ?? 0;
    if (vertices.length === 0) {
      if (previous) gl.deleteBuffer(previous.buffer);
      chunkMeshes.delete(chunkKey);
      return;
    }
    const buffer = previous?.buffer ?? gl.createBuffer();
    if (!buffer) throw new Error("Unable to allocate a chunk mesh buffer.");
    const vertexCount = vertices.length / 6;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
    chunkMeshes.set(chunkKey, { buffer, vertexCount, minY, maxY });
    worldVertexCount += vertexCount;
  }

  function rebuildWorldChunks(keys: readonly string[]): void {
    const uniqueKeys = [...new Set(keys)];
    const startedAt = performance.now();
    for (const key of uniqueKeys) rebuildChunkMesh(key);
    lastMeshRebuildMs = performance.now() - startedAt;
    totalMeshRebuildMs += lastMeshRebuildMs;
    lastRebuiltChunkCount = uniqueKeys.length;
    totalRebuiltChunkCount += uniqueKeys.length;
  }

  function rebuildRemoteMeshes(now: number, dt: number, camera: Vec3): void {
    const avatarVertices: number[] = [];
    const nameplateVertices: number[] = [];
    for (const state of remoteStates.values()) {
      advanceRemoteAvatarMotion(state, now, dt);
      const distanceX = state.rendered.x - camera[0];
      const distanceZ = state.rendered.z - camera[2];
      if (distanceX * distanceX + distanceZ * distanceZ > 64 * 64) continue;
      appendAvatar(avatarVertices, state);
      appendNameplate(nameplateVertices, state, camera);
    }
    remoteVertexCount = avatarVertices.length / 6;
    nameplateVertexCount = nameplateVertices.length / 6;
    gl.bindBuffer(gl.ARRAY_BUFFER, remoteBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(avatarVertices), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, nameplateBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(nameplateVertices), gl.DYNAMIC_DRAW);
  }

  function collides(x: number, y: number, z: number): boolean {
    const halfWidth = 0.29;
    const minX = Math.floor(x - halfWidth);
    const maxX = Math.floor(x + halfWidth);
    const minY = Math.floor(y + 0.001);
    const maxY = Math.floor(y + 1.77);
    const minZ = Math.floor(z - halfWidth);
    const maxZ = Math.floor(z + halfWidth);
    for (let bx = minX; bx <= maxX; bx += 1) {
      for (let by = minY; by <= maxY; by += 1) {
        for (let bz = minZ; bz <= maxZ; bz += 1) {
          if (blockHasCollision(getBlock(bx, by, bz))) return true;
        }
      }
    }
    return false;
  }

  function moveAxis(axis: 0 | 1 | 2, amount: number): boolean {
    if (amount === 0) return false;
    const values: Vec3 = [pose.x, pose.y, pose.z];
    const initial = values[axis];
    values[axis] += amount;
    if (!collides(values[0], values[1], values[2])) {
      pose.x = values[0]; pose.y = values[1]; pose.z = values[2];
      poseDirty = true;
      return false;
    }
    let safe = initial;
    let blocked = values[axis];
    for (let iteration = 0; iteration < 8; iteration += 1) {
      const midpoint = (safe + blocked) / 2;
      values[axis] = midpoint;
      if (collides(values[0], values[1], values[2])) blocked = midpoint;
      else safe = midpoint;
    }
    values[axis] = safe;
    pose.x = values[0]; pose.y = values[1]; pose.z = values[2];
    if (Math.abs(safe - initial) > 0.00001) poseDirty = true;
    return true;
  }

  function direction(): Vec3 {
    const cosPitch = Math.cos(pose.pitch);
    return [Math.sin(pose.yaw) * cosPitch, Math.sin(pose.pitch), -Math.cos(pose.yaw) * cosPitch];
  }

  function mobCanOccupy(_kind: unknown, x: number, y: number, z: number, collisionRadius: number, height: number): boolean {
    const minY = Math.floor(y + 0.01);
    const maxY = Math.floor(y + height - 0.01);
    for (let xSide = -1; xSide <= 1; xSide += 2) {
      const sampleX = x + collisionRadius * xSide;
      for (let zSide = -1; zSide <= 1; zSide += 2) {
        const sampleZ = z + collisionRadius * zSide;
        for (let sampleY = minY; sampleY <= maxY; sampleY += 1) {
          if (blockHasCollision(getBlock(Math.floor(sampleX), sampleY, Math.floor(sampleZ)))) return false;
        }
      }
    }
    return true;
  }

  function updateMobs(dt: number): void {
    const startedAt = performance.now();
    mobAccumulatorSeconds = Math.min(0.3, mobAccumulatorSeconds + dt);
    let steps = 0;
    while (mobAccumulatorSeconds >= mobStepSeconds && steps < 3) {
      const isNight = dayNightState.label === "night" || dayNightState.label === "dusk";
      stepMobSimulation(mobSimulation, {
        dtSeconds: mobStepSeconds,
        isNight,
        terrainHeight: (x, z) => terrainHeight(x, z, seed),
        player: pose,
        canOccupy: mobCanOccupy,
        worldRadius: radius - 1,
      });
      mobAccumulatorSeconds -= mobStepSeconds;
      steps += 1;
      if (playerHealth > 0) {
        const contactDamage = consumeMobContactDamage(
          mobSimulation,
          pose,
          mobSimulation.elapsedSeconds,
          isNight,
        );
        if (contactDamage > 0) {
          const rawProtection = options.getPlayerProtection?.() ?? 0;
          const protection = Number.isFinite(rawProtection) ? Math.max(0, Math.min(20, rawProtection)) : 0;
          const mitigatedDamage = Math.max(1, contactDamage - Math.floor(protection / 2));
          const appliedDamage = Math.min(playerHealth, mitigatedDamage);
          playerHealth -= appliedDamage;
          options.onPlayerDamage?.(appliedDamage);
          options.onPlayerHealthChange?.(playerHealth, PLAYER_MAX_HEALTH);
        }
      }
    }
    writeMobPoseSnapshots(mobSimulation, mobSnapshots);
    lastMobSimulationMs = performance.now() - startedAt;
  }

  function update(dt: number, now: number): void {
    const forward = (keys.has("KeyW") ? 1 : 0) - (keys.has("KeyS") ? 1 : 0);
    const strafe = (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0);
    const magnitude = Math.hypot(forward, strafe) || 1;
    const speed = keys.has("ShiftLeft") ? 6.1 : 4.35;
    const dx = ((Math.sin(pose.yaw) * forward + Math.cos(pose.yaw) * strafe) / magnitude) * speed * dt;
    const dz = ((-Math.cos(pose.yaw) * forward + Math.sin(pose.yaw) * strafe) / magnitude) * speed * dt;
    moveAxis(0, dx);
    moveAxis(2, dz);
    velocity[1] = Math.max(-18, velocity[1] - 22 * dt);
    const verticalBlocked = moveAxis(1, velocity[1] * dt);
    if (verticalBlocked) {
      grounded = velocity[1] < 0;
      velocity[1] = 0;
    } else grounded = false;

    const nextTarget = raycastVoxels([pose.x, pose.y + 1.62, pose.z], direction(), getBlock, options.reach ?? 6);
    if (!sameTarget(target, nextTarget)) {
      clearMining();
      target = nextTarget;
      options.onTargetChange?.(target);
    } else target = nextTarget;

    if (now - lastPoseSent > 90 && (poseDirty || forward !== 0 || strafe !== 0 || Math.abs(velocity[1]) > 0.01)) {
      lastPoseSent = now;
      poseDirty = false;
      options.onPoseChange?.({ ...pose });
    }
    updateMobs(dt);
  }

  function bindBuffer(buffer: WebGLBuffer): void {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(colorLocation);
    gl.vertexAttribPointer(colorLocation, 3, gl.FLOAT, false, 24, 12);
  }

  function resize(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    const height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
  }

  function updateActiveTorchLights(now: number, eye: Vec3): void {
    const movedSquared = (eye[0] - lastTorchCameraX) ** 2 + (eye[1] - lastTorchCameraY) ** 2 + (eye[2] - lastTorchCameraZ) ** 2;
    if (now - lastTorchSelectionAt < 250 && movedSquared < 0.25) return;
    lastTorchSelectionAt = now;
    lastTorchCameraX = eye[0];
    lastTorchCameraY = eye[1];
    lastTorchCameraZ = eye[2];
    activeTorchUniforms.fill(0);
    const nearest = selectNearestTorchLights(torchLights.values(), eye, MAX_ACTIVE_TORCH_LIGHTS, TORCH_LIGHT_RADIUS);
    activeTorchLights = nearest.length;
    for (let index = 0; index < nearest.length; index += 1) {
      const light = nearest[index];
      const offset = index * 4;
      activeTorchUniforms[offset] = light.x;
      activeTorchUniforms[offset + 1] = light.y;
      activeTorchUniforms[offset + 2] = light.z;
      activeTorchUniforms[offset + 3] = TORCH_LIGHT_RADIUS;
    }
  }

  function getPerformanceStats(): VoxelPerformanceStats {
    const sortedFrameTimes = [...frameTimes].sort((a, b) => a - b);
    const averageFrameTimeMs = frameTimes.length
      ? frameTimes.reduce((total, value) => total + value, 0) / frameTimes.length
      : 0;
    const p95Index = Math.max(0, Math.ceil(sortedFrameTimes.length * 0.95) - 1);
    return {
      fps: averageFrameTimeMs > 0 ? 1_000 / averageFrameTimeMs : 0,
      averageFrameTimeMs,
      p95FrameTimeMs: sortedFrameTimes[p95Index] ?? 0,
      frameSampleCount: frameTimes.length,
      lastMeshRebuildMs,
      totalMeshRebuildMs,
      lastRebuiltChunkCount,
      totalRebuiltChunkCount,
      worldVertexCount,
      blockCount: blocks.size,
      chunkCount: chunkMeshes.size,
      visibleChunkCount,
      drawCalls,
      avatarDrawCalls,
      avatarVertexCount: remoteVertexCount,
      nameplateVertexCount,
      mobDrawCalls,
      mobVertexCount,
      mobVisibleCount: visibleMobCount,
      mobCount: mobSimulation.mobs.length,
      mobSimulationMs: lastMobSimulationMs,
      torchCount: torchLights.size,
      activeTorchLights,
      estimatedMeshBytes: (worldVertexCount + remoteVertexCount + nameplateVertexCount + mobVertexCount) * 6 * Float32Array.BYTES_PER_ELEMENT,
    };
  }

  function render(now: number, dt: number): void {
    resize();
    const eye: Vec3 = [pose.x, pose.y + 1.62, pose.z];
    rebuildRemoteMeshes(now, dt, eye);
    const facing = direction();
    const projection = perspective(Math.PI / 3, canvas.width / canvas.height, 0.05, 90);
    const view = lookAt(eye, [eye[0] + facing[0], eye[1] + facing[1], eye[2] + facing[2]]);
    const mvp = multiply(projection, view);
    sampleDayNight(Date.now() + serverTimeOffsetMs, dayNightConfig, dayNightState);
    updateActiveTorchLights(now, eye);
    const mobStats = mobRenderer.rebuild(
      mobSnapshots,
      eye[0],
      eye[2],
      facing[0],
      facing[2],
      Math.min(1, mobAccumulatorSeconds / mobStepSeconds),
      now / 1_000,
    );
    mobVertexCount = mobStats.vertexCount;
    visibleMobCount = mobStats.visibleMobCount;
    gl.clearColor(dayNightState.skyR, dayNightState.skyG, dayNightState.skyB, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(program);
    gl.uniformMatrix4fv(mvpLocation, false, mvp);
    gl.uniform3fv(cameraLocation, eye);
    gl.uniform3f(fogColorLocation, dayNightState.fogR, dayNightState.fogG, dayNightState.fogB);
    gl.uniform3f(
      ambientColorLocation,
      dayNightState.ambientR,
      dayNightState.ambientG,
      dayNightState.ambientB,
    );
    gl.uniform3f(
      directionalColorLocation,
      dayNightState.directionalR,
      dayNightState.directionalG,
      dayNightState.directionalB,
    );
    gl.uniform1f(ambientIntensityLocation, dayNightState.ambientIntensity);
    gl.uniform1f(directionalIntensityLocation, dayNightState.directionalIntensity);
    gl.uniform4fv(torchLightsLocation, activeTorchUniforms);
    gl.uniform1f(lightingLocation, 1);
    gl.uniform1f(fogLocation, 1);
    visibleChunkCount = 0;
    drawCalls = 0;
    avatarDrawCalls = 0;
    mobDrawCalls = 0;
    for (const [key, mesh] of chunkMeshes) {
      if (!chunkIntersectsView(key, mesh, mvp)) continue;
      bindBuffer(mesh.buffer);
      gl.drawArrays(gl.TRIANGLES, 0, mesh.vertexCount);
      visibleChunkCount += 1;
      drawCalls += 1;
    }
    if (remoteVertexCount) {
      bindBuffer(remoteBuffer);
      gl.drawArrays(gl.TRIANGLES, 0, remoteVertexCount);
      drawCalls += 1;
      avatarDrawCalls += 1;
    }
    if (mobVertexCount) {
      bindBuffer(mobRenderer.buffer);
      gl.drawArrays(gl.TRIANGLES, 0, mobVertexCount);
      drawCalls += 1;
      mobDrawCalls += 1;
    }
    if (nameplateVertexCount) {
      bindBuffer(nameplateBuffer);
      gl.uniform1f(fogLocation, 0);
      gl.uniform1f(lightingLocation, 0);
      gl.drawArrays(gl.TRIANGLES, 0, nameplateVertexCount);
      drawCalls += 1;
      avatarDrawCalls += 1;
    }

    if (target) {
      const { x, y, z } = target.block;
      const e = 0.003;
      const corners: Vec3[] = [
        [x - e, y - e, z - e], [x + 1 + e, y - e, z - e], [x + 1 + e, y + 1 + e, z - e], [x - e, y + 1 + e, z - e],
        [x - e, y - e, z + 1 + e], [x + 1 + e, y - e, z + 1 + e], [x + 1 + e, y + 1 + e, z + 1 + e], [x - e, y + 1 + e, z + 1 + e],
      ];
      const edgeIndices = [0,1, 1,2, 2,3, 3,0, 4,5, 5,6, 6,7, 7,4, 0,4, 1,5, 2,6, 3,7];
      const lines: number[] = [];
      for (const index of edgeIndices) pushVertex(lines, corners[index], [1, 1, 1]);
      gl.bindBuffer(gl.ARRAY_BUFFER, lineBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lines), gl.DYNAMIC_DRAW);
      bindBuffer(lineBuffer);
      gl.uniform1f(fogLocation, 0);
      gl.uniform1f(lightingLocation, 0);
      gl.drawArrays(gl.LINES, 0, edgeIndices.length);
      drawCalls += 1;
    }

    // Crosshair in clip space, drawn last so it remains readable against foliage.
    const crossX = 9 / canvas.width * 2;
    const crossY = 9 / canvas.height * 2;
    const crosshair: number[] = [];
    pushVertex(crosshair, [-crossX, 0, 0], [1, 1, 1]); pushVertex(crosshair, [crossX, 0, 0], [1, 1, 1]);
    pushVertex(crosshair, [0, -crossY, 0], [1, 1, 1]); pushVertex(crosshair, [0, crossY, 0], [1, 1, 1]);
    gl.bindBuffer(gl.ARRAY_BUFFER, lineBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(crosshair), gl.DYNAMIC_DRAW);
    bindBuffer(lineBuffer);
    gl.disable(gl.DEPTH_TEST);
    gl.uniformMatrix4fv(mvpLocation, false, new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]));
    gl.uniform1f(fogLocation, 0);
    gl.uniform1f(lightingLocation, 0);
    gl.drawArrays(gl.LINES, 0, 4);
    drawCalls += 1;
  }

  function frame(now: number): void {
    if (!running || destroyed) return;
    const frameTimeMs = Math.max(0, now - lastFrame);
    const dt = Math.min(0.05, frameTimeMs / 1000);
    lastFrame = now;
    if (frameTimeMs > 0) {
      frameTimes.push(frameTimeMs);
      if (frameTimes.length > 120) frameTimes.shift();
    }
    update(dt, now);
    render(now, dt);
    if (now - lastPerformanceSent >= 500) {
      lastPerformanceSent = now;
      options.onPerformanceStats?.(getPerformanceStats());
    }
    frameId = requestAnimationFrame(frame);
  }

  function emitEdit(edit: WorldEdit): void {
    const previousBlock = getBlock(edit.x, edit.y, edit.z);
    setBlock(edit.x, edit.y, edit.z, edit.block);
    rebuildWorldChunks(dirtyChunkKeysForEdits([edit]));
    options.onBlockEdit?.(edit, previousBlock);
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (/^Digit[1-7]$/.test(event.code)) selectedBlock = Number(event.code.slice(5)) as BlockId;
    if (document.pointerLockElement !== canvas) return;
    keys.add(event.code);
    if (event.code === "Space") {
      event.preventDefault();
      if (grounded) {
        velocity[1] = 8.25;
        grounded = false;
      }
    }
  }

  function onKeyUp(event: KeyboardEvent): void {
    keys.delete(event.code);
  }

  function onMouseMove(event: MouseEvent): void {
    if (document.pointerLockElement !== canvas) return;
    pose.yaw -= event.movementX * 0.0022;
    pose.pitch = Math.max(-1.52, Math.min(1.52, pose.pitch - event.movementY * 0.0022));
    poseDirty = true;
  }

  function playerIntersectsBlock(x: number, y: number, z: number): boolean {
    return pose.x + 0.29 > x && pose.x - 0.29 < x + 1 && pose.y + 1.78 > y && pose.y < y + 1 && pose.z + 0.29 > z && pose.z - 0.29 < z + 1;
  }

  function attackMobUnderCrosshair(): boolean {
    const eye: Vec3 = [pose.x, pose.y + 1.62, pose.z];
    const mobTarget = raycastMobs(eye, direction(), mobSimulation.mobs, options.reach ?? 6);
    // A solid voxel hit closer to the camera occludes the mob.
    if (!mobTarget || !mobTargetHasClickPriority(mobTarget.distance, target?.distance ?? null)) return false;
    const rawDamage = options.getAttackDamage?.() ?? 1;
    const attackDamage = Number.isFinite(rawDamage) ? Math.max(0, Math.min(100, rawDamage)) : 1;
    const result = damageMob(mobSimulation, mobTarget.id, attackDamage);
    if (!result.found) return false;
    clearMining();
    writeMobPoseSnapshots(mobSimulation, mobSnapshots);
    if (result.killed && result.drops.length) options.onMobDrops?.(result.drops);
    return true;
  }

  function onMouseDown(event: MouseEvent): void {
    event.preventDefault();
    if (document.pointerLockElement !== canvas) {
      canvas.requestPointerLock();
      return;
    }
    if (event.button === 0) {
      if (attackMobUnderCrosshair()) return;
      if (!target) return;
      if (miningTimer) return;
      const mined = { ...target.block };
      const duration = Math.max(0, options.getMiningDuration?.(mined.block) ?? 0);
      if (duration === 0) {
        emitEdit({ x: mined.x, y: mined.y, z: mined.z, block: BLOCK.AIR });
      } else {
        miningTimer = window.setTimeout(() => {
          miningTimer = 0;
          if (getBlock(mined.x, mined.y, mined.z) === mined.block) {
            emitEdit({ x: mined.x, y: mined.y, z: mined.z, block: BLOCK.AIR });
          }
        }, duration * 1_000);
      }
    } else if (event.button === 2 && selectedBlock !== BLOCK.AIR) {
      if (!target) return;
      const { x, y, z } = target.place;
      if (getBlock(x, y, z) === BLOCK.AIR && !playerIntersectsBlock(x, y, z)) emitEdit({ x, y, z, block: selectedBlock });
    }
  }

  function onMouseUp(event: MouseEvent): void {
    if (event.button === 0) clearMining();
  }

  function onPointerLockChange(): void {
    if (document.pointerLockElement !== canvas) {
      keys.clear();
      clearMining();
    }
    options.onPointerLockChange?.(document.pointerLockElement === canvas);
  }

  function onContextMenu(event: MouseEvent): void { event.preventDefault(); }

  rebuildWorldChunks([...chunkBlocks.keys()]);

  return {
    start() {
      if (running || destroyed) return;
      running = true;
      lastFrame = performance.now();
      window.addEventListener("keydown", onKeyDown);
      window.addEventListener("keyup", onKeyUp);
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("pointerlockchange", onPointerLockChange);
      canvas.addEventListener("mousedown", onMouseDown);
      canvas.addEventListener("mouseup", onMouseUp);
      canvas.addEventListener("contextmenu", onContextMenu);
      options.onPoseChange?.({ ...pose });
      options.onPlayerHealthChange?.(playerHealth, PLAYER_MAX_HEALTH);
      frameId = requestAnimationFrame(frame);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      running = false;
      cancelAnimationFrame(frameId);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("pointerlockchange", onPointerLockChange);
      canvas.removeEventListener("mousedown", onMouseDown);
      canvas.removeEventListener("mouseup", onMouseUp);
      canvas.removeEventListener("contextmenu", onContextMenu);
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      clearMining();
      for (const mesh of chunkMeshes.values()) gl.deleteBuffer(mesh.buffer);
      chunkMeshes.clear();
      gl.deleteBuffer(remoteBuffer);
      gl.deleteBuffer(nameplateBuffer);
      gl.deleteBuffer(lineBuffer);
      mobRenderer.destroy();
      gl.deleteProgram(program);
    },
    applyWorldEdits(edits) {
      for (const edit of edits) setBlock(edit.x, edit.y, edit.z, edit.block);
      if (edits.length) rebuildWorldChunks(dirtyChunkKeysForEdits(edits));
    },
    setSelectedBlock(block) {
      selectedBlock = block;
    },
    setRemotePlayers(players) {
      const now = performance.now();
      const incomingIds = new Set<string>();
      for (const player of players.slice(0, MAX_REMOTE_PLAYERS)) {
        const id = String(player.id).slice(0, 128);
        if (!id || incomingIds.has(id)) continue;
        incomingIds.add(id);
        const current = remoteStates.get(id);
        if (current) applyRemoteAvatarSnapshot(current, player, now);
        else remoteStates.set(id, createRemoteAvatarMotion({ ...player, id }, now));
      }
      for (const id of remoteStates.keys()) {
        if (!incomingIds.has(id)) remoteStates.delete(id);
      }
    },
    getPose() { return { ...pose }; },
    getTarget() { return target ? { block: { ...target.block }, place: { ...target.place }, distance: target.distance } : null; },
    getPerformanceStats,
    requestPointerLock() { canvas.requestPointerLock(); },
    respawn() {
      pose.x = 0.5;
      pose.y = startY;
      pose.z = 0.5;
      pose.yaw = 0;
      pose.pitch = -0.08;
      velocity[0] = 0;
      velocity[1] = 0;
      velocity[2] = 0;
      playerHealth = PLAYER_MAX_HEALTH;
      poseDirty = true;
      options.onPoseChange?.({ ...pose });
      options.onPlayerHealthChange?.(playerHealth, PLAYER_MAX_HEALTH);
    },
  };
}
