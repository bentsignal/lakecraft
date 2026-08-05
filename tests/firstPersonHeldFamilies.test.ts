import assert from "node:assert/strict";
import { getBowIconArt, getItemIconArt } from "../client/components/itemIconArt.ts";
import {
  createFirstPersonRenderer,
  firstPersonSpriteFamily,
  firstPersonSpritePresentation,
} from "../client/game/firstPersonRenderer.ts";
import { BLOCK } from "../client/game/types.ts";
import { ITEMS, type ItemId } from "../shared/game.ts";

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
        if (!bound) throw new Error("capture buffer was not bound");
        uploads.set(bound.id, new Float32Array(data as ArrayLike<number>));
      },
      deleteBuffer: () => undefined,
    } as unknown as WebGLRenderingContext,
  };
}

function perspective(aspect: number): Float32Array {
  const projection = new Float32Array(16);
  const near = 0.05; const far = 90;
  const f = 1 / Math.tan(70 * Math.PI / 360);
  projection[0] = f / aspect; projection[5] = f;
  projection[10] = (far + near) / (near - far); projection[11] = -1;
  projection[14] = 2 * far * near / (near - far);
  return projection;
}

type Bounds = Readonly<{ minX: number; maxX: number; minY: number; maxY: number }>;
function visibleFraction(bounds: Bounds): number {
  const visibleWidth = Math.max(0, Math.min(1, bounds.maxX) - Math.max(-1, bounds.minX));
  const visibleHeight = Math.max(0, Math.min(1, bounds.maxY) - Math.max(-1, bounds.minY));
  return visibleWidth * visibleHeight
    / ((bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY));
}
function projectedBounds(
  data: Float32Array,
  vertexCount: number,
  mvp: Float32Array,
  include: (offset: number) => boolean = () => true,
): Bounds {
  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const offset = vertex * 6;
    if (!include(offset)) continue;
    const x = data[offset]; const y = data[offset + 1]; const z = data[offset + 2];
    const w = mvp[3] * x + mvp[7] * y + mvp[11] * z + mvp[15];
    assert.ok(w > 0, "held geometry remains in front of the camera");
    const screenX = (mvp[0] * x + mvp[4] * y + mvp[8] * z + mvp[12]) / w;
    const screenY = (mvp[1] * x + mvp[5] * y + mvp[9] * z + mvp[13]) / w;
    minX = Math.min(minX, screenX); maxX = Math.max(maxX, screenX);
    minY = Math.min(minY, screenY); maxY = Math.max(maxY, screenY);
  }
  return { minX, maxX, minY, maxY };
}

const capture = captureGl();
const renderer = createFirstPersonRenderer(capture.gl);
const projection = perspective(16 / 9);
function render(itemId: ItemId, drawn = false): Bounds {
  renderer[3](itemId, BLOCK.AIR);
  renderer[4](drawn, drawn ? 1 : 0);
  const upload = capture.uploads.get(1);
  if (!upload) throw new Error(`${itemId} color upload missing`);
  return projectedBounds(upload, renderer[2][0], renderer[6](new Float32Array(16), projection, 0, false));
}

assert.equal(firstPersonSpriteFamily("iron_pickaxe"), "pickaxe");
assert.equal(firstPersonSpriteFamily("iron_axe"), "axe");
assert.equal(firstPersonSpriteFamily("iron_shovel"), "shovel");
assert.equal(firstPersonSpriteFamily("iron_sword"), "sword");
assert.equal(firstPersonSpriteFamily("bow"), "bowIdle");
assert.equal(firstPersonSpriteFamily("bow", true), "bowDraw");
assert.equal(firstPersonSpriteFamily("shears"), "shears");
assert.equal(firstPersonSpriteFamily("flint_and_steel"), "flintSteel");
assert.equal(firstPersonSpriteFamily("apple"), "food");
assert.equal(firstPersonSpriteFamily("iron_ingot"), "material");
assert.equal(firstPersonSpriteFamily("torch"), "specialBlock");

const pickaxe = render("iron_pickaxe");
const axe = render("iron_axe");
const shovel = render("iron_shovel");
const shovelUpload = capture.uploads.get(1)!;
const shovelHead = projectedBounds(
  shovelUpload,
  renderer[2][0],
  renderer[6](new Float32Array(16), projection, 0, false),
  (offset) => shovelUpload[offset + 3] > 0.35
    && shovelUpload[offset + 4] > shovelUpload[offset + 3] * 0.9
    && shovelUpload[offset + 5] > shovelUpload[offset + 3] * 0.9,
);
const sword = render("iron_sword");
assert.ok(pickaxe.minX > 0.3 && pickaxe.maxX >= 0.98 && pickaxe.minY <= -0.98 && pickaxe.maxY > -0.1,
  "pickaxe matches the supplied middle-right head and cropped lower-right grip envelope");
assert.ok(axe.minX > 0.4 && axe.minX < 0.5 && axe.maxX > 0.97
  && axe.minY < -0.92 && axe.maxY < 0.05,
"axe enters from the right 28% of the viewport and crops at the hand socket");
assert.ok(shovel.minX > 0.65 && shovel.minX < 0.8 && shovel.maxX > 0.95
  && shovel.minY < -0.92 && shovel.maxY < 0.05,
`shovel keeps its narrow head in the right quarter without becoming a centered icon: ${JSON.stringify(shovel)}`);
assert.ok(shovelHead.maxY - shovelHead.minY >= (shovelHead.maxX - shovelHead.minX) * 1.02,
  `shovel head retains enough vertical taper to read as a spade rather than a hammer: ${JSON.stringify(shovelHead)}`);
assert.ok(sword.minX > 0.5 && sword.maxX > 1.15 && sword.minY < -0.98 && sword.maxY > 0.18,
  "sword blade rises from a cropped grip through the reviewed upper-right combat envelope");

const bowIdle = render("bow");
const bowDraw = render("bow", true);
assert.ok(bowIdle.minX > 0.58 && bowIdle.maxX > 0.96
  && bowIdle.minY < -0.96 && bowIdle.maxY > -0.14,
`idle bow remains a tall lower-right silhouette: ${JSON.stringify(bowIdle)}`);
assert.ok(bowDraw.minX < bowIdle.minX - 0.35 && bowDraw.maxX > 0.95,
  "drawing the bow visibly extends the arrow from the right-hand bow toward screen center");
assert.ok(bowDraw.maxY - bowDraw.minY > 0.8,
  "drawn bow retains the tall near-vertical first-person silhouette");

for (const [itemId, expectedFamily] of [
  ["shears", "shears"],
  ["flint_and_steel", "flintSteel"],
  ["apple", "food"],
  ["stick", "material"],
  ["torch", "specialBlock"],
] as const) {
  const bounds = render(itemId);
  assert.equal(firstPersonSpriteFamily(itemId), expectedFamily);
  assert.ok(bounds.minX > 0.45 && bounds.maxX > 0.95 && bounds.minY < -0.85 && bounds.maxY < -0.3,
    `${itemId} stays compact at the lower-right hand instead of displaying broadside at center: ${JSON.stringify(bounds)}`);
}

assert.equal(new Set(["shears", "flint_and_steel", "apple", "stick", "torch"]
  .map((itemId) => JSON.stringify(firstPersonSpritePresentation(itemId as ItemId)))).size, 5,
"utility, food, material, and special-item families keep distinct visible hand sockets");

const heldSpriteIds = Object.keys(ITEMS) as ItemId[];
assert.equal(heldSpriteIds.length, 97, "every selectable item participates in attachment QA, including armor");
for (const itemId of heldSpriteIds) {
  const presentation = firstPersonSpritePresentation(itemId);
  const [pivotX, pivotY] = presentation.pivotPixels;
  assert.ok(getItemIconArt(itemId).runs.some((run) => run.y === Math.floor(pivotY)
    && pivotX >= run.x && pivotX < run.x + run.width),
  `${itemId} uses an opaque grip pixel instead of attaching the hand through transparency`);
  const bounds = render(itemId);
  const visibleWidth = Math.min(1, bounds.maxX) - Math.max(-1, bounds.minX);
  const visibleHeight = Math.min(1, bounds.maxY) - Math.max(-1, bounds.minY);
  assert.ok(visibleWidth > 0.08 && visibleHeight > 0.08 && visibleFraction(bounds) > 0.3,
    `${itemId} keeps a meaningful final-MVP silhouette onscreen: ${JSON.stringify({ bounds, visibleFraction: visibleFraction(bounds) })}`);
}
const shearsBounds = render("shears");
assert.ok(shearsBounds.minX < 0.8 && shearsBounds.maxX <= 1.15 && visibleFraction(shearsBounds) > 0.72,
  `shears keep recognizable blades and both handles onscreen at the lower-right grip: ${JSON.stringify(shearsBounds)}`);
const bowGrip = firstPersonSpritePresentation("bow", true).pivotPixels;
for (const stage of [1, 2, 3] as const) {
  assert.ok(getBowIconArt(stage).runs.some((run) => run.y === bowGrip[1]
    && bowGrip[0] >= run.x && bowGrip[0] < run.x + run.width),
  `drawn bow stage ${stage} keeps its compensated opaque grip socket`);
}

const axeBefore = render("iron_axe");
render("bow", true);
render("iron_pickaxe");
const axeAfter = render("iron_axe");
assert.deepEqual(axeAfter, axeBefore,
  "drawing a bow and selecting a pickaxe cannot leak pose state into the axe family");
assert.notDeepEqual(firstPersonSpritePresentation("iron_axe"), firstPersonSpritePresentation("iron_shovel"),
  "axe and shovel have independently authored hand sockets rather than one arbitrary tool transform");
assert.notDeepEqual(firstPersonSpritePresentation("bow"), firstPersonSpritePresentation("bow", true),
  "idle and drawn bows expose distinct reference-driven presentations");

console.log(JSON.stringify({ benchmark: "first-person held family NDC envelopes", pickaxe, axe, shovel, shovelHead, sword, bowIdle, bowDraw }));
renderer[7]();
