/**
 * Focused regressions for pickaxe inventory silhouette + first-person held pose.
 * Non-pickaxe tools must keep their reviewed presentation unchanged.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getItemIconArt, ITEM_ICON_SIZE } from "../client/components/itemIconArt.ts";
import {
  FIRST_PERSON_PICKAXE_PRESENTATION,
  FIRST_PERSON_TOOL_PRESENTATION,
  createFirstPersonRenderer,
  isPickaxeItem,
  sampleFirstPersonAction,
  writeFirstPersonModelMatrix,
} from "../client/game/firstPersonRenderer.ts";
import { FIRST_PERSON_TUNING } from "../client/game/firstPersonTuning.ts";
import { appendItemSpriteGeometry, ITEM_SPRITE_VERTEX_FLOATS } from "../client/game/itemSpriteGeometry.ts";
import { BLOCK } from "../client/game/types.ts";
import { ITEMS, type ItemId } from "../shared/game.ts";

const PICKAXE_TIERS = ["wooden", "stone", "iron", "golden", "diamond"] as const;
const HEAD_COLORS = {
  wooden: "#a86f38",
  stone: "#858a83",
  iron: "#d1d6d2",
  golden: "#f2c93d",
  diamond: "#35cfc6",
} as const;
const HANDLE_WOOD = "#7b4e28";
const HANDLE_HIGHLIGHT = "#ba8350";
const OUTLINE = "#29241e";

function occupancy(itemId: ItemId): ReadonlySet<string> {
  const cells = new Set<string>();
  for (const run of getItemIconArt(itemId).runs) {
    for (let x = run.x; x < run.x + run.width; x += 1) cells.add(`${x}:${run.y}`);
  }
  return cells;
}

function colorAt(itemId: ItemId, x: number, y: number): string | null {
  for (const run of getItemIconArt(itemId).runs) {
    if (run.y === y && x >= run.x && x < run.x + run.width) return run.color;
  }
  return null;
}

function fourNeighborComponents(cells: ReadonlySet<string>): number {
  const remaining = new Set(cells);
  let components = 0;
  while (remaining.size) {
    components += 1;
    const first = remaining.values().next().value as string;
    remaining.delete(first);
    const queue = [first];
    while (queue.length) {
      const [x, y] = queue.pop()!.split(":").map(Number);
      for (const neighbor of [`${x - 1}:${y}`, `${x + 1}:${y}`, `${x}:${y - 1}`, `${x}:${y + 1}`]) {
        if (remaining.delete(neighbor)) queue.push(neighbor);
      }
    }
  }
  return components;
}

// --- Silhouette: thin stepped pickaxe, shared across tiers ---
const ironMask = occupancy("iron_pickaxe");
assert.equal(ironMask.size, 69, "pickaxe silhouette stays compact (not a filled blob)");
assert.equal(fourNeighborComponents(ironMask), 1,
  "handle, socket, crown, and right tine form one 4-neighbor silhouette");
for (const tier of PICKAXE_TIERS) {
  assert.deepEqual([...occupancy(`${tier}_pickaxe` as ItemId)].sort(), [...ironMask].sort(),
    `${tier} pickaxe shares the iron silhouette mask`);
}

// Shallow crown, solid socket, right tine, and lower grip.
for (const cell of ["4:1", "10:1", "3:2", "8:3", "8:4", "7:5", "6:6", "14:5", "13:7", "1:14"] as const) {
  assert.ok(ironMask.has(cell), `landmark ${cell} occupied`);
}
// Transparent canvas padding and concave space below the asymmetric head.
for (const cell of ["3:3", "4:3", "5:4", "10:5", "11:6", "11:7", "0:0", "15:0", "0:15", "15:15"] as const) {
  assert.equal(ironMask.has(cell), false, `negative space ${cell} stays empty`);
}

// The old defect was a free-standing horizontal bar over an open U. These
// exact socket/handle joins make that topology impossible to reintroduce.
for (const cell of ["8:3", "8:4", "7:5", "6:6", "6:7", "5:8"] as const) {
  assert.ok(ironMask.has(cell), `continuous handle-to-head path retains ${cell}`);
}

// Handle stays narrow: at most four occupied cells on the lower grip rows
for (const y of [12, 13, 14] as const) {
  let width = 0;
  for (let x = 0; x < ITEM_ICON_SIZE; x += 1) if (ironMask.has(`${x}:${y}`)) width += 1;
  assert.ok(width <= 4, `grip row y=${y} stays thin (width ${width})`);
}

// --- Material palette mapping ---
for (const tier of PICKAXE_TIERS) {
  const itemId = `${tier}_pickaxe` as ItemId;
  const colors = new Set(getItemIconArt(itemId).runs.map(({ color }) => color));
  assert.ok(colors.has(HEAD_COLORS[tier]), `${tier} head uses its material midtone`);
  assert.ok(colors.has(HANDLE_WOOD) && colors.has(HANDLE_HIGHLIGHT),
    `${tier} keeps two-tone wooden handle`);
  assert.ok(colors.has(OUTLINE), `${tier} keeps dark silhouette outline`);
  // Head plate is material-colored; grip is wood
  const headPlate = colorAt(itemId, 8, 2);
  assert.ok(headPlate && headPlate !== HANDLE_WOOD && headPlate !== HANDLE_HIGHLIGHT,
    `${tier} head plate is material, not wood`);
  assert.equal(colorAt(itemId, 2, 13), HANDLE_WOOD, `${tier} grip core is wood`);
  assert.equal(colorAt(itemId, 4, 13), OUTLINE, `${tier} grip keeps outer outline`);
}

// Highlight / shade remain distinct from midtone on iron
assert.ok(colorAt("iron_pickaxe", 4, 2) === "#e2e6e3" || colorAt("iron_pickaxe", 5, 2) === "#e2e6e3",
  "iron head keeps a light ridge");
assert.ok(colorAt("iron_pickaxe", 9, 2) === "#929693" || colorAt("iron_pickaxe", 10, 4) === "#929693",
  "iron tips keep a shaded edge");

// --- Non-pickaxe silhouettes preserved ---
const axeCells = occupancy("iron_axe");
for (const cell of ["15:2", "15:5", "8:7", "2:14"] as const) {
  assert.ok(axeCells.has(cell), `axe landmark ${cell} unchanged`);
}
const shovelCells = occupancy("iron_shovel");
for (const cell of ["10:1", "14:2", "11:7", "2:14"] as const) {
  assert.ok(shovelCells.has(cell), `shovel landmark ${cell} unchanged`);
}
const swordCells = occupancy("iron_sword");
for (const cell of ["13:1", "14:2", "3:8", "1:13"] as const) {
  assert.ok(swordCells.has(cell), `sword landmark ${cell} unchanged`);
}
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
assert.ok(verts > 0 && verts === 1_008, "pickaxe extrudes to the reviewed vertex fixture");
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
assert.ok(FIRST_PERSON_PICKAXE_PRESENTATION.depth < FIRST_PERSON_TOOL_PRESENTATION.depth,
  "pickaxe extrusion is thinner than the shared non-pickaxe tool depth");
assert.ok(Math.abs(FIRST_PERSON_PICKAXE_PRESENTATION.rotationDegrees[1] - 180) <= 8,
  "pickaxe Y rotation mirrors grip into the lower-right hand near 180°");
assert.notDeepEqual(
  [...FIRST_PERSON_PICKAXE_PRESENTATION.rotationDegrees],
  [...FIRST_PERSON_TOOL_PRESENTATION.rotationDegrees],
  "pickaxe pose is distinct from axe/shovel/sword presentation",
);

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
assert.equal(renderer[2][0], 1_008, "held pickaxe vertex count matches inventory extrusion");
const pick = spatialBounds(pickUpload, renderer[2][0]);
assert.ok(pick.width > 0.55 && pick.height > 0.8, "held pickaxe keeps tall handle + broad head");
assert.ok(pick.depth > 0.12 && pick.depth < 0.32, "held pickaxe depth is thin, not a cube sculpture");

const wideProjection = perspective(16 / 9);
const pickMvp = renderer[6](new Float32Array(16), wideProjection, 0, false);
const pickViewport = ndcBounds(pickUpload, renderer[2][0], pickMvp);
const gripNdc = ndcOfPixel(3, 13, FIRST_PERSON_PICKAXE_PRESENTATION, pickMvp);
const crownNdc = ndcOfPixel(8, 2, FIRST_PERSON_PICKAXE_PRESENTATION, pickMvp);
console.log(JSON.stringify({ pickViewport, gripNdc, crownNdc }));
assert.ok(pickViewport.minX > 0.2 && pickViewport.minX < 0.5,
  "the visible pickaxe begins in the middle-right rather than centered broadside");
assert.ok(pickViewport.maxX >= 0.98, "the pickaxe reaches or crops through the right viewport edge");
assert.ok(pickViewport.minY <= -0.98, "the lower handle reaches or crops through the bottom viewport edge");
assert.ok(pickViewport.maxY > -0.2 && pickViewport.maxY < 0.12,
  "the head stays around the mid-right horizon instead of filling the screen");
assert.ok(gripNdc[0] > 0.72 && gripNdc[1] < -0.62, "grip sits low/right at the hand socket");
assert.ok(crownNdc[1] > gripNdc[1] + 0.35, "head sits clearly above the grip");
assert.ok(crownNdc[0] < gripNdc[0] - 0.06, "the mirrored head extends leftward from the lower-right grip");

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
const axeUpload = capture.uploads.get(1);
assert.ok(axeUpload);
const axe = spatialBounds(axeUpload, renderer[2][0]);
assert.ok(axe.depth > 0.2, "axe retains the thicker shared tool cant");
assert.equal(renderer[2][0], appendItemSpriteGeometry([], getItemIconArt("iron_axe")),
  "axe held geometry still matches its inventory sprite topology");
const axeMvp = renderer[6](new Float32Array(16), wideProjection, 0, false);
const baselineMvp = writeFirstPersonModelMatrix(
  new Float32Array(16),
  [0, 0, 0, 0, 0, 0],
  FIRST_PERSON_TUNING,
);
assert.ok(Math.abs(axeMvp[0] - wideProjection[0] * baselineMvp[0]) < 0.000001,
  "pickaxe viewport anchoring does not alter the non-picked axe projection");

renderer[3]("iron_sword", BLOCK.AIR);
assert.equal(renderer[2][0], appendItemSpriteGeometry([], getItemIconArt("iron_sword")),
  "sword held geometry is unchanged by the pickaxe-only presentation path");

// Renderer source keeps pickaxe branch isolated
const rendererSource = readFileSync(new URL("../client/game/firstPersonRenderer.ts", import.meta.url), "utf8");
assert.ok(rendererSource.includes("FIRST_PERSON_PICKAXE_PRESENTATION"),
  "first-person path references the pickaxe-specific presentation");
assert.ok(rendererSource.includes("isPickaxeItem"),
  "pickaxe detection is explicit rather than retuning every handheld tool");
assert.ok(rendererSource.includes("FIRST_PERSON_TOOL_PRESENTATION"),
  "non-pickaxe tools keep a named shared presentation");

// Every catalogued pickaxe item id is a tool with kind pickaxe
for (const itemId of Object.keys(ITEMS) as ItemId[]) {
  if (!itemId.endsWith("_pickaxe")) continue;
  assert.equal(ITEMS[itemId].tool?.kind, "pickaxe");
  assert.equal(isPickaxeItem(itemId), true);
}

renderer[7]();
console.log("pickaxe held fidelity regressions passed");
