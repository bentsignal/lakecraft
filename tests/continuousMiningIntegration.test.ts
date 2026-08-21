import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");
const primaryHandler = source.slice(
  source.indexOf("if (button === 0)"),
  source.indexOf("} else if (button === 2)"),
);
const primaryRelease = source.slice(
  source.indexOf("function applyCapturedMouseUp"),
  source.indexOf("function onMouseUp"),
);
const updateLoop = source.slice(source.indexOf("function update(dt"), source.indexOf("function bindBuffer"));
const teardown = source.slice(source.indexOf("destroy()"), source.indexOf("applyWorldEdits"));
const pauseHandler = source.slice(source.indexOf("setPaused(nextPaused)"), source.indexOf("isPaused()"));

assert.ok(primaryHandler.includes("pressPrimaryAction(attackedEntity)"), "primary press records whether an entity consumed the click");
assert.ok(primaryHandler.includes("beginHeldBlockMining()"), "a block-facing press starts the first mining cycle immediately");
assert.ok(updateLoop.includes("beginHeldBlockMining();"), "the frame loop reacquires the next ray target while the button stays held");
assert.ok(updateLoop.indexOf("target = nextTarget") < updateLoop.indexOf("beginHeldBlockMining();"), "continuous mining uses the freshly raycast target");
assert.ok(source.includes('emitHandAction("mine");\n        options.onMiningHit?.'), "long digs replay the same arm swing at the bounded hit cadence");
assert.ok(source.includes("miningDurationMs >= (FIRST_PERSON_ACTION_MS + 30) * 2")
  && source.includes("now - lastMiningHitAt >= FIRST_PERSON_ACTION_MS + 30"),
  "short Creative digs use one coherent swing while long digs repeat only completed swings");
assert.ok(primaryRelease.includes("if (button === 0) cancelPrimaryActionHold()"),
  "release cancels the timer and disarms chaining");
assert.match(source, /function onPointerLockChange[\s\S]+cancelPrimaryActionHold\(\)/, "pointer-lock loss cancels a held mine");
assert.ok(teardown.includes("cancelPrimaryActionHold();"), "engine teardown cannot retain a physical-button state");
assert.ok(pauseHandler.includes("cancelPrimaryActionHold();"), "pausing clears the held mine and its world-space crack buffer");
assert.match(source, /miningTimer = window\.setTimeout\([\s\S]{0,260}crackVertexCount = 0;/, "block completion removes the world-space crack geometry before chaining");
assert.match(source, /setSelectedBlock\(block\)[\s\S]{0,180}clearMining\(\)/, "hotbar/tool changes reset current block progress before the held chain restarts");
const crackPass = source.slice(source.indexOf("if (crackVertexCount > 0)"),
  source.indexOf("gl.useProgram(program);", source.indexOf("if (crackVertexCount > 0)")));
assert.ok(crackPass.includes("gl.blendFunc(gl.CONSTANT_ALPHA, gl.ONE_MINUS_CONSTANT_ALPHA)"),
  "the destroy texture blends over the original block instead of replacing it");

console.log("continuous mining engine integration tests passed");
