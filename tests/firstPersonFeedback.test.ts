import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  FIRST_PERSON_ACTION_MS,
  FIRST_PERSON_MAX_COLOR_VERTICES,
  createFirstPersonRenderer,
  firstPersonBufferCapacity,
  sampleFirstPersonAction,
} from "../client/game/firstPersonRenderer.ts";
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
assert.equal(capacity.colorVertexCount, FIRST_PERSON_MAX_COLOR_VERTICES);
assert.equal(capacity.texturedVertexCount, 36, "one held atlas cube is the complete textured budget");
assert.equal(capacity.totalBytes, 16_416, "the retained first-person buffers stay below 17 KiB");

const renderer = createFirstPersonRenderer(fakeGl());
assert.equal(renderer.stats[0], 72, "empty hand is exactly two solid six-face prisms");
assert.equal(renderer.stats[1], 0);
assert.equal(renderer.stats[2], 1);

renderer.setHeldItem("dirt", BLOCK.DIRT);
assert.deepEqual(
  [renderer.stats[0], renderer.stats[1], renderer.stats[2], renderer.stats[3]],
  [72, 36, 2, 2_592],
  "held full blocks reuse one atlas cube plus the two-prism arm in two fixed draws",
);

renderer.setHeldItem("iron_pickaxe", BLOCK.AIR);
assert.equal(renderer.stats[0], 180, "pickaxe is three solid tool boxes plus the two-box arm");
assert.equal(renderer.stats[3], 4_320);

renderer.setHeldItem("iron_sword", BLOCK.AIR);
assert.equal(renderer.stats[0], 180, "sword is a solid blade, guard, grip, sleeve, and hand");

renderer.setHeldItem("apple", BLOCK.AIR);
assert.equal(renderer.stats[0], 216, "apple/stem/leaf geometry remains compact and solid");

renderer.setHeldItem("bow", BLOCK.AIR);
renderer.setBowCharge(true, 1);
assert.equal(renderer.stats[0], 432, "full bow pose includes solid limbs, string, arrow, and arm under the 18-box ceiling");
assert.equal(renderer.stats[3], 10_368, "largest staged pose upload remains below 11 KiB");

const retainedPose = new Float32Array([9, 9, 9, 9, 9]);
const idle = sampleFirstPersonAction(retainedPose, "attack", FIRST_PERSON_ACTION_MS, false, false);
assert.strictEqual(idle, retainedPose, "idle action sampling reuses caller-owned pose storage");
assert.deepEqual([...retainedPose], [0, 0, 0, 0, 0]);
const swing = sampleFirstPersonAction(retainedPose, "attack", FIRST_PERSON_ACTION_MS / 2, false, false);
assert.strictEqual(swing, retainedPose, "active action sampling reuses the same pose object");
assert.ok(retainedPose[0] < -0.4 && retainedPose[4] < -0.6, "attack reaches a clear down-left swing apex");
const eat = sampleFirstPersonAction(retainedPose, "use", FIRST_PERSON_ACTION_MS / 2, true, false);
assert.strictEqual(eat, retainedPose, "food action sampling remains allocation-free");
assert.ok(retainedPose[1] > 0.35 && retainedPose[0] < -0.29, "food rises toward the center/mouth at its use apex");
assert.strictEqual(
  sampleFirstPersonAction(retainedPose, "attack", FIRST_PERSON_ACTION_MS / 2, false, true),
  retainedPose,
  "reduced-motion sampling reuses caller-owned storage",
);
assert.deepEqual(
  [...retainedPose],
  [0, 0, 0, 0, 0],
  "reduced-motion removes matrix motion without removing geometry",
);

const projection = new Float32Array(16);
projection[0] = projection[5] = projection[10] = projection[15] = 1;
const retainedMvp = new Float32Array(16);
assert.strictEqual(renderer.writeMvp(retainedMvp, projection, 1_000, false), retainedMvp,
  "visible-frame MVP sampling writes into caller-owned matrix storage");
assert.strictEqual(renderer.writeMvp(retainedMvp, projection, 1_016, true), retainedMvp,
  "reduced-motion frames reuse the same matrix storage");

for (const itemId of Object.keys(ITEMS) as ItemId[]) {
  renderer.setHeldItem(itemId, BLOCK.AIR);
  if (itemId === "bow") renderer.setBowCharge(true, 1);
  assert.ok(renderer.stats[0] <= capacity.colorVertexCount,
    `${itemId} stays inside the retained color capacity`);
  assert.ok(renderer.stats[1] <= capacity.texturedVertexCount,
    `${itemId} stays inside the retained atlas capacity`);
}
for (const block of Object.values(BLOCK)) {
  renderer.setHeldItem("dirt", block);
  assert.ok(renderer.stats[0] <= capacity.colorVertexCount
    && renderer.stats[1] <= capacity.texturedVertexCount,
  `canonical block ${block} stays inside both retained buffers`);
}

const engine = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");
const rendererSource = readFileSync(new URL("../client/game/firstPersonRenderer.ts", import.meta.url), "utf8");
const gameHud = readFileSync(new URL("../client/components/GameHud.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../client/components/HudStyles.tsx", import.meta.url), "utf8");
assert.ok(engine.includes("createFirstPersonRenderer(gl)"), "the retained viewmodel is created beside the world renderers");
assert.ok(engine.includes("gl.clear(gl.DEPTH_BUFFER_BIT)"), "viewmodel receives a fresh depth plane after world rendering");
assert.ok(engine.includes("firstPersonRenderer.writeMvp"), "actions alter only the small model matrix during frames");
assert.ok(rendererSource.includes("const actionPose: FirstPersonActionPose"), "the renderer retains one mutable action pose");
const actionSamplerSource = rendererSource.slice(
  rendererSource.indexOf("export function sampleFirstPersonAction"),
  rendererSource.indexOf("function writeModelMatrix"),
);
assert.equal(actionSamplerSource.includes("return {"), false, "the per-frame action sampler creates no pose object literals");
assert.equal(actionSamplerSource.includes("const idle"), false, "idle and reduced-motion frames allocate no fallback pose");
assert.ok(engine.includes("reducedMotionQuery?.matches === true"), "the OS motion preference reaches the WebGL pose sampler");
assert.ok(engine.includes("!firstPersonFeedbackHidden && !paused && playerHealth > 0"), "modal, pause, and death gates suppress every viewmodel draw");
assert.equal(gameHud.includes("FirstPersonHeldItem"), false, "the HUD no longer paints a duplicate DOM hand");
assert.equal(styles.includes("lc-first-person"), false, "the rejected CSS 3D/sprite rig is absent from the artifact");

renderer.destroy();
console.log("retained WebGL first-person renderer tests passed");
