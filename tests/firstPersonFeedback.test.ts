import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getBowIconArt, getItemIconArt } from "../client/components/itemIconArt.ts";
import {
  FIRST_PERSON_ACTION_MS,
  FIRST_PERSON_FOOD_ACTION_MS,
  FIRST_PERSON_MAX_COLOR_VERTICES,
  FIRST_PERSON_MODEL_PIVOT,
  createFirstPersonRenderer,
  firstPersonBufferCapacity,
  sampleFirstPersonAction,
  writeFirstPersonModelMatrix,
} from "../client/game/firstPersonRenderer.ts";
import { appendItemSpriteGeometry } from "../client/game/itemSpriteGeometry.ts";
import { BLOCK } from "../client/game/types.ts";
import { ITEMS, type ItemId } from "../shared/game.ts";

function fakeGl(): WebGLRenderingContext {
  let nextBuffer = 0;
  return {
    ARRAY_BUFFER: 0x8892,
    DYNAMIC_DRAW: 0x88e8,
    createBuffer: () => ({ id: ++nextBuffer }),
    bindBuffer: () => undefined,
    bufferData: () => undefined,
    bufferSubData: () => undefined,
    deleteBuffer: () => undefined,
  } as unknown as WebGLRenderingContext;
}

const capacity = firstPersonBufferCapacity();
assert.equal(capacity[0], FIRST_PERSON_MAX_COLOR_VERTICES);
assert.equal(capacity[1], 36, "one held atlas cube is the complete textured budget");
assert.ok(capacity[2] < 120 * 1_024, "the retained original-sprite plus block buffers stay below 120 KiB");

const renderer = createFirstPersonRenderer(fakeGl());
const stats = renderer[2];
const canonicalHeldSpriteVertices = {
  iron_pickaxe: appendItemSpriteGeometry([], getItemIconArt("iron_pickaxe")),
  iron_sword: appendItemSpriteGeometry([], getItemIconArt("iron_sword")),
  apple: appendItemSpriteGeometry([], getItemIconArt("apple")),
  bow_full_draw: appendItemSpriteGeometry([], getBowIconArt(3)),
};
assert.deepEqual(canonicalHeldSpriteVertices, {
  iron_pickaxe: 1_140,
  iron_sword: 1_356,
  apple: 1_320,
  bow_full_draw: 1_500,
}, "exact held-item fixtures are derived from the current reviewed canonical sprite art");
assert.equal(stats[0], 0, "empty hand no longer uploads a synthetic solid-color arm");
assert.equal(stats[1], 0);
assert.equal(stats[2], 0);

renderer[3]("dirt", BLOCK.DIRT);
assert.deepEqual(
  [stats[0], stats[1], stats[2], stats[3]],
  [0, 36, 1, 864],
  "held full blocks reuse one atlas cube while the standard-skin arm owns its separate batch",
);

renderer[3]("iron_pickaxe", BLOCK.AIR);
assert.equal(stats[0], canonicalHeldSpriteVertices.iron_pickaxe,
  "pickaxe is exactly the canonical opaque-edge pixel sprite");
assert.equal(stats[3], canonicalHeldSpriteVertices.iron_pickaxe * 6 * Float32Array.BYTES_PER_ELEMENT,
  "pickaxe upload bytes stay exactly coupled to its canonical vertex fixture");

renderer[3]("iron_sword", BLOCK.AIR);
assert.equal(stats[0], canonicalHeldSpriteVertices.iron_sword,
  "sword reuses its canonical inventory pixels as held 3D geometry");

renderer[3]("apple", BLOCK.AIR);
assert.equal(stats[0], canonicalHeldSpriteVertices.apple,
  "apple reuses its canonical inventory pixels as held 3D geometry");

renderer[3]("bow", BLOCK.AIR);
renderer[4](true, 1);
assert.equal(stats[0], canonicalHeldSpriteVertices.bow_full_draw,
  "full-draw bow uses its canonical opaque-edge sprite without an unrelated arm");
assert.ok(stats[3] < 40 * 1_024, "exact installed held sprites remain below 40 KiB per retained upload");

const retainedPose = new Float32Array([9, 9, 9, 9, 9, 9]);
const idle = sampleFirstPersonAction(retainedPose, "attack", FIRST_PERSON_ACTION_MS, false, false);
assert.strictEqual(idle, retainedPose, "idle action sampling reuses caller-owned pose storage");
assert.deepEqual([...retainedPose], [0, 0, 0, 0, 0, 0]);
const swing = sampleFirstPersonAction(retainedPose, "attack", FIRST_PERSON_ACTION_MS / 2, false, false);
assert.strictEqual(swing, retainedPose, "active action sampling reuses the same pose object");
assert.ok(
  retainedPose[0] < -0.06
    && retainedPose[2] < -0.07
    && retainedPose[3] < -0.4
    && retainedPose[4] < -0.1
    && retainedPose[5] > 0.18,
  "attack reaches a pitched, yawed, counter-leaning swing apex",
);
assert.equal(FIRST_PERSON_FOOD_ACTION_MS, 1_000, "food use remains visible for one full second");
const eat = sampleFirstPersonAction(retainedPose, "use", FIRST_PERSON_FOOD_ACTION_MS / 2, true, false);
assert.strictEqual(eat, retainedPose, "food action sampling remains allocation-free");
assert.ok(
  retainedPose[1] > 0.14 && retainedPose[0] < -2.2,
  "food shifts decisively toward the lower-center mouth position at its use apex",
);
assert.strictEqual(
  sampleFirstPersonAction(retainedPose, "attack", FIRST_PERSON_ACTION_MS / 2, false, true),
  retainedPose,
  "reduced-motion sampling reuses caller-owned storage",
);
assert.deepEqual(
  [...retainedPose],
  [0, 0, 0, 0, 0, 0],
  "reduced-motion removes matrix motion without removing geometry",
);

function transformPoint(matrix: Float32Array, point: readonly [number, number, number]): [number, number, number] {
  return [
    matrix[0] * point[0] + matrix[4] * point[1] + matrix[8] * point[2] + matrix[12],
    matrix[1] * point[0] + matrix[5] * point[1] + matrix[9] * point[2] + matrix[13],
    matrix[2] * point[0] + matrix[6] * point[1] + matrix[10] * point[2] + matrix[14],
  ];
}

const idleModel = writeFirstPersonModelMatrix(new Float32Array(16), [0, 0, 0, 0, 0, 0]);
sampleFirstPersonAction(retainedPose, "attack", FIRST_PERSON_ACTION_MS / 2, false, false);
const attackModel = writeFirstPersonModelMatrix(new Float32Array(16), retainedPose);
const heldCenter = [0.08, -0.04, -1.32] as const;
const sleeveBase = [0.69, -0.75, -1.24] as const;
const idleHeld = transformPoint(idleModel, heldCenter);
const activeHeld = transformPoint(attackModel, heldCenter);
const idleSleeve = transformPoint(idleModel, sleeveBase);
const activeSleeve = transformPoint(attackModel, sleeveBase);
assert.deepEqual(FIRST_PERSON_MODEL_PIVOT, [0.66, -0.82, -1.2], "the action rig pivots at the lower-right sleeve base");
assert.ok(activeHeld[1] < idleHeld[1] && activeHeld[2] < idleHeld[2], "the held item dips and recedes instead of swelling across the view");
assert.ok(
  Math.abs(activeSleeve[0] - idleSleeve[0]) < Math.abs(activeHeld[0] - idleHeld[0]),
  "the sleeve base stays more planted than the held item during the arc",
);

const projection = new Float32Array(16);
projection[0] = projection[5] = projection[10] = projection[15] = 1;
const retainedMvp = new Float32Array(16);
assert.strictEqual(renderer[6](retainedMvp, projection, 1_000, false), retainedMvp,
  "visible-frame MVP sampling writes into caller-owned matrix storage");
assert.strictEqual(renderer[6](retainedMvp, projection, 1_016, true), retainedMvp,
  "reduced-motion frames reuse the same matrix storage");

const narrowProjection = new Float32Array(projection);
narrowProjection[0] = 2;
narrowProjection[5] = 1;
renderer[6](retainedMvp, narrowProjection, 1_016, false);
assert.ok(Math.abs(retainedMvp[0]) > 1,
  "viewmodels preserve the real camera projection instead of replacing it with a square HUD projection");

for (const itemId of Object.keys(ITEMS) as ItemId[]) {
  renderer[3](itemId, BLOCK.AIR);
  if (itemId === "bow") renderer[4](true, 1);
  assert.ok(stats[0] <= capacity[0],
    `${itemId} stays inside the retained color capacity`);
  assert.ok(stats[1] <= capacity[1],
    `${itemId} stays inside the retained atlas capacity`);
}
for (const block of Object.values(BLOCK)) {
  renderer[3]("dirt", block);
  assert.ok(stats[0] <= capacity[0]
    && stats[1] <= capacity[1],
  `canonical block ${block} stays inside both retained buffers`);
}

const engine = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");
const singlePlayer = readFileSync(new URL("../client/singleplayer/SinglePlayerApp.tsx", import.meta.url), "utf8");
const rendererSource = readFileSync(new URL("../client/game/firstPersonRenderer.ts", import.meta.url), "utf8");
const gameHud = readFileSync(new URL("../client/components/GameHud.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../client/components/HudStyles.tsx", import.meta.url), "utf8");
assert.ok(engine.includes("createFirstPersonRenderer(gl)"), "the retained viewmodel is created beside the world renderers");
assert.ok(engine.includes("createFirstPersonSkinRenderer(gl)"), "the standard-skin arm owns a separate retained texture batch");
assert.ok(engine.includes("if (selectedItem === null)"),
  "the skin arm renders only for an empty slot instead of underneath held items");
assert.ok(engine.includes("gl.clear(gl.DEPTH_BUFFER_BIT)"), "viewmodel receives a fresh depth plane after world rendering");
assert.ok(engine.includes("writeFirstPersonMvp"), "actions alter only the small model matrix during frames");
assert.ok(rendererSource.includes("const actionPose: FirstPersonActionPose"), "the renderer retains one mutable action pose");
const actionSamplerSource = rendererSource.slice(
  rendererSource.indexOf("export function sampleFirstPersonAction"),
  rendererSource.indexOf("function writeModelMatrix"),
);
assert.equal(actionSamplerSource.includes("return {"), false, "the per-frame action sampler creates no pose object literals");
assert.equal(actionSamplerSource.includes("const idle"), false, "idle and reduced-motion frames allocate no fallback pose");
assert.ok(engine.includes("reducedMotionQuery?.matches === true"), "the OS motion preference reaches the WebGL pose sampler");
assert.ok(engine.includes("!firstPersonFeedbackHidden && playerHealth > 0"),
  "blocking UI and death hide the viewmodel without making Game Menu hide the pose lab");
assert.match(engine, /if \(paused && !firstPersonFeedbackHidden && playerHealth > 0[\s\S]{0,100}document\.visibilityState === "visible"\) \{[\s\S]{0,100}render\(pausedVisualTime, 0, pausedVisualTime\)/,
  "an HMR-remounted paused engine seeds a complete fresh pose preview");
assert.ok(engine.includes("now - lastPausedRenderAt >= PAUSED_RENDER_INTERVAL_MS")
  && engine.includes("render(pausedVisualTime, 0, pausedVisualTime, false)"),
  "paused engines keep the viewmodel composited at a bounded cadence without refreshing dynamic geometry");
assert.match(engine, /if \(!firstPersonFeedbackHidden && playerHealth > 0[\s\S]{0,100}document\.visibilityState === "visible"/,
  "hidden, dead, and backgrounded paused engines perform no compositor redraw");
const localFeedbackCalls = [...singlePlayer.matchAll(/setFirstPersonFeedbackHidden\(([\s\S]*?)\);/g)]
  .map((match) => match[1]);
assert.ok(localFeedbackCalls.length >= 2 && localFeedbackCalls.every((predicate) => !predicate.includes("pauseOpen")),
  "Game Menu alone keeps the held pose visible while every other blocking surface may hide it");
assert.ok(localFeedbackCalls.every((predicate) => !predicate.includes("pointerCaptureNeeded")),
  "Click to Play keeps the held pose visible while pointer capture is recovered");
assert.ok(localFeedbackCalls.every((predicate) => !predicate.includes("inventoryOpen")),
  "the inventory keeps the active arm-or-item presentation visible behind its workspace");
assert.equal(gameHud.includes("FirstPersonHeldItem"), false, "the HUD no longer paints a duplicate DOM hand");
assert.equal(styles.includes("lc-first-person"), false, "the rejected CSS 3D/sprite rig is absent from the artifact");

renderer[7]();
console.log("retained WebGL first-person renderer tests passed");
