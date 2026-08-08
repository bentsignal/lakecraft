/**
 * Focused regressions for pickaxe inventory silhouette + first-person held pose.
 * Non-pickaxe tools must keep their reviewed presentation unchanged.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getItemIconArt, ITEM_ICON_SIZE } from "../client/components/itemIconArt.ts";
import {
  FIRST_PERSON_PICKAXE_PRESENTATION,
  createFirstPersonRenderer,
  firstPersonSpritePresentation,
  isPickaxeItem,
  sampleFirstPersonAction,
} from "../client/game/firstPersonRenderer.ts";
import { FIRST_PERSON_TUNING } from "../client/game/firstPersonTuning.ts";
import { appendItemSpriteGeometry, ITEM_SPRITE_VERTEX_FLOATS } from "../client/game/itemSpriteGeometry.ts";
import { BLOCK } from "../client/game/types.ts";
import { ITEMS, type ItemId } from "../shared/game.ts";
const PICKAXE_TIERS = ["wooden", "stone", "iron", "golden", "diamond"] as const;

function occupancy(itemId: ItemId): ReadonlySet<string> {
  const cells = new Set<string>();
  for (const run of getItemIconArt(itemId).runs) {
    for (let x = run.x; x < run.x + run.width; x += 1) cells.add(`${x}:${run.y}`);
  }
  return cells;
}

function eightNeighborComponents(cells: ReadonlySet<string>): number {
  const remaining = new Set(cells);
  let components = 0;
  while (remaining.size) {
    components += 1;
    const first = remaining.values().next().value as string;
    remaining.delete(first);
    const queue = [first];
    while (queue.length) {
      const [x, y] = queue.pop()!.split(":").map(Number);
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
        if ((dx || dy) && remaining.delete(`${x + dx}:${y + dy}`)) queue.push(`${x + dx}:${y + dy}`);
      }
    }
  }
  return components;
}

// --- Silhouette: thin stepped pickaxe, shared across tiers ---
const ironMask = occupancy("iron_pickaxe");
assert.equal(ironMask.size, 68, "exact installed pickaxe silhouette stays compact (not a filled blob)");
assert.equal(eightNeighborComponents(ironMask), 1,
  "handle, socket, crown, and right tine form one eight-neighbor silhouette");
for (const tier of PICKAXE_TIERS) {
  assert.deepEqual([...occupancy(`${tier}_pickaxe` as ItemId)].sort(), [...ironMask].sort(),
    `${tier} pickaxe shares the iron silhouette mask`);
}

// Handle stays narrow: at most four occupied cells on the lower grip rows
for (const y of [12, 13, 14] as const) {
  let width = 0;
  for (let x = 0; x < ITEM_ICON_SIZE; x += 1) if (ironMask.has(`${x}:${y}`)) width += 1;
  assert.ok(width <= 4, `grip row y=${y} stays thin (width ${width})`);
}

// --- Exact material palettes remain detailed and tier-distinct ---
const tierPalettes = new Set<string>();
for (const tier of PICKAXE_TIERS) {
  const itemId = `${tier}_pickaxe` as ItemId;
  const colors = new Set(getItemIconArt(itemId).runs.map(({ color }) => color));
  assert.ok(colors.size >= 6, `${tier} exact texture retains material, outline, and wooden-handle shading`);
  tierPalettes.add([...colors].sort().join(","));
}
assert.equal(tierPalettes.size, PICKAXE_TIERS.length, "every installed pickaxe tier has a distinct material palette");

// --- Independently authored non-pickaxe silhouettes ---
const axeCells = occupancy("iron_axe");
const shovelCells = occupancy("iron_shovel");
const swordCells = occupancy("iron_sword");
assert.notDeepEqual([...ironMask].sort(), [...axeCells].sort(), "pickaxe ≠ axe");
assert.notDeepEqual([...ironMask].sort(), [...shovelCells].sort(), "pickaxe ≠ shovel");
assert.notDeepEqual([...ironMask].sort(), [...swordCells].sort(), "pickaxe ≠ sword");

// --- Nearest-neighbor / crisp pixel contract ---
const hudCss = readFileSync(new URL("../client/components/HudStyles.tsx", import.meta.url), "utf8");
assert.ok(hudCss.includes("image-rendering: pixelated"),
  "hotbar/inventory CSS forces nearest-neighbor item glyphs");
const glyphSource = readFileSync(new URL("../client/components/ItemGlyph.tsx", import.meta.url), "utf8");
assert.ok(glyphSource.includes('shape-rendering="crispEdges"'),
  "SVG item icons use crispEdges (no antialiased edges)");
assert.ok(glyphSource.includes("getItemIconArt"),
  "inventory glyphs read the same run art as held geometry");

// Sprite geometry keeps integer pixel faces (no fractional bleed)
const sprite: number[] = [];
const verts = appendItemSpriteGeometry(sprite, getItemIconArt("iron_pickaxe"));
assert.ok(verts > 0 && verts === 1_140, "exact installed pickaxe extrudes to the reviewed vertex fixture");
for (let offset = 0; offset < sprite.length; offset += ITEM_SPRITE_VERTEX_FLOATS) {
  assert.ok(Number.isFinite(sprite[offset]) && Number.isFinite(sprite[offset + 1]));
}

// --- Pickaxe-specific first-person pose / grip ---
assert.equal(isPickaxeItem("iron_pickaxe"), true);
assert.equal(isPickaxeItem("diamond_pickaxe"), true);
assert.equal(isPickaxeItem("iron_axe"), false);
assert.equal(isPickaxeItem("bow"), false);
assert.equal(isPickaxeItem(null), false);

assert.deepEqual(FIRST_PERSON_PICKAXE_PRESENTATION.pivotPixels, [3, 13],
  "held pickaxe pivots on the lower wooden grip");
const axePresentation = firstPersonSpritePresentation("iron_axe");
assert.ok(FIRST_PERSON_PICKAXE_PRESENTATION.depth < axePresentation.depth,
  "pickaxe extrusion is thinner than the independently authored axe depth");
assert.deepEqual(FIRST_PERSON_PICKAXE_PRESENTATION.rotationDegrees, [0, 180, 25],
  "pickaxe keeps the mirrored right-hand face with the reviewed handheld roll");
assert.notDeepEqual(FIRST_PERSON_PICKAXE_PRESENTATION, axePresentation,
  "pickaxe has a reference-calibrated anchor and scale distinct from axe/shovel/sword presentation");

type CapturedBuffer = { id: number };
function captureGl(): { gl: WebGLRenderingContext; uploads: Map<number, Float32Array> } {
  let nextId = 0;
  let bound: CapturedBuffer | null = null;
  const uploads = new Map<number, Float32Array>();
  return {
    uploads,
    gl: {
      ARRAY_BUFFER: 0x8892,
      DYNAMIC_DRAW: 0x88e8,
      createBuffer: () => ({ id: ++nextId }),
      bindBuffer: (_target, buffer) => { bound = buffer as unknown as CapturedBuffer | null; },
      bufferData: () => undefined,
      bufferSubData: (_target, _offset, data) => {
        if (!bound) throw new Error("buffer unbound");
        uploads.set(bound.id, new Float32Array(data as ArrayLike<number>));
      },
      deleteBuffer: () => undefined,
    } as unknown as WebGLRenderingContext,
  };
}

function spatialBounds(data: Float32Array, vertexCount: number) {
  let minX = Infinity; let maxX = -Infinity;
  let minY = Infinity; let maxY = -Infinity;
  let minZ = Infinity; let maxZ = -Infinity;
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const offset = vertex * 6;
    minX = Math.min(minX, data[offset]); maxX = Math.max(maxX, data[offset]);
    minY = Math.min(minY, data[offset + 1]); maxY = Math.max(maxY, data[offset + 1]);
    minZ = Math.min(minZ, data[offset + 2]); maxZ = Math.max(maxZ, data[offset + 2]);
  }
  return { minX, maxX, minY, maxY, minZ, maxZ, width: maxX - minX, height: maxY - minY, depth: maxZ - minZ };
}

function perspective(aspect: number): Float32Array {
  const f = 1 / Math.tan(70 * Math.PI / 360);
  const projection = new Float32Array(16);
  projection[0] = f / aspect;
  projection[5] = f;
  projection[10] = -(90 + 0.05) / (90 - 0.05);
  projection[11] = -1;
  projection[14] = -(2 * 90 * 0.05) / (90 - 0.05);
  return projection;
}

function ndcBounds(data: Float32Array, vertexCount: number, mvp: Float32Array) {
  const result = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const offset = vertex * 6;
    const x = data[offset]; const y = data[offset + 1]; const z = data[offset + 2];
    const clipW = mvp[3] * x + mvp[7] * y + mvp[11] * z + mvp[15];
    const screenX = (mvp[0] * x + mvp[4] * y + mvp[8] * z + mvp[12]) / clipW;
    const screenY = (mvp[1] * x + mvp[5] * y + mvp[9] * z + mvp[13]) / clipW;
    result.minX = Math.min(result.minX, screenX); result.maxX = Math.max(result.maxX, screenX);
    result.minY = Math.min(result.minY, screenY); result.maxY = Math.max(result.maxY, screenY);
  }
  return result;
}

function ndcOfPixel(
  pixX: number,
  pixY: number,
  presentation: typeof FIRST_PERSON_PICKAXE_PRESENTATION,
  mvp: Float32Array,
) {
  const geom: number[] = [];
  appendItemSpriteGeometry(geom, {
    family: "tool",
    variant: "probe",
    runs: [{ x: pixX, y: pixY, width: 1, color: "#ffffff" }],
  }, presentation);
  const tuning = FIRST_PERSON_TUNING.tool;
  for (let offset = 0; offset < geom.length; offset += 6) {
    const x = (geom[offset] - tuning.pivot[0]) * tuning.scale + tuning.pivot[0] + tuning.position[0];
    const y = (geom[offset + 1] - tuning.pivot[1]) * tuning.scale + tuning.pivot[1] + tuning.position[1];
    const z = (geom[offset + 2] - tuning.pivot[2]) * tuning.scale + tuning.pivot[2] + tuning.position[2];
    geom[offset] = x; geom[offset + 1] = y; geom[offset + 2] = z;
  }
  let sumX = 0; let sumY = 0; let count = 0;
  for (let offset = 0; offset < geom.length; offset += 6) {
    const x = geom[offset]; const y = geom[offset + 1]; const z = geom[offset + 2];
    const clipX = mvp[0] * x + mvp[4] * y + mvp[8] * z + mvp[12];
    const clipY = mvp[1] * x + mvp[5] * y + mvp[9] * z + mvp[13];
    const clipW = mvp[3] * x + mvp[7] * y + mvp[11] * z + mvp[15];
    sumX += clipX / clipW; sumY += clipY / clipW; count += 1;
  }
  return [sumX / count, sumY / count] as const;
}

const capture = captureGl();
const renderer = createFirstPersonRenderer(capture.gl);
renderer[3]("iron_pickaxe", BLOCK.AIR);
const pickUpload = capture.uploads.get(1);
assert.ok(pickUpload, "pickaxe color buffer uploaded");
assert.equal(renderer[2][0], 1_140, "held pickaxe vertex count matches inventory extrusion");
const pick = spatialBounds(pickUpload, renderer[2][0]);
assert.ok(pick.width > 0.25 && pick.height > 0.35,
  `held pickaxe keeps tall handle + broad head: ${JSON.stringify(pick)}`);
assert.ok(pick.depth > 0.01 && FIRST_PERSON_PICKAXE_PRESENTATION.depth < 0.05,
  `the strongly rotated held pickaxe retains an intrinsically thin opaque-edge sprite: ${JSON.stringify(pick)}`);

const wideProjection = perspective(16 / 9);
const pickMvp = renderer[6](new Float32Array(16), wideProjection, 0, false);
const pickViewport = ndcBounds(pickUpload, renderer[2][0], pickMvp);
const gripNdc = FIRST_PERSON_PICKAXE_PRESENTATION.center.slice(0, 2);
console.log(JSON.stringify({ pickViewport, gripNdc }));
assert.ok(pickViewport.minX > 0.4 && pickViewport.minX < 0.7,
  "the visible pickaxe begins in the middle-right rather than centered broadside");
assert.ok(pickViewport.maxX >= 0.95 && pickViewport.maxX < 1.4,
  "the exact pickaxe head stays readable at the right viewport edge");
assert.ok(pickViewport.minY < -0.7, "the lower handle reaches the hand in the lower-right");
assert.ok(pickViewport.maxY > -0.4 && pickViewport.maxY < 0.25,
  "the screen-space grip keeps the head in the middle-right without filling the screen");
assert.ok(Math.abs(gripNdc[0] - 1.08) < 1e-12 && Math.abs(gripNdc[1] + 0.85) < 1e-12,
  "grip is independently anchored just beyond the lower-right frame");
assert.ok(pickViewport.maxY > gripNdc[1] + 0.35, "head sits clearly above the grip");
assert.ok(pickViewport.minX < gripNdc[0] - 0.03, "the mirrored head extends leftward from the lower-right grip");

// Swing still animates through the shared action matrix without reallocating geometry
const swingPose = sampleFirstPersonAction([0, 0, 0, 0, 0, 0], "mine", 110, false, false);
assert.ok(swingPose.some((value) => value !== 0), "mine swing produces a non-zero action pose");
const midSwing = renderer[6](new Float32Array(16), (() => {
  const proj = new Float32Array(16);
  proj[0] = 1; proj[5] = 1; proj[10] = -1; proj[11] = -1; proj[14] = -0.2;
  return proj;
})(), 110, false);
assert.ok(midSwing.every(Number.isFinite), "swing MVP stays finite for pickaxe");

// --- Non-pickaxe tools keep shared tool presentation ---
renderer[3]("iron_axe", BLOCK.AIR);
const axeMvp = renderer[6](new Float32Array(16), wideProjection, 0, false);
const axeUpload = capture.uploads.get(1);
assert.ok(axeUpload);
const axe = spatialBounds(axeUpload, renderer[2][0]);
assert.ok(axe.depth > 0.01, "axe retains an opaque-edge 3D extrusion");
assert.equal(renderer[2][0], appendItemSpriteGeometry([], getItemIconArt("iron_axe")),
  "axe held geometry still matches its inventory sprite topology");
const axeViewport = ndcBounds(axeUpload, renderer[2][0], axeMvp);
assert.ok(axeViewport.minX > 0.4 && axeViewport.maxX > 0.9
  && axeViewport.minY < -0.6 && axeViewport.maxY < 0.2,
`the exact axe enters from the same lower-right socket without inheriting pickaxe geometry: ${JSON.stringify(axeViewport)}`);

renderer[3]("iron_sword", BLOCK.AIR);
assert.equal(renderer[2][0], appendItemSpriteGeometry([], getItemIconArt("iron_sword")),
  "sword held geometry is unchanged by the pickaxe-only presentation path");

// Renderer source keeps pickaxe branch isolated
const rendererSource = readFileSync(new URL("../client/game/firstPersonRenderer.ts", import.meta.url), "utf8");
assert.ok(rendererSource.includes("FIRST_PERSON_PICKAXE_PRESENTATION"),
  "first-person path references the pickaxe-specific presentation");
assert.ok(rendererSource.includes("isPickaxeItem"),
  "pickaxe detection is explicit rather than retuning every handheld tool");
assert.ok(rendererSource.includes("firstPersonSpritePresentation"),
  "non-pickaxe families use explicit presentation routing rather than one shared tool guess");

// Every catalogued pickaxe item id is a tool with kind pickaxe
for (const itemId of Object.keys(ITEMS) as ItemId[]) {
  if (!itemId.endsWith("_pickaxe")) continue;
  assert.equal(ITEMS[itemId].tool?.kind, "pickaxe");
  assert.equal(isPickaxeItem(itemId), true);
}

renderer[7]();
console.log("pickaxe held fidelity regressions passed");
