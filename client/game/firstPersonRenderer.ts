import { ITEMS, type ItemId } from "../../shared/game.ts";
import { itemVisual } from "../../shared/visualCatalog.ts";
import { getBowIconArt, getItemIconArt } from "../components/itemIconArt.ts";
import { TEXTURED_WORLD_VERTEX_FLOATS, blockTextureForFace, textureAtlasUv } from "./blockTextures.ts";
import { CUBE_FACES } from "./cubeFaces.ts";
import { ITEM_SPRITE_MAX_VERTICES, appendItemSpriteGeometry } from "./itemSpriteGeometry.ts";
import { writeMatrixProduct } from "./matrixProduct.ts";
import { BLOCK, type BlockId } from "./types.ts";
import {
  FIRST_PERSON_TUNING,
  currentFirstPersonTuning,
  type FirstPersonGroupTuning,
  type FirstPersonTuning,
} from "./firstPersonTuning.ts";

type Vec3 = readonly [number, number, number];

const FLOATS_PER_COLOR_VERTEX = 6;
export const FIRST_PERSON_MAX_COLOR_VERTICES = ITEM_SPRITE_MAX_VERTICES;
export const FIRST_PERSON_MAX_TEXTURED_VERTICES = 36;
export const FIRST_PERSON_ACTION_MS = 220;
export const FIRST_PERSON_MODEL_SCALE = FIRST_PERSON_TUNING.rig.scale;
export const FIRST_PERSON_MODEL_PIVOT: readonly [number, number, number] = FIRST_PERSON_TUNING.rig.pivot;
/** Camera-space authored poses; action motion still pivots through the shared wrist rig below. */
export const FIRST_PERSON_CUBE_ROTATION: readonly [number, number, number] = [
  FIRST_PERSON_TUNING.block.rotationDegrees[0] * Math.PI / 180,
  FIRST_PERSON_TUNING.block.rotationDegrees[1] * Math.PI / 180,
  FIRST_PERSON_TUNING.block.rotationDegrees[2] * Math.PI / 180,
];

type GeometryWriter = [color: number[], textured: number[]];

function applyGroupTuning(
  output: number[],
  start: number,
  stride: number,
  tuning: FirstPersonGroupTuning,
): void {
  const [translateX, translateY, translateZ] = tuning.position;
  const [pivotX, pivotY, pivotZ] = tuning.pivot;
  const rx = tuning.rotationDegrees[0] * Math.PI / 180;
  const ry = tuning.rotationDegrees[1] * Math.PI / 180;
  const rz = tuning.rotationDegrees[2] * Math.PI / 180;
  const cosineX = Math.cos(rx); const sineX = Math.sin(rx);
  const cosineY = Math.cos(ry); const sineY = Math.sin(ry);
  const cosineZ = Math.cos(rz); const sineZ = Math.sin(rz);
  for (let offset = start; offset < output.length; offset += stride) {
    let x = (output[offset] - pivotX) * tuning.scale;
    let y = (output[offset + 1] - pivotY) * tuning.scale;
    let z = (output[offset + 2] - pivotZ) * tuning.scale;
    if (rx) {
      const nextY = y * cosineX - z * sineX;
      z = y * sineX + z * cosineX;
      y = nextY;
    }
    if (ry) {
      const nextX = x * cosineY + z * sineY;
      z = -x * sineY + z * cosineY;
      x = nextX;
    }
    if (rz) {
      const nextX = x * cosineZ - y * sineZ;
      y = x * sineZ + y * cosineZ;
      x = nextX;
    }
    output[offset] = x + pivotX + translateX;
    output[offset + 1] = y + pivotY + translateY;
    output[offset + 2] = z + pivotZ + translateZ;
  }
}

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

function canUseCanonicalCube(block: BlockId): boolean {
  // Every special-shape block resolves every face to null; one side therefore
  // distinguishes the full atlas cubes without rebuilding a six-face probe.
  // The slab intentionally reuses the masonry tile for its placed half-height
  // mesh, so texture presence alone must not promote its held item to a cube.
  return block !== BLOCK.AIR && block !== BLOCK.STONE_BRICK_SLAB
    && blockTextureForFace(block, "east") !== null;
}

export type FirstPersonHeldItemTuningGroup = "block" | "bow" | "tool" | "otherItem" | null;

/** The production pose-tuning group used when the held-item mesh is rebuilt. */
export function firstPersonHeldItemTuningGroup(
  itemId: ItemId | null,
  block: BlockId,
): FirstPersonHeldItemTuningGroup {
  if (!itemId) return null;
  if (ITEMS[itemId].category === "block" && canUseCanonicalCube(block)) return "block";
  if (itemId === "bow") return "bow";
  if (ITEMS[itemId].tool) return "tool";
  return "otherItem";
}

/**
 * Camera-space presentation for the shared inventory pickaxe sprite. The 16x16
 * art runs grip→head from lower-left to upper-right; a near-180° Y turn puts
 * the grip in the lower-right hand while a shallow pitch/roll and thin depth
 * keep the stepped silhouette face-readable instead of edge-on.
 */
export const FIRST_PERSON_PICKAXE_PRESENTATION = Object.freeze({
  // Calibrated from the supplied 16:9 Java first-person reference: the head
  // occupies the middle/right of the view while the lower grip exits through
  // the bottom-right edge.  This is deliberately not an inventory-style
  // centered beauty shot of the complete sprite.
  center: [0.74, -0.56, -1.12] as Vec3,
  size: 1.45,
  depth: 0.03,
  rotationDegrees: [12, 180, -22] as Vec3,
  /** Lower wooden handle; the hand should read as gripping this pixel. */
  pivotPixels: [3, 13] as const,
});

/** Shared presentation for non-pickaxe handheld tools (axe, shovel, sword). */
export const FIRST_PERSON_TOOL_PRESENTATION = Object.freeze({
  center: [0.22, 0.16, -1.15] as Vec3,
  size: 1.02,
  depth: 0.07,
  rotationDegrees: [0, 156, 0] as Vec3,
});

export function isPickaxeItem(itemId: ItemId | null): boolean {
  return Boolean(itemId && ITEMS[itemId].tool?.kind === "pickaxe");
}

function appendTexturedCube(output: number[], block: BlockId, tuning: FirstPersonTuning): void {
  const size = tuning.block.size;
  const center = tuning.block.center;
  const rotation = tuning.block.rotationDegrees;
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
        center[0],
        center[1],
        center[2],
        rotation[0] * Math.PI / 180,
        rotation[1] * Math.PI / 180,
        rotation[2] * Math.PI / 180,
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
  const bytesPerVertex = FLOATS_PER_COLOR_VERTEX * Float32Array.BYTES_PER_ELEMENT;
  return [
    FIRST_PERSON_MAX_COLOR_VERTICES,
    FIRST_PERSON_MAX_TEXTURED_VERTICES,
    (FIRST_PERSON_MAX_COLOR_VERTICES + FIRST_PERSON_MAX_TEXTURED_VERTICES) * bytesPerVertex,
  ];
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
  tuning: FirstPersonTuning = FIRST_PERSON_TUNING,
): Float32Array {
  const baseRotation = tuning.rig.rotationDegrees;
  const rx = pose[3] + baseRotation[0] * Math.PI / 180;
  const ry = pose[4] + baseRotation[1] * Math.PI / 180;
  const rz = (pose[5] ?? 0) + baseRotation[2] * Math.PI / 180;
  const cx = Math.cos(rx);
  const sx = Math.sin(rx);
  const cy = Math.cos(ry);
  const sy = Math.sin(ry);
  const cz = Math.cos(rz);
  const sz = Math.sin(rz);
  const [pivotX, pivotY, pivotZ] = tuning.rig.pivot;
  const scale = tuning.rig.scale;
  const rigPosition = tuning.rig.position;
  // Rz * Ry * Rx keeps the authored local X/Y/Z rotation order. Scale and
  // action rotations share the wrist pivot, so the sleeve base stays planted
  // while the held item leads the arc instead of the arm orbiting the block.
  output[0] = cz * cy * scale; output[1] = sz * cy * scale; output[2] = -sy * scale; output[3] = 0;
  output[4] = (cz * sy * sx - sz * cx) * scale; output[5] = (sz * sy * sx + cz * cx) * scale; output[6] = cy * sx * scale; output[7] = 0;
  output[8] = (cz * sy * cx + sz * sx) * scale; output[9] = (sz * sy * cx - cz * sx) * scale; output[10] = cy * cx * scale; output[11] = 0;
  output[12] = pivotX + rigPosition[0] + pose[0] - (output[0] * pivotX + output[4] * pivotY + output[8] * pivotZ);
  output[13] = pivotY + rigPosition[1] + pose[1] - (output[1] * pivotX + output[5] * pivotY + output[9] * pivotZ);
  output[14] = pivotZ + rigPosition[2] + pose[2] - (output[2] * pivotX + output[6] * pivotY + output[10] * pivotZ);
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
  let tuningSnapshot = currentFirstPersonTuning();
  let activeTuning: FirstPersonTuning = tuningSnapshot.tuning;

  function rebuild(): void {
    const geometry: GeometryWriter = [[], []];
    const tuningGroup = firstPersonHeldItemTuningGroup(itemId, block);
    if (tuningGroup === "block") {
      appendTexturedCube(geometry[1], block, activeTuning);
    } else if (tuningGroup && itemId) {
      const start = geometry[0].length;
      const visual = itemVisual(itemId);
      const presentation = visual.parent === "bow"
        ? { center: [0.36, 0, -1.13] as Vec3, size: 1.12, depth: 0.075, rotationDegrees: [0, -22, 0] as Vec3 }
        : visual.parent === "handheld"
          ? (isPickaxeItem(itemId)
            // Pickaxe-only: thin extrusion, grip pivot on the lower stick, and a
            // face-readable cant so the stepped head sits upper-right of the hand.
            ? { ...FIRST_PERSON_PICKAXE_PRESENTATION }
            // Other tools keep the reviewed shared handheld presentation.
            : { ...FIRST_PERSON_TOOL_PRESENTATION })
          : { center: [0.10, -0.02, -1.17] as Vec3, size: 0.76, depth: 0.06, rotationDegrees: [0, -24, 0] as Vec3 };
      appendItemSpriteGeometry(
        geometry[0],
        itemId === "bow" ? getBowIconArt(charging ? chargeStage + 1 as 1 | 2 | 3 : 0) : getItemIconArt(itemId),
        presentation,
      );
      applyGroupTuning(
        geometry[0],
        start,
        FLOATS_PER_COLOR_VERTEX,
        tuningGroup === "bow" ? activeTuning.bow
          : tuningGroup === "tool" ? activeTuning.tool
            : activeTuning.otherItem,
      );
    }
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

  function refreshLiveTuning(): void {
    const next = currentFirstPersonTuning();
    if (next.revision === tuningSnapshot.revision) return;
    tuningSnapshot = next;
    activeTuning = next.tuning;
    rebuild();
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
      refreshLiveTuning();
      sampleFirstPersonAction(
        actionPose,
        actionKind,
        now - actionStartedAt,
        Boolean(itemId && ITEMS[itemId].category === "food"),
        reducedMotion,
      );
      writeFirstPersonModelMatrix(modelMatrix, actionPose, activeTuning);
      viewProjection.set(projection);
      // World FOV remains untouched. Pickaxes use the screenshot-calibrated
      // square viewmodel projection at every aspect so the lower-right grip and
      // cropped silhouette do not slide toward screen center on wide canvases.
      // Other families retain their existing projection until reviewed in
      // their own reference pass.
      if (isPickaxeItem(itemId) || viewProjection[0] > viewProjection[5]) {
        viewProjection[0] = viewProjection[5];
      }
      return writeMatrixProduct(output, viewProjection, modelMatrix);
    },
    () => {
      gl.deleteBuffer(colorBuffer);
      gl.deleteBuffer(texturedBuffer);
    },
  ];
}
