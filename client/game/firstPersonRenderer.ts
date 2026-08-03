import { ITEMS, type ItemId } from "../../shared/game.ts";
import { TEXTURED_WORLD_VERTEX_FLOATS, blockTextureForFace, textureAtlasUv } from "./blockTextures.ts";
import { CUBE_FACES } from "./cubeFaces.ts";
import { writeMatrixProduct } from "./matrixProduct.ts";
import { BLOCK, type BlockId } from "./types.ts";

type Vec3 = readonly [number, number, number];

const FLOATS_PER_COLOR_VERTEX = 6;
export const FIRST_PERSON_MAX_COLOR_VERTICES = 648;
export const FIRST_PERSON_MAX_TEXTURED_VERTICES = 36;
export const FIRST_PERSON_ACTION_MS = 220;
export const FIRST_PERSON_MODEL_SCALE = 0.48;
export const FIRST_PERSON_MODEL_PIVOT: readonly [number, number, number] = [0.66, -0.82, -1.20];
/** Camera-space authored poses; action motion still pivots through the shared wrist rig below. */
export const FIRST_PERSON_CUBE_ROTATION: readonly [number, number, number] = [0.50, -0.66, 0.04];
// This authored point resolves to camera-space (0, 0) after the shared wrist
// scale/pivot, so the visual arrow converges on the unchanged shot crosshair.
export const FIRST_PERSON_BOW_ARROW_TIP: readonly [number, number, number] = [-0.72, 0.89, -1.70];

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

type GeometryWriter = [color: number[], textured: number[]];

export type FirstPersonActionKind = "mine" | "attack" | "place" | "use";

export type FirstPersonActionPose = number[];

export type FirstPersonRenderStats = [
  colorVertexCount: number,
  texturedVertexCount: number,
  drawCalls: number,
  lastUploadBytes: number,
  totalUploadBytes: number,
  meshUpdates: number,
  bufferCapacityBytes: number,
];

export type FirstPersonRenderer = readonly [
  colorBuffer: WebGLBuffer,
  texturedBuffer: WebGLBuffer,
  stats: FirstPersonRenderStats,
  setHeldItem: (itemId: ItemId | null, block: BlockId) => void,
  setBowCharge: (charging: boolean, progress: number) => void,
  triggerAction: (kind: FirstPersonActionKind, now: number) => void,
  writeMvp: (output: Float32Array, projection: Float32Array, now: number, reducedMotion: boolean) => Float32Array,
  destroy: () => void,
];

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
  rx: number,
  ry: number,
  rz: number,
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
  // The handle runs from the lower-right grip toward the upper-left head while
  // pitching back into the scene. Giving the whole silhouette real depth keeps
  // axes and picks recognizable instead of presenting a flat sideways glyph.
  appendColorBox(output, [0.14, -0.18, -1.12], [0.12, 1.10, 0.12], HANDLE, -0.22, -0.26, 0.62);
  if (kind === "pickaxe") {
    appendColorBox(output, [-0.17, 0.30, -1.24], [0.78, 0.16, 0.18], head, -0.12, -0.24, -0.06);
    appendColorBox(output, [-0.52, 0.22, -1.18], [0.17, 0.31, 0.18], head, -0.12, -0.24, -0.36);
  } else if (kind === "axe") {
    appendColorBox(output, [-0.13, 0.31, -1.24], [0.42, 0.17, 0.19], head, -0.14, -0.28, -0.10);
    appendColorBox(output, [-0.34, 0.22, -1.20], [0.24, 0.38, 0.21], head, -0.14, -0.28, -0.22);
  } else {
    appendColorBox(output, [-0.15, 0.30, -1.22], [0.33, 0.43, 0.18], head, -0.13, -0.26, 0.58);
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
  // A tall right-side bow follows the vanilla screen-space silhouette. The
  // arrow itself advances through Z toward the crosshair instead of lying flat
  // across X, which previously made a correctly aimed shot look sideways.
  const points = [[0.28,-0.78],[0.50,-0.40],[0.56,0],[0.50,0.40],[0.28,0.78]] as const;
  for (let index = 0; index < points.length - 1; index += 1) {
    appendSegment(output, points[index], points[index + 1], -1.12, 0.105, 0.13, index === 1 || index === 2 ? BOW_HIGHLIGHT : BOW);
  }
  const nockX = 0.26 - chargeStage * 0.10;
  appendSegment(output, points[0], [nockX, 0], -1.11, 0.025, 0.035, STRING);
  appendSegment(output, [nockX, 0], points[4], -1.11, 0.025, 0.035, STRING);
  if (!charging) return;
  const arrowCenterX = (FIRST_PERSON_BOW_ARROW_TIP[0] + nockX) * 0.5;
  const arrowCenterY = FIRST_PERSON_BOW_ARROW_TIP[1] * 0.5;
  const arrowCenterZ = (FIRST_PERSON_BOW_ARROW_TIP[2] - 1.11) * 0.5;
  const arrowDx = nockX - FIRST_PERSON_BOW_ARROW_TIP[0];
  const arrowDy = -FIRST_PERSON_BOW_ARROW_TIP[1];
  const arrowDz = -1.11 - FIRST_PERSON_BOW_ARROW_TIP[2];
  const arrowLength = Math.hypot(arrowDx, arrowDy, arrowDz);
  appendColorBox(
    output,
    [arrowCenterX, arrowCenterY, arrowCenterZ],
    [0.045, 0.045, arrowLength],
    ARROW,
    Math.asin(-arrowDy / arrowLength),
    Math.atan2(arrowDx, arrowDz),
  );
  appendColorBox(output, FIRST_PERSON_BOW_ARROW_TIP, [0.12, 0.12, 0.10], ARROWHEAD, 0, 0, Math.PI / 4);
  appendColorBox(output, [nockX, 0.07, -1.11], [0.18, 0.08, 0.06], FLETCHING, 0, 0, -0.45);
  appendColorBox(output, [nockX, -0.07, -1.11], [0.18, 0.08, 0.06], FLETCHING, 0, 0, 0.45);
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
  // Every special-shape block resolves every face to null; one side therefore
  // distinguishes the full atlas cubes without rebuilding a six-face probe.
  return block !== BLOCK.AIR && blockTextureForFace(block, "east") !== null;
}

function appendTexturedCube(output: number[], block: BlockId): void {
  const size = 0.64;
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
        0.14,
        -0.10,
        -1.36,
        FIRST_PERSON_CUBE_ROTATION[0],
        FIRST_PERSON_CUBE_ROTATION[1],
        FIRST_PERSON_CUBE_ROTATION[2],
      );
      output.push(
        uv.left + (uv.right - uv.left) * horizontal,
        uv.bottom + (uv.top - uv.bottom) * vertical,
        face[4],
      );
    }
  }
}

export function firstPersonBufferCapacity(): readonly [
  colorVertexCount: number,
  texturedVertexCount: number,
  totalBytes: number,
] {
  // 648 color vertices + 36 textured vertices, both six float32 values wide.
  return [FIRST_PERSON_MAX_COLOR_VERTICES, FIRST_PERSON_MAX_TEXTURED_VERTICES, 16_416];
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
  // Follow the vanilla first-person cadence: the horizontal/roll sweep uses
  // sqrt(progress), the vertical bob completes a full wave, and depth follows
  // the direct half-wave. Lakecraft's authored mesh is already in camera space,
  // so smaller rotations preserve the same silhouette without pushing it
  // through the near plane. Positive Z is intentional in this right-handed
  // basis: it counters the baked clockwise item lean on screen.
  const rooted = Math.sqrt(progress);
  const sweep = Math.sin(Math.PI * rooted);
  const bob = Math.sin(Math.PI * 2 * rooted);
  const depth = Math.sin(Math.PI * progress);
  const turn = Math.sin(Math.PI * progress * progress);
  const amount = kind === "place" ? 0.72 : kind === "use" ? 0.55 : 1;
  output[0] = -0.08 * sweep * amount;
  output[1] = 0.05 * bob * amount;
  output[2] = -0.08 * depth * amount;
  output[3] = -0.52 * sweep * amount;
  output[4] = -0.16 * turn * amount;
  output[5] = 0.24 * sweep * amount;
  return output;
}

export function writeFirstPersonModelMatrix(
  output: Float32Array,
  pose: Readonly<FirstPersonActionPose>,
): Float32Array {
  const cx = Math.cos(pose[3]);
  const sx = Math.sin(pose[3]);
  const cy = Math.cos(pose[4]);
  const sy = Math.sin(pose[4]);
  const cz = Math.cos(pose[5] ?? 0);
  const sz = Math.sin(pose[5] ?? 0);
  const [pivotX, pivotY, pivotZ] = FIRST_PERSON_MODEL_PIVOT;
  const scale = FIRST_PERSON_MODEL_SCALE;
  // Rz * Ry * Rx keeps the authored local X/Y/Z rotation order. Scale and
  // action rotations share the wrist pivot, so the sleeve base stays planted
  // while the held item leads the arc instead of the arm orbiting the block.
  output[0] = cz * cy * scale; output[1] = sz * cy * scale; output[2] = -sy * scale; output[3] = 0;
  output[4] = (cz * sy * sx - sz * cx) * scale; output[5] = (sz * sy * sx + cz * cx) * scale; output[6] = cy * sx * scale; output[7] = 0;
  output[8] = (cz * sy * cx + sz * sx) * scale; output[9] = (sz * sy * cx - cz * sx) * scale; output[10] = cy * cx * scale; output[11] = 0;
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
    capacity[0] * FLOATS_PER_COLOR_VERTEX * Float32Array.BYTES_PER_ELEMENT,
    gl.DYNAMIC_DRAW,
  );
  gl.bindBuffer(gl.ARRAY_BUFFER, texturedBuffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    capacity[1] * TEXTURED_WORLD_VERTEX_FLOATS * Float32Array.BYTES_PER_ELEMENT,
    gl.DYNAMIC_DRAW,
  );

  let itemId: ItemId | null = null;
  let block = BLOCK.AIR as BlockId;
  let charging = false;
  let chargeStage: 0 | 1 | 2 = 0;
  let actionKind: FirstPersonActionKind = "use";
  let actionStartedAt = -Infinity;
  const actionPose: FirstPersonActionPose = [0, 0, 0, 0, 0, 0];
  const modelMatrix = new Float32Array(16);
  const viewProjection = new Float32Array(16);
  const stats: FirstPersonRenderStats = [0, 0, 0, 0, 0, 0, capacity[2]];

  function rebuild(): void {
    const geometry: GeometryWriter = [[], []];
    if (itemId && ITEMS[itemId].category === "block" && canUseCanonicalCube(block)) {
      appendTexturedCube(geometry[1], block);
    } else if (itemId === "bow") {
      appendBow(geometry[0], chargeStage, charging);
    } else if (itemId && ITEMS[itemId].tool) {
      appendTool(geometry[0], itemId);
    } else if (itemId && ITEMS[itemId].category === "food") {
      appendFood(geometry[0], itemId);
    } else if (itemId && ITEMS[itemId].category === "block") {
      appendSpecialBlock(geometry[0], itemId);
    } else if (itemId) {
      appendMaterial(geometry[0], itemId);
    }
    // Vanilla's drawn bow is a large right-side item presentation. Keeping the
    // ordinary one-arm mesh here reads as an unrelated floating limb, so the
    // bow owns the complete staged silhouette while every other item retains
    // the same hand and wrist pivot.
    if (itemId !== "bow") appendArm(geometry[0]);
    if (geometry[0].length > FIRST_PERSON_MAX_COLOR_VERTICES * FLOATS_PER_COLOR_VERTEX
      || geometry[1].length > FIRST_PERSON_MAX_TEXTURED_VERTICES * TEXTURED_WORLD_VERTEX_FLOATS) {
      throw new Error("First-person model exceeded its fixed geometry budget.");
    }
    const colorData = new Float32Array(geometry[0]);
    const texturedData = new Float32Array(geometry[1]);
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
  return [
    colorBuffer,
    texturedBuffer,
    stats,
    (nextItemId, nextBlock) => {
      if (itemId === nextItemId && block === nextBlock) return;
      itemId = nextItemId;
      block = nextBlock;
      charging = false;
      chargeStage = 0;
      actionStartedAt = -Infinity;
      rebuild();
    },
    (nextCharging, progress) => {
      const nextStage = firstPersonBowChargeStage(nextCharging, progress);
      if (charging === nextCharging && chargeStage === nextStage) return;
      charging = nextCharging;
      chargeStage = nextStage;
      if (itemId === "bow") rebuild();
    },
    (kind, now) => {
      actionKind = kind;
      actionStartedAt = Number.isFinite(now) ? now : 0;
    },
    (output, projection, now, reducedMotion) => {
      sampleFirstPersonAction(
        actionPose,
        actionKind,
        now - actionStartedAt,
        Boolean(itemId && ITEMS[itemId].category === "food"),
        reducedMotion,
      );
      writeFirstPersonModelMatrix(modelMatrix, actionPose);
      viewProjection.set(projection);
      // World FOV remains untouched. On portrait/narrow canvases only the
      // viewmodel stops widening past a square aspect, keeping the item visible
      // while the lower sleeve may still crop naturally against the viewport.
      if (viewProjection[0] > viewProjection[5]) viewProjection[0] = viewProjection[5];
      return writeMatrixProduct(output, viewProjection, modelMatrix);
    },
    () => {
      gl.deleteBuffer(colorBuffer);
      gl.deleteBuffer(texturedBuffer);
    },
  ];
}
