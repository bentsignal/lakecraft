import { ITEMS, type ItemId } from "../../shared/game.ts";
import { getBowIconArt, getItemIconArt } from "../components/itemIconArt.ts";
import { TEXTURED_WORLD_VERTEX_FLOATS, blockTextureForFace, textureAtlasUv } from "./blockTextures.ts";
import { CUBE_FACES } from "./cubeFaces.ts";
import { ITEM_SPRITE_MAX_VERTICES, appendItemSpriteGeometry } from "./itemSpriteGeometry.ts";
import { writeMatrixProduct } from "./matrixProduct.ts";
import { BLOCK, isSlabBlock, isStairBlock, type BlockId } from "./types.ts";
import {
  FIRST_PERSON_TUNING,
  currentFirstPersonTuning,
  type FirstPersonGroupTuning,
  type FirstPersonTuning,
} from "./firstPersonTuning.ts";
import {
  createViewmodelRigPose,
  createViewmodelRigPoseFromProjection,
  unprojectViewmodelAnchor,
  type ViewmodelRigPose,
} from "./viewmodelRig.ts";

type Vec3 = readonly [number, number, number];
const HELD_BLOCK_ANCHOR_NDC = Object.freeze([0.7, -0.76, -1.16] as const);

const FLOATS_PER_COLOR_VERTEX = 6;
export const FIRST_PERSON_MAX_COLOR_VERTICES = ITEM_SPRITE_MAX_VERTICES;
export const FIRST_PERSON_MAX_TEXTURED_VERTICES = 66;
export const FIRST_PERSON_ACTION_MS = 220;
export const FIRST_PERSON_FOOD_ACTION_MS = 1_000;
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
  setActionPreview: (kind: FirstPersonActionKind | null, progress?: number) => void,
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

function canUseTexturedBlock(block: BlockId): boolean {
  // Every special-shape block resolves every face to null; one side therefore
  // distinguishes atlas-backed cubes, slabs, and stairs from flat item art.
  return block !== BLOCK.AIR && blockTextureForFace(block, "east") !== null;
}

export type FirstPersonHeldItemTuningGroup = "block" | "bow" | "tool" | "otherItem" | null;

/** The production pose-tuning group used when the held-item mesh is rebuilt. */
export function firstPersonHeldItemTuningGroup(
  itemId: ItemId | null,
  block: BlockId,
): FirstPersonHeldItemTuningGroup {
  if (!itemId) return null;
  if (ITEMS[itemId].category === "block" && canUseTexturedBlock(block)) return "block";
  if (itemId === "bow") return "bow";
  if (ITEMS[itemId].tool) return "tool";
  return "otherItem";
}

export function usesCanonicalHeldBlock(itemId: ItemId | null, block: BlockId): boolean {
  return firstPersonHeldItemTuningGroup(itemId, block) === "block";
}

/** Keeps the authored low-alpha glass details visible in the first-person viewmodel. */
export function firstPersonHeldBlockAlphaCutoff(itemId: ItemId | null): number {
  return itemId === "glass" || itemId?.endsWith("_stained_glass") ? 0.02 : 0.08;
}

export type FirstPersonSpritePresentation = Readonly<{
  center: Vec3;
  size: number;
  depth: number;
  rotationDegrees: Vec3;
  pivotPixels: readonly [number, number];
}>;

type FirstPersonSpritePose = [
  number, number, number,
  number, number,
  number, number, number,
  number, number,
];

/** Snap an authored hand socket to the nearest real sprite pixel. Rebuilds run
 * only when the held item changes, so this catalog scan never enters a frame loop. */
function attachOpaqueGrip(itemId: ItemId, pose: FirstPersonSpritePose): FirstPersonSpritePose {
  let bestDistance = Infinity;
  const preferredX = pose[8];
  const preferredY = pose[9];
  for (const run of getItemIconArt(itemId).runs) {
    const x = Math.max(run.x, Math.min(preferredX, run.x + run.width - 1));
    const distance = (x - preferredX) ** 2 + (run.y - preferredY) ** 2;
    if (distance >= bestDistance) continue;
    bestDistance = distance;
    pose[8] = x;
    pose[9] = run.y;
  }
  return pose;
}

function spritePresentation(pose: FirstPersonSpritePose): FirstPersonSpritePresentation {
  return {
    center: pose.slice(0, 3) as Vec3,
    size: pose[3],
    depth: pose[4],
    rotationDegrees: pose.slice(5, 8) as Vec3,
    pivotPixels: pose.slice(8) as [number, number],
  };
}

/**
 * Screen-space presentation for the shared inventory pickaxe sprite. The 16x16
 * art runs grip→head from lower-left to upper-right; a 180° Y turn puts
 * the grip in the lower-right hand while a shallow pitch/roll and thin depth
 * keep the stepped silhouette face-readable instead of edge-on.
 */
export const FIRST_PERSON_PICKAXE_PRESENTATION = spritePresentation([
  // The grip exits beyond the lower-right edge while the mirrored head rises
  // up and left, matching the supplied Java first-person reference.
  // The reviewed 25-degree handheld roll moves the visible silhouette down
  // around its grip. Lift the pivot by the matching 0.20 NDC so the item keeps
  // the already-approved lower-right screen envelope.
  1.08, -0.85, -1.16,
  1.25, 0.03,
  0, 180, 25,
  /** Lower wooden handle; the hand should read as gripping this pixel. */
  3, 13,
]);

export function firstPersonSpriteFamily(itemId: ItemId, bowDrawn = false): string {
  const item = ITEMS[itemId];
  return item.tool?.kind ?? (itemId === "bow" ? bowDrawn ? "bowDraw" : "bowIdle"
    : itemId === "shears" ? "shears" : itemId === "flint_and_steel" ? "flintSteel"
      : item.category === "food" ? "food" : item.category === "block" ? "specialBlock" : "material");
}

/**
 * Reference-calibrated screen presentation, independent of inventory art.
 * `center` is the opaque grip in NDC X/Y plus a negative camera depth. `size`
 * is the sprite's full vertical NDC extent before rotation. Keeping those two
 * values in screen space makes the held item stable across gameplay FOVs.
 */
export function firstPersonSpritePresentation(itemId: ItemId, bowDrawn?: boolean): FirstPersonSpritePresentation {
  const kind = ITEMS[itemId].tool?.kind;
  if (kind === "pickaxe") return FIRST_PERSON_PICKAXE_PRESENTATION;
  let pose: FirstPersonSpritePose;
  if (kind) {
    const sword = kind === "sword";
    const shovel = kind === "shovel";
    pose = [
      1.05, -0.85, -1.16,
      sword ? 1.05 : kind === "axe" ? 1.15 : kind === "shovel" ? 1.15 : 1.2, 0.035,
      0, 180, 25,
      2, sword ? 13 : 14,
    ];
  } else if (itemId === "bow") {
    pose = [
      0.88, bowDrawn ? -0.93 : -1.02, -1.16,
      bowDrawn ? 1.75 : 1.52, 0.045,
      0, 180, bowDrawn ? -83 : -80,
      3, 8,
    ];
  } else if (itemId === "shears") {
    pose = [1, -1.04, -1.16, 1.18, 0.04, 4, 180, -4, 6, 11];
  } else if (itemId === "flint_and_steel") {
    pose = [1, -1.04, -1.16, 1.12, 0.04, 4, 180, -4, 8, 11];
  } else {
    const category = ITEMS[itemId].category;
    const food = category === "food";
    const special = category === "block";
    pose = [
      food ? 1 : special ? 0.9 : 0.88, -1.04, -1.16,
      food ? 1.36 : special ? 1.2 : 1.28, 0.04,
      4, 180, -4,
      8, special ? 13 : 12,
    ];
  }
  return spritePresentation(attachOpaqueGrip(itemId, pose));
}

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

function appendSocketedTexturedCube(
  output: number[],
  block: BlockId,
  pose: ViewmodelRigPose,
  tuning: FirstPersonTuning["block"],
): void {
  const depth = Math.max(0.2, -HELD_BLOCK_ANCHOR_NDC[2] - tuning.center[2]);
  const center = unprojectViewmodelAnchor(
    HELD_BLOCK_ANCHOR_NDC[0] + tuning.center[0],
    HELD_BLOCK_ANCHOR_NDC[1] + tuning.center[1],
    depth,
    pose.verticalFovRadians,
    pose.aspect,
  );
  const size = tuning.size * pose.itemScale * depth;
  const rotation = tuning.rotationDegrees;
  for (const face of CUBE_FACES) {
    const texture = blockTextureForFace(block, face[0]);
    if (!texture) continue;
    const uv = textureAtlasUv(texture);
    for (const point of face[5]) {
      const horizontal = face[1] !== 0 ? point[2] : point[0];
      const vertical = face[2] !== 0 ? point[2] : point[1];
      appendTransformedPoint(
        output,
        (point[0] - 0.5) * size,
        (point[1] - 0.5) * size,
        (point[2] - 0.5) * size,
        center[0], center[1], center[2],
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

function appendSocketedTexturedShape(
  output: number[], block: BlockId, pose: ViewmodelRigPose, tuning: FirstPersonTuning["block"],
): void {
  if (!isSlabBlock(block) && !isStairBlock(block)) return appendSocketedTexturedCube(output, block, pose, tuning);
  const depth = Math.max(0.2, -HELD_BLOCK_ANCHOR_NDC[2] - tuning.center[2]);
  const center = unprojectViewmodelAnchor(
    HELD_BLOCK_ANCHOR_NDC[0] + tuning.center[0], HELD_BLOCK_ANCHOR_NDC[1] + tuning.center[1],
    depth, pose.verticalFovRadians, pose.aspect,
  );
  const size = tuning.size * pose.itemScale * depth;
  const rotation = tuning.rotationDegrees;
  const box = (min: Vec3, max: Vec3, skipBottom = false): void => {
    for (const face of CUBE_FACES) {
      if (skipBottom && face[0] === "bottom") continue;
      const texture = blockTextureForFace(block, face[0]);
      if (!texture) continue;
      const uv = textureAtlasUv(texture);
      for (const point of face[5]) {
        const x = min[0] + point[0] * (max[0] - min[0]);
        const y = min[1] + point[1] * (max[1] - min[1]);
        const z = min[2] + point[2] * (max[2] - min[2]);
        const horizontal = face[1] !== 0 ? z : x;
        const vertical = face[2] !== 0 ? z : y;
        appendTransformedPoint(output, (x - .5) * size, (y - .5) * size, (z - .5) * size,
          center[0], center[1], center[2], rotation[0] * Math.PI / 180,
          rotation[1] * Math.PI / 180, rotation[2] * Math.PI / 180);
        output.push(uv.left + (uv.right - uv.left) * horizontal,
          uv.bottom + (uv.top - uv.bottom) * vertical, face[4]);
      }
    }
  };
  box([0,0,0], [1,.5,1]);
  if (isStairBlock(block)) box([.5,.5,0], [1,1,1], true);
}

function appendSocketedItemSprite(
  output: number[],
  itemId: ItemId,
  pose: ViewmodelRigPose,
  bowDrawn: boolean,
  bowStage: 0 | 1 | 2,
  tuning: FirstPersonGroupTuning,
): void {
  const start = output.length;
  const source = firstPersonSpritePresentation(itemId, bowDrawn);
  const depth = Math.max(0.2, -source.center[2] - tuning.position[2]);
  const center = unprojectViewmodelAnchor(
    source.center[0] + tuning.position[0],
    source.center[1] + tuning.position[1],
    depth,
    pose.verticalFovRadians,
    pose.aspect,
  );
  const size = source.size * pose.itemScale * depth * tuning.scale;
  appendItemSpriteGeometry(
    output,
    itemId === "bow" ? getBowIconArt(bowDrawn ? bowStage + 1 as 1 | 2 | 3 : 0) : getItemIconArt(itemId),
    {
      center,
      size,
      depth: Math.max(size / 96, size * source.depth),
      rotationDegrees: [
        source.rotationDegrees[0] + tuning.rotationDegrees[0],
        source.rotationDegrees[1] + tuning.rotationDegrees[1],
        source.rotationDegrees[2] + tuning.rotationDegrees[2],
      ],
      pivotPixels: source.pivotPixels,
    },
  );
  // Preserve the user's exact 90-degree-FOV calibration, but do not let wider
  // gameplay FOV multiply a strongly pitched sprite's rotated depth and push
  // it through the near plane. X/Y still follow gameplay FOV as authored.
  const inverseWideFovDepthScale = 1 / (pose.itemScale > 1 ? pose.itemScale : 1);
  for (let offset = start; offset < output.length; offset += FLOATS_PER_COLOR_VERTEX) {
    output[offset + 2] = center[2]
      + (output[offset + 2] - center[2]) * inverseWideFovDepthScale;
  }
}

export function writeSocketedViewmodelActionMatrix(
  output: Float32Array,
  pose: Readonly<FirstPersonActionPose>,
  rig: ViewmodelRigPose,
): Float32Array {
  const rx = pose[3] ?? 0; const ry = pose[4] ?? 0; const rz = pose[5] ?? 0;
  const cx = Math.cos(rx); const sx = Math.sin(rx);
  const cy = Math.cos(ry); const sy = Math.sin(ry);
  const cz = Math.cos(rz); const sz = Math.sin(rz);
  output[0] = cz * cy; output[1] = sz * cy; output[2] = -sy; output[3] = 0;
  output[4] = cz * sy * sx - sz * cx; output[5] = sz * sy * sx + cz * cx; output[6] = cy * sx; output[7] = 0;
  output[8] = cz * sy * cx + sz * sx; output[9] = sz * sy * cx - cz * sx; output[10] = cy * cx; output[11] = 0;
  const [pivotX, pivotY, pivotZ] = rig.shoulder;
  const actionX = (pose[0] ?? 0) * rig.viewScale * rig.aspect / (16 / 9);
  const actionY = (pose[1] ?? 0) * rig.viewScale;
  const actionZ = (pose[2] ?? 0) * rig.viewScale;
  output[12] = pivotX + actionX - (output[0] * pivotX + output[4] * pivotY + output[8] * pivotZ);
  output[13] = pivotY + actionY - (output[1] * pivotX + output[5] * pivotY + output[9] * pivotZ);
  output[14] = pivotZ + actionZ - (output[2] * pivotX + output[6] * pivotY + output[10] * pivotZ);
  output[15] = 1;
  return output;
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
  const durationMs = kind === "use" && foodHeld ? FIRST_PERSON_FOOD_ACTION_MS : FIRST_PERSON_ACTION_MS;
  if (reducedMotion || !Number.isFinite(elapsedMs) || elapsedMs < 0 || elapsedMs >= durationMs) return output;
  const progress = elapsedMs / durationMs;
  const arc = Math.sin(Math.PI * progress);
  if (kind === "use" && foodHeld) {
    // Eating brings the food toward the mouth in the lower center of the
    // screen. These camera-space offsets intentionally become larger as Z
    // approaches the player, matching the supplied mid-eating reference.
    output[0] = -2.3 * arc;
    output[1] = 0.15 * arc;
    output[2] = 0;
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
  let actionPreview: Readonly<{ kind: FirstPersonActionKind; progress: number }> | null = null;
  const actionPose: FirstPersonActionPose = [0, 0, 0, 0, 0, 0];
  const modelMatrix = new Float32Array(16);
  const viewProjection = new Float32Array(16);
  const stats: FirstPersonRenderStats = [0, 0, 0, 0, 0, 0, capacity[2]];
  let tuningSnapshot = currentFirstPersonTuning();
  let activeTuning: FirstPersonTuning = tuningSnapshot.tuning;
  let rigPose = createViewmodelRigPose(70 * Math.PI / 180, 16 / 9);
  let projectionFingerprint = "";

  function rebuild(): void {
    const geometry: GeometryWriter = [[], []];
    const tuningGroup = firstPersonHeldItemTuningGroup(itemId, block);
    if (tuningGroup === "block") {
      appendSocketedTexturedShape(geometry[1], block, rigPose, activeTuning.block);
    } else if (tuningGroup && itemId) {
      appendSocketedItemSprite(
        geometry[0], itemId, rigPose, charging, chargeStage,
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
      const nextProjectionFingerprint = `${projection[0].toFixed(6)}:${projection[5].toFixed(6)}`;
      if (nextProjectionFingerprint !== projectionFingerprint) {
        projectionFingerprint = nextProjectionFingerprint;
        rigPose = createViewmodelRigPoseFromProjection(projection);
        rebuild();
      }
      const previewKind = actionPreview?.kind ?? actionKind;
      const foodHeld = Boolean(itemId && ITEMS[itemId].category === "food");
      sampleFirstPersonAction(
        actionPose,
        previewKind,
        actionPreview
          ? actionPreview.progress * (previewKind === "use" && foodHeld ? FIRST_PERSON_FOOD_ACTION_MS : FIRST_PERSON_ACTION_MS)
          : now - actionStartedAt,
        foodHeld,
        reducedMotion,
      );
      writeSocketedViewmodelActionMatrix(modelMatrix, actionPose, rigPose);
      viewProjection.set(projection);
      return writeMatrixProduct(output, viewProjection, modelMatrix);
    },
    () => {
      gl.deleteBuffer(colorBuffer);
      gl.deleteBuffer(texturedBuffer);
    },
    (kind, progress = 0.65) => {
      actionPreview = kind === null ? null : {
        kind,
        progress: Math.max(0, Math.min(0.999, Number.isFinite(progress) ? progress : 0.65)),
      };
    },
  ];
}
