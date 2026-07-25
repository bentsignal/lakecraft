import { ITEMS, type ItemId } from "../../shared/game.ts";
import { TEXTURED_WORLD_VERTEX_FLOATS, blockTextureForFace, textureAtlasUv, type BlockFace } from "./blockTextures.ts";
import { BLOCK, type BlockId } from "./types.ts";

type Vec3 = readonly [number, number, number];

const FLOATS_PER_COLOR_VERTEX = 6;
const VERTICES_PER_BOX = 36;
export const FIRST_PERSON_MAX_COLOR_BOXES = 18;
export const FIRST_PERSON_MAX_COLOR_VERTICES = FIRST_PERSON_MAX_COLOR_BOXES * VERTICES_PER_BOX;
export const FIRST_PERSON_MAX_TEXTURED_VERTICES = 36;
export const FIRST_PERSON_ACTION_MS = 220;

const BOX_FACES: ReadonlyArray<{ shade: number; vertices: ReadonlyArray<Vec3> }> = [
  { shade: 0.79, vertices: [[1,0,0],[1,1,0],[1,1,1],[1,0,0],[1,1,1],[1,0,1]] },
  { shade: 0.68, vertices: [[0,0,1],[0,1,1],[0,1,0],[0,0,1],[0,1,0],[0,0,0]] },
  { shade: 1, vertices: [[0,1,0],[0,1,1],[1,1,1],[0,1,0],[1,1,1],[1,1,0]] },
  { shade: 0.52, vertices: [[0,0,1],[0,0,0],[1,0,0],[0,0,1],[1,0,0],[1,0,1]] },
  { shade: 0.88, vertices: [[1,0,1],[1,1,1],[0,1,1],[1,0,1],[0,1,1],[0,0,1]] },
  { shade: 0.73, vertices: [[0,0,0],[0,1,0],[1,1,0],[0,0,0],[1,1,0],[1,0,0]] },
];

const TEXTURED_FACES: ReadonlyArray<{
  face: BlockFace;
  shade: number;
  vertices: ReadonlyArray<Vec3>;
}> = [
  { face: "east", shade: 0.79, vertices: BOX_FACES[0].vertices },
  { face: "west", shade: 0.68, vertices: BOX_FACES[1].vertices },
  { face: "top", shade: 1, vertices: BOX_FACES[2].vertices },
  { face: "bottom", shade: 0.52, vertices: BOX_FACES[3].vertices },
  { face: "south", shade: 0.88, vertices: BOX_FACES[4].vertices },
  { face: "north", shade: 0.73, vertices: BOX_FACES[5].vertices },
];

const COLORS = {
  skin: [0.74, 0.50, 0.34] as Vec3,
  sleeve: [0.05, 0.54, 0.56] as Vec3,
  handle: [0.43, 0.27, 0.11] as Vec3,
  string: [0.87, 0.85, 0.78] as Vec3,
  arrow: [0.48, 0.29, 0.12] as Vec3,
  arrowhead: [0.68, 0.70, 0.68] as Vec3,
  fletching: [0.91, 0.88, 0.80] as Vec3,
  bow: [0.48, 0.26, 0.10] as Vec3,
  bowHighlight: [0.70, 0.42, 0.18] as Vec3,
  apple: [0.71, 0.12, 0.09] as Vec3,
  appleDark: [0.48, 0.08, 0.06] as Vec3,
  leaf: [0.25, 0.48, 0.16] as Vec3,
  cookedFood: [0.52, 0.22, 0.10] as Vec3,
  rawFood: [0.72, 0.32, 0.28] as Vec3,
};

interface Transform {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly rx?: number;
  readonly ry?: number;
  readonly rz?: number;
}

interface GeometryWriter {
  readonly color: number[];
  readonly textured: number[];
}

export type FirstPersonActionKind = "mine" | "attack" | "place" | "use";

export interface FirstPersonActionPose {
  readonly translateX: number;
  readonly translateY: number;
  readonly translateZ: number;
  readonly rotateX: number;
  readonly rotateZ: number;
}

export interface FirstPersonRenderStats {
  colorVertexCount: number;
  texturedVertexCount: number;
  drawCalls: number;
  lastUploadBytes: number;
  totalUploadBytes: number;
  meshUpdates: number;
  bufferCapacityBytes: number;
}

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

function transformPoint(point: Vec3, transform: Transform): Vec3 {
  let x = point[0];
  let y = point[1];
  let z = point[2];
  if (transform.rx) {
    const cosine = Math.cos(transform.rx);
    const sine = Math.sin(transform.rx);
    const nextY = y * cosine - z * sine;
    z = y * sine + z * cosine;
    y = nextY;
  }
  if (transform.ry) {
    const cosine = Math.cos(transform.ry);
    const sine = Math.sin(transform.ry);
    const nextX = x * cosine + z * sine;
    z = -x * sine + z * cosine;
    x = nextX;
  }
  if (transform.rz) {
    const cosine = Math.cos(transform.rz);
    const sine = Math.sin(transform.rz);
    const nextX = x * cosine - y * sine;
    y = x * sine + y * cosine;
    x = nextX;
  }
  return [x + transform.x, y + transform.y, z + transform.z];
}

function appendColorBox(
  output: number[],
  center: Vec3,
  size: Vec3,
  color: Vec3,
  rotation: Pick<Transform, "rx" | "ry" | "rz"> = {},
): void {
  const transform: Transform = { x: center[0], y: center[1], z: center[2], ...rotation };
  for (const face of BOX_FACES) {
    for (const point of face.vertices) {
      const transformed = transformPoint([
        (point[0] - 0.5) * size[0],
        (point[1] - 0.5) * size[1],
        (point[2] - 0.5) * size[2],
      ], transform);
      output.push(
        transformed[0],
        transformed[1],
        transformed[2],
        color[0] * face.shade,
        color[1] * face.shade,
        color[2] * face.shade,
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
    { rz: Math.atan2(-dx, dy) },
  );
}

function appendArm(output: number[]): void {
  // A joined 4x4 sleeve and hand prism keeps the familiar lower-right silhouette.
  appendColorBox(output, [0.69, -0.75, -1.24], [0.34, 0.80, 0.34], COLORS.sleeve, { rx: -0.08, rz: 0.38 });
  appendColorBox(output, [0.49, -0.22, -1.22], [0.34, 0.39, 0.34], COLORS.skin, { rx: -0.08, rz: 0.38 });
}

function appendTool(output: number[], itemId: ItemId): void {
  const kind = ITEMS[itemId].tool?.kind;
  const head = toolHeadColor(itemId);
  if (kind === "sword") {
    appendColorBox(output, [0.05, 0.24, -1.17], [0.18, 0.88, 0.12], head, { ry: -0.16, rz: 0.62 });
    appendColorBox(output, [0.27, -0.20, -1.15], [0.48, 0.12, 0.16], head, { rz: 0.62 });
    appendColorBox(output, [0.43, -0.42, -1.14], [0.12, 0.38, 0.13], COLORS.handle, { rz: 0.62 });
    return;
  }
  appendColorBox(output, [0.23, -0.14, -1.16], [0.11, 1.02, 0.11], COLORS.handle, { rz: 0.61 });
  if (kind === "pickaxe") {
    appendColorBox(output, [-0.09, 0.30, -1.16], [0.75, 0.16, 0.16], head, { rz: -0.04 });
    appendColorBox(output, [-0.43, 0.23, -1.16], [0.16, 0.30, 0.16], head, { rz: -0.35 });
  } else if (kind === "axe") {
    appendColorBox(output, [-0.13, 0.28, -1.16], [0.42, 0.42, 0.18], head, { rz: -0.18 });
  } else {
    appendColorBox(output, [-0.09, 0.31, -1.16], [0.32, 0.42, 0.16], head, { rz: 0.60 });
  }
}

function appendFood(output: number[], itemId: ItemId): void {
  if (itemId === "apple") {
    appendColorBox(output, [0.10, -0.02, -1.13], [0.46, 0.42, 0.36], COLORS.apple, { ry: -0.24, rz: -0.08 });
    appendColorBox(output, [-0.05, 0.17, -1.12], [0.29, 0.20, 0.33], COLORS.appleDark, { ry: -0.24 });
    appendColorBox(output, [0.12, 0.28, -1.13], [0.08, 0.23, 0.08], COLORS.handle, { rz: 0.14 });
    appendColorBox(output, [0.23, 0.30, -1.13], [0.20, 0.09, 0.16], COLORS.leaf, { rz: -0.28 });
    return;
  }
  const cooked = itemId.startsWith("cooked_");
  const flesh = itemId === "rotten_flesh" ? [0.34, 0.47, 0.17] as Vec3 : cooked ? COLORS.cookedFood : COLORS.rawFood;
  appendColorBox(output, [0.08, -0.02, -1.13], [0.55, 0.35, 0.28], flesh, { ry: -0.26, rz: -0.16 });
  appendColorBox(output, [-0.17, 0.12, -1.12], [0.30, 0.28, 0.30], flesh, { ry: -0.26, rz: 0.08 });
  appendColorBox(output, [0.33, -0.12, -1.12], [0.32, 0.10, 0.12], [0.82, 0.72, 0.57], { rz: -0.16 });
}

function appendBow(output: number[], chargeStage: 0 | 1 | 2, charging: boolean): void {
  const points = [[0.52,-0.67],[0.65,-0.34],[0.60,0],[0.65,0.34],[0.52,0.67]] as const;
  for (let index = 0; index < points.length - 1; index += 1) {
    appendSegment(output, points[index], points[index + 1], -1.30, 0.105, 0.13, index === 1 || index === 2 ? COLORS.bowHighlight : COLORS.bow);
  }
  const nockX = 0.43 - chargeStage * 0.17;
  appendSegment(output, points[0], [nockX, 0], -1.29, 0.025, 0.035, COLORS.string);
  appendSegment(output, [nockX, 0], points[4], -1.29, 0.025, 0.035, COLORS.string);
  if (!charging) return;
  appendSegment(output, [-0.72, 0], [nockX + 0.06, 0], -1.27, 0.045, 0.045, COLORS.arrow);
  appendColorBox(output, [-0.76, 0, -1.27], [0.16, 0.15, 0.11], COLORS.arrowhead, { rz: Math.PI / 4 });
  appendColorBox(output, [nockX + 0.03, 0.07, -1.27], [0.18, 0.08, 0.06], COLORS.fletching, { rz: -0.45 });
  appendColorBox(output, [nockX + 0.03, -0.07, -1.27], [0.18, 0.08, 0.06], COLORS.fletching, { rz: 0.45 });
}

function appendSpecialBlock(output: number[], itemId: ItemId): void {
  const color = parseHexColor(ITEMS[itemId].color);
  if (itemId === "torch") {
    appendColorBox(output, [0.12, -0.06, -1.16], [0.12, 0.72, 0.12], COLORS.handle, { rz: 0.22 });
    appendColorBox(output, [0.03, 0.31, -1.16], [0.21, 0.22, 0.21], [0.95, 0.62, 0.16], { rz: 0.22 });
    return;
  }
  if (itemId === "door" || itemId === "bed" || itemId === "ladder" || itemId === "stone_brick_slab") {
    appendColorBox(output, [0.09, -0.04, -1.20], itemId === "door" ? [0.55, 0.92, 0.12] : [0.68, 0.36, 0.18], color, { rx: -0.18, ry: -0.38, rz: -0.10 });
    return;
  }
  if (itemId === "oak_fence" || itemId === "oak_fence_gate" || itemId === "sapling") {
    appendColorBox(output, [0.08, -0.05, -1.18], [0.16, 0.75, 0.16], color, { rz: 0.08 });
    appendColorBox(output, [0.08, 0.16, -1.18], [0.62, 0.12, 0.14], color, { rz: -0.08 });
    appendColorBox(output, [0.08, -0.14, -1.18], [0.56, 0.11, 0.14], color, { rz: 0.08 });
    return;
  }
  appendColorBox(output, [0.08, -0.04, -1.18], [0.54, 0.54, 0.42], color, { rx: -0.28, ry: -0.50 });
}

function appendMaterial(output: number[], itemId: ItemId): void {
  const color = parseHexColor(ITEMS[itemId].color);
  appendColorBox(output, [0.08, -0.02, -1.16], [0.38, 0.52, 0.24], color, { rx: -0.28, ry: -0.46, rz: 0.40 });
  appendColorBox(output, [-0.03, 0.13, -1.14], [0.24, 0.27, 0.26], color, { rx: 0.24, ry: 0.38, rz: -0.22 });
}

function canUseCanonicalCube(block: BlockId): boolean {
  return block !== BLOCK.AIR && TEXTURED_FACES.every(({ face }) => blockTextureForFace(block, face) !== null);
}

function appendTexturedCube(output: number[], block: BlockId): void {
  const transform: Transform = { x: 0.08, y: -0.04, z: -1.32, rx: -0.38, ry: -0.55, rz: -0.06 };
  const size = 0.72;
  for (const face of TEXTURED_FACES) {
    const texture = blockTextureForFace(block, face.face);
    if (!texture) continue;
    const uv = textureAtlasUv(texture);
    const faceUv = [
      [uv.right, uv.bottom], [uv.right, uv.top], [uv.left, uv.top],
      [uv.right, uv.bottom], [uv.left, uv.top], [uv.left, uv.bottom],
    ] as const;
    for (let index = 0; index < face.vertices.length; index += 1) {
      const point = face.vertices[index];
      const transformed = transformPoint([
        (point[0] - 0.5) * size,
        (point[1] - 0.5) * size,
        (point[2] - 0.5) * size,
      ], transform);
      output.push(transformed[0], transformed[1], transformed[2], faceUv[index][0], faceUv[index][1], face.shade);
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
  kind: FirstPersonActionKind,
  elapsedMs: number,
  foodHeld: boolean,
  reducedMotion: boolean,
): FirstPersonActionPose {
  const idle: FirstPersonActionPose = {
    translateX: 0, translateY: 0, translateZ: 0, rotateX: 0, rotateZ: 0,
  };
  if (reducedMotion || !Number.isFinite(elapsedMs) || elapsedMs < 0 || elapsedMs >= FIRST_PERSON_ACTION_MS) return idle;
  const progress = elapsedMs / FIRST_PERSON_ACTION_MS;
  const arc = Math.sin(Math.PI * progress);
  if (kind === "use" && foodHeld) {
    return {
      translateX: -0.30 * arc,
      translateY: 0.36 * arc,
      translateZ: 0.15 * arc,
      rotateX: -0.12 * arc,
      rotateZ: -0.20 * arc,
    };
  }
  return {
    translateX: -0.42 * arc,
    translateY: -0.16 * arc,
    translateZ: 0.05 * arc,
    rotateX: 0.18 * arc,
    rotateZ: -0.62 * arc,
  };
}

function writeModelMatrix(output: Float32Array, pose: FirstPersonActionPose): Float32Array {
  const cx = Math.cos(pose.rotateX);
  const sx = Math.sin(pose.rotateX);
  const cz = Math.cos(pose.rotateZ);
  const sz = Math.sin(pose.rotateZ);
  const pivotX = 0.66;
  const pivotY = -0.82;
  const pivotZ = -1.20;
  output[0] = cz; output[1] = sz; output[2] = 0; output[3] = 0;
  output[4] = -sz * cx; output[5] = cz * cx; output[6] = sx; output[7] = 0;
  output[8] = sz * sx; output[9] = -cz * sx; output[10] = cx; output[11] = 0;
  output[12] = pivotX + pose.translateX - (output[0] * pivotX + output[4] * pivotY + output[8] * pivotZ);
  output[13] = pivotY + pose.translateY - (output[1] * pivotX + output[5] * pivotY + output[9] * pivotZ);
  output[14] = pivotZ + pose.translateZ - (output[2] * pivotX + output[6] * pivotY + output[10] * pivotZ);
  output[15] = 1;
  return output;
}

function writeMatrixProduct(output: Float32Array, left: Float32Array, right: Float32Array): Float32Array {
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      output[column * 4 + row] =
        left[row] * right[column * 4]
        + left[4 + row] * right[column * 4 + 1]
        + left[8 + row] * right[column * 4 + 2]
        + left[12 + row] * right[column * 4 + 3];
    }
  }
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
  const modelMatrix = new Float32Array(16);
  const stats: FirstPersonRenderStats = {
    colorVertexCount: 0,
    texturedVertexCount: 0,
    drawCalls: 0,
    lastUploadBytes: 0,
    totalUploadBytes: 0,
    meshUpdates: 0,
    bufferCapacityBytes: capacity.totalBytes,
  };

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
    stats.colorVertexCount = colorData.length / FLOATS_PER_COLOR_VERTEX;
    stats.texturedVertexCount = texturedData.length / TEXTURED_WORLD_VERTEX_FLOATS;
    stats.drawCalls = Number(stats.colorVertexCount > 0) + Number(stats.texturedVertexCount > 0);
    stats.lastUploadBytes = colorData.byteLength + texturedData.byteLength;
    stats.totalUploadBytes += stats.lastUploadBytes;
    stats.meshUpdates += 1;
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
      const pose = sampleFirstPersonAction(
        actionKind,
        now - actionStartedAt,
        Boolean(itemId && ITEMS[itemId].category === "food"),
        reducedMotion,
      );
      writeModelMatrix(modelMatrix, pose);
      return writeMatrixProduct(output, projection, modelMatrix);
    },
    destroy() {
      gl.deleteBuffer(colorBuffer);
      gl.deleteBuffer(texturedBuffer);
    },
  };
}
