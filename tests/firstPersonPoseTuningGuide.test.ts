import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createFirstPersonRenderer,
  firstPersonHeldItemTuningGroup,
  firstPersonHeldBlockAlphaCutoff,
} from "../client/game/firstPersonRenderer.ts";
import { blockIdForCubeItem } from "../client/game/blockItemCubeGeometry.ts";
import {
  FIRST_PERSON_TUNING,
  currentFirstPersonTuning,
  publishFirstPersonTuning,
} from "../client/game/firstPersonTuning.ts";
import { BLOCK } from "../client/game/types.ts";

const tuningSource = readFileSync(new URL("../client/game/firstPersonTuning.ts", import.meta.url), "utf8");
const guide = readFileSync(new URL("../docs/design/first-person-pose-tuning.md", import.meta.url), "utf8");
const engine = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");
const singlePlayer = readFileSync(new URL("../client/singleplayer/SinglePlayerApp.tsx", import.meta.url), "utf8");
const poseLab = readFileSync(new URL("../client/components/FirstPersonPoseLab.tsx", import.meta.url), "utf8");
const firstPersonRendererSource = readFileSync(new URL("../client/game/firstPersonRenderer.ts", import.meta.url), "utf8");
const blockItemCubeSource = readFileSync(new URL("../client/game/blockItemCubeGeometry.ts", import.meta.url), "utf8");

for (const group of ["arm", "tool", "bow", "otherItem"] as const) {
  for (const value of [
    ...FIRST_PERSON_TUNING[group].position,
    ...FIRST_PERSON_TUNING[group].rotationDegrees,
    ...FIRST_PERSON_TUNING[group].pivot,
    FIRST_PERSON_TUNING[group].scale,
  ]) assert.ok(Number.isFinite(value), `${group} stays finite while the user tunes it`);
  assert.ok(FIRST_PERSON_TUNING[group].scale > 0, `${group} keeps a visible positive scale`);
  assert.match(tuningSource, new RegExp("EDIT `" + group + "` FOR", "i"),
    `${group} has a literal human-facing edit label`);
}
assert.deepEqual(FIRST_PERSON_TUNING.arm.position, [-0.37, 0.23, 0],
  "the accepted empty-hand screen anchor is preserved");
assert.deepEqual(FIRST_PERSON_TUNING.arm.rotationDegrees, [1, -41, -1],
  "the accepted empty-hand orientation is preserved");
assert.equal(FIRST_PERSON_TUNING.arm.scale, 1, "the accepted empty-hand scale is preserved");
assert.equal(tuningSource.includes("unchanged("), false, "every user-editable group is an explicit object");
assert.match(tuningSource, /LEAVE THIS ALONE AT FIRST[^\n]*`rig`/,
  "the global rig cannot be mistaken for the first tuning target");
assert.match(tuningSource, /X: bigger moves RIGHT; smaller moves LEFT/);
assert.match(tuningSource, /position:[^\n]*change by 0\.02/);
assert.match(tuningSource, /rotationDegrees: change by 5/);

assert.equal(firstPersonHeldItemTuningGroup("dirt", BLOCK.DIRT), "block",
  "a full atlas cube uses the block knobs");
assert.equal(firstPersonHeldItemTuningGroup("planks", BLOCK.PLANKS), "block",
  "another full cube uses the block knobs");
for (const [itemId, block] of [
  ["torch", BLOCK.TORCH],
  ["chest", BLOCK.CHEST],
  ["bed", BLOCK.BED],
  ["door", BLOCK.DOOR_CLOSED],
  ["ladder", BLOCK.LADDER],
  ["oak_fence", BLOCK.OAK_FENCE],
  ["oak_fence_gate", BLOCK.OAK_FENCE_GATE_CLOSED],
  ["sapling", BLOCK.SAPLING],
] as const) {
  assert.equal(firstPersonHeldItemTuningGroup(itemId, block), "otherItem",
    `${itemId} is a special-shaped block item and uses the otherItem knobs`);
}
assert.equal(firstPersonHeldItemTuningGroup("stone_brick_slab", BLOCK.STONE_BRICK_SLAB), "block",
  "the slab shares the exact textured 3D block pose instead of an enlarged flat sprite");
assert.equal(blockIdForCubeItem("stone_brick_slab"), null,
  "the slab is excluded from the executable canonical full-cube item path");
assert.doesNotMatch(blockItemCubeSource, /stone_brick_slab:\s*BLOCK\.STONE_BRICK_SLAB/,
  "the closed full-cube item map cannot silently reclassify the slab");
assert.match(firstPersonRendererSource, /function appendSocketedTexturedShape[\s\S]*?isSlabBlock\(block\)[\s\S]*?isStairBlock\(block\)/,
  "the block pose emits bounded authored slab and stair geometry");
assert.equal(firstPersonHeldItemTuningGroup("iron_pickaxe", BLOCK.AIR), "tool");
assert.equal(firstPersonHeldItemTuningGroup("bow", BLOCK.AIR), "bow");
assert.equal(firstPersonHeldItemTuningGroup("apple", BLOCK.AIR), "otherItem");
assert.equal(firstPersonHeldItemTuningGroup(null, BLOCK.AIR), null);
assert.equal(firstPersonHeldBlockAlphaCutoff("glass"), 0.02,
  "first-person glass keeps its authored low-alpha frame pixels");
assert.equal(firstPersonHeldBlockAlphaCutoff("red_stained_glass"), 0.02,
  "stained-glass viewmodels share the visible transparent cutoff");
assert.equal(firstPersonHeldBlockAlphaCutoff("dirt"), 0.08,
  "opaque held blocks retain the established alpha cutoff");
assert.ok(engine.includes("firstPersonHeldBlockAlphaCutoff(selectedItem)"),
  "the live viewmodel render path uses the item-aware glass cutoff");

for (const target of ["block", "tool", "bow", "arm", "otherItem", "rig"]) {
  assert.match(guide, new RegExp(`\\b${target}\\b`), `the guide names ${target}`);
}
assert.match(guide, /POSE LAB/);
assert.match(guide, /Reset this group/);
assert.match(guide, /do not need to save a file, unpause, click the game, or refresh the browser/i);
assert.match(guide, /normal full cube[^\n]*dirt, stone, or planks[^\n]*`block`/i);
assert.match(guide, /special held block item[^\n]*torch, chest, bed, door/i);
assert.equal(guide.includes("hoe"), false, "the guide lists only implemented tool kinds");

assert.match(engine, /if \(paused && document\.visibilityState === "visible"\) \{[\s\S]{0,100}render\(pausedVisualTime, 0, pausedVisualTime\)/,
  "a paused HMR remount seeds the shared world even when UI hides the held pose");
assert.ok(engine.includes("now - lastPausedRenderAt >= PAUSED_RENDER_INTERVAL_MS")
  && engine.includes("render(pausedRenderTime, 0, now)"),
"the visible paused world and server-driven actors continue redrawing at bounded cadence");
const feedbackPredicates = [...singlePlayer.matchAll(/setFirstPersonFeedbackHidden\(([\s\S]*?)\);/g)]
  .map((match) => match[1]);
assert.ok(feedbackPredicates.length >= 2);
assert.ok(feedbackPredicates.every((predicate) => !predicate.includes("pauseOpen")),
  "Game Menu keeps the paused pose visible");
assert.ok(feedbackPredicates.every((predicate) => !predicate.includes("pointerCaptureNeeded")),
  "Click to Play keeps the paused pose visible");
assert.ok(feedbackPredicates.every((predicate) => !predicate.includes("inventoryOpen")),
  "the inventory keeps the active arm-or-item presentation visible behind its workspace");
assert.ok(singlePlayer.includes("<FirstPersonPoseLab") && poseLab.includes("publishFirstPersonTuning(next)"),
  "the paused surface owns a direct runtime tuning panel instead of pretending source HMR updates WebGL");
for (const label of ["Rotation degrees", "Scale", "Size", "EXCLUSIVE VIEWMODEL"]) {
  assert.ok(poseLab.includes(label), `Pose Lab exposes the ${label} control`);
}
assert.match(poseLab,
  /group === "arm" \? \([\s\S]*Select an empty hotbar slot[\s\S]*Screen anchor offset[\s\S]*Rotation degrees[\s\S]*Scale/,
  "the empty-hand branch exposes live position, rotation, and scale controls instead of a dead note");
assert.equal(poseLab.includes('<VectorInputs label="Position"'), false,
  "the lab no longer exposes arbitrary presentation translation");
assert.equal(poseLab.includes('<VectorInputs label="Pivot (advanced)"'), false,
  "the lab no longer exposes arbitrary floating pivots");

type CapturedBuffer = { id: number };
let nextBufferId = 0;
let boundBuffer: CapturedBuffer | null = null;
const uploads = new Map<number, Float32Array>();
const gl = {
  ARRAY_BUFFER: 0x8892,
  DYNAMIC_DRAW: 0x88e8,
  createBuffer: () => ({ id: ++nextBufferId }),
  bindBuffer: (_target: number, buffer: CapturedBuffer | null) => { boundBuffer = buffer; },
  bufferData: () => undefined,
  bufferSubData: (_target: number, _offset: number, data: ArrayLike<number>) => {
    if (!boundBuffer) throw new Error("pose preview upload had no bound buffer");
    uploads.set(boundBuffer.id, new Float32Array(data));
  },
  deleteBuffer: () => undefined,
} as unknown as WebGLRenderingContext;
const originalSnapshot = currentFirstPersonTuning();
const renderer = createFirstPersonRenderer(gl);
renderer[3]("iron_pickaxe", BLOCK.AIR);
const identityProjection = new Float32Array(16);
identityProjection[0] = identityProjection[5] = identityProjection[10] = identityProjection[15] = 1;
renderer[6](new Float32Array(16), identityProjection, 0, false);
const beforeUpdate = uploads.get(1)?.slice();
if (!beforeUpdate) throw new Error("initial tool upload missing");
const meshUpdatesBefore = renderer[2][5];
publishFirstPersonTuning({
  ...originalSnapshot.tuning,
  tool: {
    ...originalSnapshot.tuning.tool,
    scale: originalSnapshot.tuning.tool.scale + 0.5,
  },
});
renderer[6](new Float32Array(16), identityProjection, 0, false);
const afterUpdate = uploads.get(1);
if (!afterUpdate) throw new Error("live-updated tool upload missing");
assert.equal(renderer[2][5], meshUpdatesBefore + 1,
  "an already-running renderer rebuilds once when the tuning module publishes a new revision");
assert.notDeepEqual(afterUpdate, beforeUpdate,
  "the live revision changes actual retained WebGL geometry rather than only reloading source text");
publishFirstPersonTuning(originalSnapshot.tuning);
renderer[7]();

console.log("first-person pose tuning guide and paused-preview contract tests passed");
