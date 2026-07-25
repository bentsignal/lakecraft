import { ITEMS, type ItemId } from "../../shared/game.ts";
import { TEXTURED_WORLD_VERTEX_FLOATS, blockTextureForFace, textureAtlasUv } from "./blockTextures.ts";
import { CUBE_FACES } from "./cubeFaces.ts";
import { writeMatrixProduct } from "./matrixProduct.ts";
import { BLOCK, type BlockId } from "./types.ts";

type Vec3 = readonly [number, number, number];

const FLOATS_PER_COLOR_VERTEX = 6;
const VERTICES_PER_BOX = 36;
export const FIRST_PERSON_MAX_COLOR_BOXES = 18;
export const FIRST_PERSON_MAX_COLOR_VERTICES = FIRST_PERSON_MAX_COLOR_BOXES * VERTICES_PER_BOX;
export const FIRST_PERSON_MAX_TEXTURED_VERTICES = 36;
export const FIRST_PERSON_ACTION_MS = 220;

const SKIN: Vec3 = [0.74, 0.50, 0.34];
const SLEEVE: Vec3 = [0.05, 0.54, 0.56];
const HANDLE: Vec3 = [0.43, 0.27, 0.11];
const STRING: Vec3 = [0.87, 0.85, 0.78];
const ARROW: Vec3 = [0.48, 0.29, 0.12];
const ARROWHEAD: Vec3 = [0.68, 0.70, 0.68];
const FLETCHING: Vec3 = [0.91, 0.88, 0.80];
const BOW: Vec3 = [0.48, 0.26, 0.10];
const BOW_HIGHLIGHT: Vec3 = [0.70, 0.42, 0.18];
const APPLE: Vec3 = [0.71, 0.12, 0.09];
const APPLE_DARK: Vec3 = [0.48, 0.08, 0.06];
const LEAF: Vec3 = [0.25, 0.48, 0.16];
const COOKED_FOOD: Vec3 = [0.52, 0.22, 0.10];
const RAW_FOOD: Vec3 = [0.72, 0.32, 0.28];

interface GeometryWriter {
  readonly color: number[];
  readonly textured: number[];
}

export type FirstPersonActionKind = "mine" | "attack" | "place" | "use";

export type FirstPersonActionPose = Float32Array;

export type FirstPersonRenderStats = [
  colorVertexCount: number,
  texturedVertexCount: number,
  drawCalls: number,
  lastUploadBytes: number,
  totalUploadBytes: number,
  meshUpdates: number,
  bufferCapacityBytes: number,
];

export interface FirstPersonRenderer {
  readonly colorBuffer: WebGLBuffer;
  readonly texturedBuffer: WebGLBuffer;
  readonly stats: FirstPersonRenderStats;
  setHeldItem(itemId: ItemId | null, block: BlockId): void;
  setBowCharge(charging: boolean, progress: number): void;
  triggerAction(kind: FirstPersonActionKind, now: number): void;
  writeMvp(output: Float32Array, projection: Float32Array, now: number, reducedMotion: boolean): Float32Array;
  destroy(): void;
}

function parseHexColor(value: string | undefined): Vec3 {
  if (value && /^#[0-9a-f]{6}$/i.test(value)) {
    return [
      Number.parseInt(value.slice(1, 3), 16) / 255,
      Number.parseInt(value.slice(3, 5), 16) / 255,
      Number.parseInt(value.slice(5, 7), 16) / 255,
    ];
  }
  return [0.53, 0.53, 0.53];
}

function toolHeadColor(itemId: ItemId): Vec3 {
  const tier = ITEMS[itemId].tool?.tier;
  if (tier === "diamond") return [0.20, 0.82, 0.79];
  if (tier === "gold") return [0.94, 0.76, 0.16];
  if (tier === "iron") return [0.76, 0.78, 0.76];
  if (tier === "stone") return [0.43, 0.45, 0.44];
  return [0.58, 0.36, 0.16];
}

function appendTransformedPoint(
  output: number[],
  x: number,
  y: number,
  z: number,
  centerX: number,
  centerY: number,
  centerZ: number,
  rx = 0,
  ry = 0,
  rz = 0,
): void {
  if (rx) {
    const cosine = Math.cos(rx);
    const sine = Math.sin(rx);
    const nextY = y * cosine - z * sine;
    z = y * sine + z * cosine;
    y = nextY;
  }
  if (ry) {
    const cosine = Math.cos(ry);
    const sine = Math.sin(ry);
    const nextX = x * cosine + z * sine;
    z = -x * sine + z * cosine;
    x = nextX;
  }
  if (rz) {
    const cosine = Math.cos(rz);
    const sine = Math.sin(rz);
    const nextX = x * cosine - y * sine;
    y = x * sine + y * cosine;
    x = nextX;
  }
  output.push(x + centerX, y + centerY, z + centerZ);
}

function appendColorBox(
  output: number[],
  center: Vec3,
  size: Vec3,
  color: Vec3,
  rx = 0,
  ry = 0,
  rz = 0,
): void {
  for (const face of CUBE_FACES) {
    for (const point of face[5]) {
      appendTransformedPoint(
        output,
        (point[0] - 0.5) * size[0],
        (point[1] - 0.5) * size[1],
        (point[2] - 0.5) * size[2],
        center[0],
        center[1],
        center[2],
        rx,
        ry,
        rz,
      );
      output.push(
        color[0] * face[4],
        color[1] * face[4],
        color[2] * face[4],
      );
    }
  }
}

function appendSegment(
  output: number[],
  from: readonly [number, number],
  to: readonly [number, number],
  z: number,
  thickness: number,
  depth: number,
  color: Vec3,
): void {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  appendColorBox(
    output,
    [(from[0] + to[0]) * 0.5, (from[1] + to[1]) * 0.5, z],
    [thickness, Math.hypot(dx, dy), depth],
    color,
    0,
    0,
    Math.atan2(-dx, dy),
  );
}

function appendArm(output: number[]): void {
  // A joined 4x4 sleeve and hand prism keeps the familiar lower-right silhouette.
  appendColorBox(output, [0.69, -0.75, -1.24], [0.34, 0.80, 0.34], SLEEVE, -0.08, 0, 0.38);
  appendColorBox(output, [0.49, -0.22, -1.22], [0.34, 0.39, 0.34], SKIN, -0.08, 0, 0.38);
}

function appendTool(output: number[], itemId: ItemId): void {
  const kind = ITEMS[itemId].tool?.kind;
  const head = toolHeadColor(itemId);
  if (kind === "sword") {
    appendColorBox(output, [0.05, 0.24, -1.17], [0.18, 0.88, 0.12], head, 0, -0.16, 0.62);
    appendColorBox(output, [0.27, -0.20, -1.15], [0.48, 0.12, 0.16], head, 0, 0, 0.62);
    appendColorBox(output, [0.43, -0.42, -1.14], [0.12, 0.38, 0.13], HANDLE, 0, 0, 0.62);
    return;
  }
  appendColorBox(output, [0.23, -0.14, -1.16], [0.11, 1.02, 0.11], HANDLE, 0, 0, 0.61);
  if (kind === "pickaxe") {
    appendColorBox(output, [-0.09, 0.30, -1.16], [0.75, 0.16, 0.16], head, 0, 0, -0.04);
    appendColorBox(output, [-0.43, 0.23, -1.16], [0.16, 0.30, 0.16], head, 0, 0, -0.35);
  } else if (kind === "axe") {
    appendColorBox(output, [-0.13, 0.28, -1.16], [0.42, 0.42, 0.18], head, 0, 0, -0.18);
  } else {
    appendColorBox(output, [-0.09, 0.31, -1.16], [0.32, 0.42, 0.16], head, 0, 0, 0.60);
  }
}

function appendFood(output: number[], itemId: ItemId): void {
  if (itemId === "apple") {
    appendColorBox(output, [0.10, -0.02, -1.13], [0.46, 0.42, 0.36], APPLE, 0, -0.24, -0.08);
    appendColorBox(output, [-0.05, 0.17, -1.12], [0.29, 0.20, 0.33], APPLE_DARK, 0, -0.24);
    appendColorBox(output, [0.12, 0.28, -1.13], [0.08, 0.23, 0.08], HANDLE, 0, 0, 0.14);
    appendColorBox(output, [0.23, 0.30, -1.13], [0.20, 0.09, 0.16], LEAF, 0, 0, -0.28);
    return;
  }
  const cooked = itemId.startsWith("cooked_");
  const flesh = itemId === "rotten_flesh" ? [0.34, 0.47, 0.17] as Vec3 : cooked ? COOKED_FOOD : RAW_FOOD;
  appendColorBox(output, [0.08, -0.02, -1.13], [0.55, 0.35, 0.28], flesh, 0, -0.26, -0.16);
  appendColorBox(output, [-0.17, 0.12, -1.12], [0.30, 0.28, 0.30], flesh, 0, -0.26, 0.08);
  appendColorBox(output, [0.33, -0.12, -1.12], [0.32, 0.10, 0.12], [0.82, 0.72, 0.57], 0, 0, -0.16);
}

function appendBow(output: number[], chargeStage: 0 | 1 | 2, charging: boolean): void {
  const points = [[0.52,-0.67],[0.65,-0.34],[0.60,0],[0.65,0.34],[0.52,0.67]] as const;
  for (let index = 0; index < points.length - 1; index += 1) {
    appendSegment(output, points[index], points[index + 1], -1.30, 0.105, 0.13, index === 1 || index === 2 ? BOW_HIGHLIGHT : BOW);
  }
  const nockX = 0.43 - chargeStage * 0.17;
  appendSegment(output, points[0], [nockX, 0], -1.29, 0.025, 0.035, STRING);
  appendSegment(output, [nockX, 0], points[4], -1.29, 0.025, 0.035, STRING);
  if (!charging) return;
  appendSegment(output, [-0.72, 0], [nockX + 0.06, 0], -1.27, 0.045, 0.045, ARROW);
  appendColorBox(output, [-0.76, 0, -1.27], [0.16, 0.15, 0.11], ARROWHEAD, 0, 0, Math.PI / 4);
  appendColorBox(output, [nockX + 0.03, 0.07, -1.27], [0.18, 0.08, 0.06], FLETCHING, 0, 0, -0.45);
  appendColorBox(output, [nockX + 0.03, -0.07, -1.27], [0.18, 0.08, 0.06], FLETCHING, 0, 0, 0.45);
}

function appendSpecialBlock(output: number[], itemId: ItemId): void {
  const color = parseHexColor(ITEMS[itemId].color);
  if (itemId === "torch") {
    appendColorBox(output, [0.12, -0.06, -1.16], [0.12, 0.72, 0.12], HANDLE, 0, 0, 0.22);
    appendColorBox(output, [0.03, 0.31, -1.16], [0.21, 0.22, 0.21], [0.95, 0.62, 0.16], 0, 0, 0.22);
    return;
  }
  if (itemId === "door" || itemId === "bed" || itemId === "ladder" || itemId === "stone_brick_slab") {
    appendColorBox(output, [0.09, -0.04, -1.20], itemId === "door" ? [0.55, 0.92, 0.12] : [0.68, 0.36, 0.18], color, -0.18, -0.38, -0.10);
    return;
  }
  if (itemId === "oak_fence" || itemId === "oak_fence_gate" || itemId === "sapling") {
    appendColorBox(output, [0.08, -0.05, -1.18], [0.16, 0.75, 0.16], color, 0, 0, 0.08);
    appendColorBox(output, [0.08, 0.16, -1.18], [0.62, 0.12, 0.14], color, 0, 0, -0.08);
    appendColorBox(output, [0.08, -0.14, -1.18], [0.56, 0.11, 0.14], color, 0, 0, 0.08);
    return;
  }
  appendColorBox(output, [0.08, -0.04, -1.18], [0.54, 0.54, 0.42], color, -0.28, -0.50);
}

function appendMaterial(output: number[], itemId: ItemId): void {
  const color = parseHexColor(ITEMS[itemId].color);
  appendColorBox(output, [0.08, -0.02, -1.16], [0.38, 0.52, 0.24], color, -0.28, -0.46, 0.40);
  appendColorBox(output, [-0.03, 0.13, -1.14], [0.24, 0.27, 0.26], color, 0.24, 0.38, -0.22);
}

function canUseCanonicalCube(block: BlockId): boolean {
  return block !== BLOCK.AIR && CUBE_FACES.every((face) => blockTextureForFace(block, face[0]) !== null);
}

function appendTexturedCube(output: number[], block: BlockId): void {
  const size = 0.72;
  for (const face of CUBE_FACES) {
    const texture = blockTextureForFace(block, face[0]);
    if (!texture) continue;
    const uv = textureAtlasUv(texture);
    for (const point of face[5]) {
      // Match appendTexturedBlockFace exactly: X-facing sides use Z as
      // horizontal, horizontal faces use Z as vertical, and all other axes use
      // their natural X/Y coordinates. Directional atlas tiles therefore keep
      // the same orientation in-world and in-hand.
      const horizontal = face[1] !== 0 ? point[2] : point[0];
      const vertical = face[2] !== 0 ? point[2] : point[1];
      appendTransformedPoint(
        output,
        (point[0] - 0.5) * size,
        (point[1] - 0.5) * size,
        (point[2] - 0.5) * size,
        0.08,
        -0.04,
        -1.32,
        -0.38,
        -0.55,
        -0.06,
      );
      output.push(
        uv.left + (uv.right - uv.left) * horizontal,
        uv.bottom + (uv.top - uv.bottom) * vertical,
        face[4],
      );
    }
  }
}

export function firstPersonBufferCapacity(): {
  colorVertexCount: number;
  texturedVertexCount: number;
  totalBytes: number;
} {
  const colorBytes = FIRST_PERSON_MAX_COLOR_VERTICES * FLOATS_PER_COLOR_VERTEX * Float32Array.BYTES_PER_ELEMENT;
  const texturedBytes = FIRST_PERSON_MAX_TEXTURED_VERTICES * TEXTURED_WORLD_VERTEX_FLOATS * Float32Array.BYTES_PER_ELEMENT;
  return {
    colorVertexCount: FIRST_PERSON_MAX_COLOR_VERTICES,
    texturedVertexCount: FIRST_PERSON_MAX_TEXTURED_VERTICES,
    totalBytes: colorBytes + texturedBytes,
  };
}

export function firstPersonBowChargeStage(charging: boolean, progress: number): 0 | 1 | 2 {
  if (!charging || !Number.isFinite(progress) || progress < 0.55) return 0;
  return progress >= 0.9 ? 2 : 1;
}

export function sampleFirstPersonAction(
  output: FirstPersonActionPose,
  kind: FirstPersonActionKind,
  elapsedMs: number,
  foodHeld: boolean,
  reducedMotion: boolean,
): FirstPersonActionPose {
  output.fill(0);
  if (reducedMotion || !Number.isFinite(elapsedMs) || elapsedMs < 0 || elapsedMs >= FIRST_PERSON_ACTION_MS) return output;
  const progress = elapsedMs / FIRST_PERSON_ACTION_MS;
  const arc = Math.sin(Math.PI * progress);
  if (kind === "use" && foodHeld) {
    output[0] = -0.30 * arc;
    output[1] = 0.36 * arc;
    output[2] = 0.15 * arc;
    output[3] = -0.12 * arc;
    output[4] = -0.20 * arc;
    return output;
  }
  output[0] = -0.42 * arc;
  output[1] = -0.16 * arc;
  output[2] = 0.05 * arc;
  output[3] = 0.18 * arc;
  output[4] = -0.62 * arc;
  return output;
}

function writeModelMatrix(output: Float32Array, pose: FirstPersonActionPose): Float32Array {
  const cx = Math.cos(pose[3]);
  const sx = Math.sin(pose[3]);
  const cz = Math.cos(pose[4]);
  const sz = Math.sin(pose[4]);
  const pivotX = 0.66;
  const pivotY = -0.82;
  const pivotZ = -1.20;
  output[0] = cz; output[1] = sz; output[2] = 0; output[3] = 0;
  output[4] = -sz * cx; output[5] = cz * cx; output[6] = sx; output[7] = 0;
  output[8] = sz * sx; output[9] = -cz * sx; output[10] = cx; output[11] = 0;
  output[12] = pivotX + pose[0] - (output[0] * pivotX + output[4] * pivotY + output[8] * pivotZ);
  output[13] = pivotY + pose[1] - (output[1] * pivotX + output[5] * pivotY + output[9] * pivotZ);
  output[14] = pivotZ + pose[2] - (output[2] * pivotX + output[6] * pivotY + output[10] * pivotZ);
  output[15] = 1;
  return output;
}

export function createFirstPersonRenderer(gl: WebGLRenderingContext): FirstPersonRenderer {
  const colorBuffer = gl.createBuffer();
  const texturedBuffer = gl.createBuffer();
  if (!colorBuffer || !texturedBuffer) throw new Error("Unable to allocate the first-person model buffers.");
  const capacity = firstPersonBufferCapacity();
  gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    capacity.colorVertexCount * FLOATS_PER_COLOR_VERTEX * Float32Array.BYTES_PER_ELEMENT,
    gl.DYNAMIC_DRAW,
  );
  gl.bindBuffer(gl.ARRAY_BUFFER, texturedBuffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    capacity.texturedVertexCount * TEXTURED_WORLD_VERTEX_FLOATS * Float32Array.BYTES_PER_ELEMENT,
    gl.DYNAMIC_DRAW,
  );

  let itemId: ItemId | null = null;
  let block = BLOCK.AIR as BlockId;
  let charging = false;
  let chargeStage: 0 | 1 | 2 = 0;
  let actionKind: FirstPersonActionKind = "use";
  let actionStartedAt = -Infinity;
  const actionPose: FirstPersonActionPose = new Float32Array(5);
  const modelMatrix = new Float32Array(16);
  const stats: FirstPersonRenderStats = [0, 0, 0, 0, 0, 0, capacity.totalBytes];

  function rebuild(): void {
    const geometry: GeometryWriter = { color: [], textured: [] };
    if (itemId && ITEMS[itemId].category === "block" && canUseCanonicalCube(block)) {
      appendTexturedCube(geometry.textured, block);
    } else if (itemId === "bow") {
      appendBow(geometry.color, chargeStage, charging);
    } else if (itemId && ITEMS[itemId].tool) {
      appendTool(geometry.color, itemId);
    } else if (itemId && ITEMS[itemId].category === "food") {
      appendFood(geometry.color, itemId);
    } else if (itemId && ITEMS[itemId].category === "block") {
      appendSpecialBlock(geometry.color, itemId);
    } else if (itemId) {
      appendMaterial(geometry.color, itemId);
    }
    appendArm(geometry.color);
    if (geometry.color.length > FIRST_PERSON_MAX_COLOR_VERTICES * FLOATS_PER_COLOR_VERTEX
      || geometry.textured.length > FIRST_PERSON_MAX_TEXTURED_VERTICES * TEXTURED_WORLD_VERTEX_FLOATS) {
      throw new Error("First-person model exceeded its fixed geometry budget.");
    }
    const colorData = new Float32Array(geometry.color);
    const texturedData = new Float32Array(geometry.textured);
    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
    if (colorData.length) gl.bufferSubData(gl.ARRAY_BUFFER, 0, colorData);
    gl.bindBuffer(gl.ARRAY_BUFFER, texturedBuffer);
    if (texturedData.length) gl.bufferSubData(gl.ARRAY_BUFFER, 0, texturedData);
    stats[0] = colorData.length / FLOATS_PER_COLOR_VERTEX;
    stats[1] = texturedData.length / TEXTURED_WORLD_VERTEX_FLOATS;
    stats[2] = Number(stats[0] > 0) + Number(stats[1] > 0);
    stats[3] = colorData.byteLength + texturedData.byteLength;
    stats[4] += stats[3];
    stats[5] += 1;
  }

  rebuild();
  return {
    colorBuffer,
    texturedBuffer,
    stats,
    setHeldItem(nextItemId, nextBlock) {
      if (itemId === nextItemId && block === nextBlock) return;
      itemId = nextItemId;
      block = nextBlock;
      charging = false;
      chargeStage = 0;
      actionStartedAt = -Infinity;
      rebuild();
    },
    setBowCharge(nextCharging, progress) {
      const nextStage = firstPersonBowChargeStage(nextCharging, progress);
      if (charging === nextCharging && chargeStage === nextStage) return;
      charging = nextCharging;
      chargeStage = nextStage;
      if (itemId === "bow") rebuild();
    },
    triggerAction(kind, now) {
      actionKind = kind;
      actionStartedAt = Number.isFinite(now) ? now : 0;
    },
    writeMvp(output, projection, now, reducedMotion) {
      sampleFirstPersonAction(
        actionPose,
        actionKind,
        now - actionStartedAt,
        Boolean(itemId && ITEMS[itemId].category === "food"),
        reducedMotion,
      );
      writeModelMatrix(modelMatrix, actionPose);
      return writeMatrixProduct(output, projection, modelMatrix);
    },
    destroy() {
      gl.deleteBuffer(colorBuffer);
      gl.deleteBuffer(texturedBuffer);
    },
  };
}
