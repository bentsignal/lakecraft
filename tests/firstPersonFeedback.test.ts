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
assert.equal(renderer.stats.colorVertexCount, 72, "empty hand is exactly two solid six-face prisms");
assert.equal(renderer.stats.texturedVertexCount, 0);
assert.equal(renderer.stats.drawCalls, 1);

renderer.setHeldItem("dirt", BLOCK.DIRT);
assert.deepEqual(
  [renderer.stats.colorVertexCount, renderer.stats.texturedVertexCount, renderer.stats.drawCalls, renderer.stats.lastUploadBytes],
  [72, 36, 2, 2_592],
  "held full blocks reuse one atlas cube plus the two-prism arm in two fixed draws",
);

renderer.setHeldItem("iron_pickaxe", BLOCK.AIR);
assert.equal(renderer.stats.colorVertexCount, 180, "pickaxe is three solid tool boxes plus the two-box arm");
assert.equal(renderer.stats.lastUploadBytes, 4_320);

renderer.setHeldItem("iron_sword", BLOCK.AIR);
assert.equal(renderer.stats.colorVertexCount, 180, "sword is a solid blade, guard, grip, sleeve, and hand");

renderer.setHeldItem("apple", BLOCK.AIR);
assert.equal(renderer.stats.colorVertexCount, 216, "apple/stem/leaf geometry remains compact and solid");

renderer.setHeldItem("bow", BLOCK.AIR);
renderer.setBowCharge(true, 1);
assert.equal(renderer.stats.colorVertexCount, 432, "full bow pose includes solid limbs, string, arrow, and arm under the 18-box ceiling");
assert.equal(renderer.stats.lastUploadBytes, 10_368, "largest staged pose upload remains below 11 KiB");

const idle = sampleFirstPersonAction("attack", FIRST_PERSON_ACTION_MS, false, false);
assert.deepEqual(idle, { translateX: 0, translateY: 0, translateZ: 0, rotateX: 0, rotateZ: 0 });
const swing = sampleFirstPersonAction("attack", FIRST_PERSON_ACTION_MS / 2, false, false);
assert.ok(swing.translateX < -0.4 && swing.rotateZ < -0.6, "attack reaches a clear down-left swing apex");
const eat = sampleFirstPersonAction("use", FIRST_PERSON_ACTION_MS / 2, true, false);
assert.ok(eat.translateY > 0.35 && eat.translateX < -0.29, "food rises toward the center/mouth at its use apex");
assert.deepEqual(
  sampleFirstPersonAction("attack", FIRST_PERSON_ACTION_MS / 2, false, true),
  idle,
  "reduced-motion removes matrix motion without removing geometry",
);

const engine = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");
const gameHud = readFileSync(new URL("../client/components/GameHud.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../client/components/HudStyles.tsx", import.meta.url), "utf8");
assert.ok(engine.includes("createFirstPersonRenderer(gl)"), "the retained viewmodel is created beside the world renderers");
assert.ok(engine.includes("gl.clear(gl.DEPTH_BUFFER_BIT)"), "viewmodel receives a fresh depth plane after world rendering");
assert.ok(engine.includes("firstPersonRenderer.writeMvp"), "actions alter only the small model matrix during frames");
assert.ok(engine.includes("reducedMotionQuery?.matches === true"), "the OS motion preference reaches the WebGL pose sampler");
assert.ok(engine.includes("!firstPersonFeedbackHidden && !paused && playerHealth > 0"), "modal, pause, and death gates suppress every viewmodel draw");
assert.equal(gameHud.includes("FirstPersonHeldItem"), false, "the HUD no longer paints a duplicate DOM hand");
assert.equal(styles.includes("lc-first-person"), false, "the rejected CSS 3D/sprite rig is absent from the artifact");

renderer.destroy();
console.log("retained WebGL first-person renderer tests passed");
