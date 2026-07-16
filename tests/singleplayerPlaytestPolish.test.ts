import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  WORLD_BLOCK_CRACK_EPSILON,
  appendWorldBlockCrackLines,
  worldBlockCrackStage,
} from "../client/game/blockCracks.ts";
import {
  cycleHotbarIndex,
  hotbarIndexForDigitCode,
  hotbarWheelDirection,
} from "../client/game/hotbarInput.ts";

assert.equal(hotbarIndexForDigitCode("Digit1"), 0);
assert.equal(hotbarIndexForDigitCode("Digit9"), 8);
assert.equal(hotbarIndexForDigitCode("Numpad1"), null, "only the physical top-row binding selects slots");
assert.equal(hotbarIndexForDigitCode("Digit0"), null);
assert.equal(hotbarWheelDirection(120), 1);
assert.equal(hotbarWheelDirection(-0.1), -1);
assert.equal(hotbarWheelDirection(0), 0);
assert.equal(cycleHotbarIndex(8, 1), 0, "wheel cycling wraps right");
assert.equal(cycleHotbarIndex(0, -1), 8, "wheel cycling wraps left");

assert.equal(worldBlockCrackStage(0), -1);
assert.equal(worldBlockCrackStage(0.01), 0);
assert.equal(worldBlockCrackStage(0.99), 9);
const block = { x: -3, y: 7, z: 11 };
const vertices: number[] = [];
const vertexCount = appendWorldBlockCrackLines(vertices, block, 0.51);
assert.equal(vertexCount, 72, "six crack branches are projected onto all six faces");
assert.equal(vertices.length, vertexCount * 6, "each line vertex has interleaved position and color");
for (let offset = 0; offset < vertices.length; offset += 6) {
  const [x, y, z] = vertices.slice(offset, offset + 3);
  assert.ok(x >= block.x - WORLD_BLOCK_CRACK_EPSILON && x <= block.x + 1 + WORLD_BLOCK_CRACK_EPSILON);
  assert.ok(y >= block.y - WORLD_BLOCK_CRACK_EPSILON && y <= block.y + 1 + WORLD_BLOCK_CRACK_EPSILON);
  assert.ok(z >= block.z - WORLD_BLOCK_CRACK_EPSILON && z <= block.z + 1 + WORLD_BLOCK_CRACK_EPSILON);
  const onTargetFace = [
    Math.abs(x - (block.x - WORLD_BLOCK_CRACK_EPSILON)),
    Math.abs(x - (block.x + 1 + WORLD_BLOCK_CRACK_EPSILON)),
    Math.abs(y - (block.y - WORLD_BLOCK_CRACK_EPSILON)),
    Math.abs(y - (block.y + 1 + WORLD_BLOCK_CRACK_EPSILON)),
    Math.abs(z - (block.z - WORLD_BLOCK_CRACK_EPSILON)),
    Math.abs(z - (block.z + 1 + WORLD_BLOCK_CRACK_EPSILON)),
  ].some((distance) => distance < 1e-9);
  assert.equal(onTargetFace, true, "every crack vertex stays on the mined solid block's face");
}

const singleplayer = readFileSync(new URL("../client/singleplayer/SinglePlayerApp.tsx", import.meta.url), "utf8");
const multiplayer = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");
const engine = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");
assert.equal(singleplayer.includes("SINGLE-PLAYER · LOCAL SAVE · 0 LAKEBED REQUESTS"), false);
assert.equal(singleplayer.includes("Browser-local: no Google account and zero Lakebed requests."), false);
assert.ok(singleplayer.includes("XYZ: {coordinates.x} / {coordinates.y} / {coordinates.z}"));
assert.ok(singleplayer.includes("onPoseChange"), "coordinates are driven by the local engine pose callback");
assert.ok(singleplayer.includes("onHotbarSelect: selectHotbar"));
assert.ok(singleplayer.includes("onHotbarCycle:"));
assert.ok(multiplayer.includes("onHotbarSelect: handleSelectHotbar"), "multiplayer number keys use pointer-lock-gated engine input");
assert.ok(multiplayer.includes("onHotbarCycle: (direction) => handleSelectHotbar(cycleHotbarIndex"), "multiplayer wheel selection is wired");
const multiplayerKeyHandler = multiplayer.slice(multiplayer.indexOf("const onKey = (event: KeyboardEvent)"), multiplayer.indexOf("const onKeyUp =", multiplayer.indexOf("const onKey = (event: KeyboardEvent)")));
assert.doesNotMatch(multiplayerKeyHandler, /\^Digit\[1-9\]/, "a global key handler cannot select slots behind menus");
assert.ok(multiplayer.includes("modalOpen={chatOpen || furnaceOpen || Boolean(activeChestKey) || Boolean(activeBedKey)}"),
  "multiplayer chat and world drawers hide the shared survival HUD and selected-item caption");
assert.ok(engine.includes('document.pointerLockElement !== canvas'), "engine input remains gated on pointer lock");
assert.ok(engine.includes("appendWorldBlockCrackLines(crackLines, target.block"), "cracks use target.block, never target.place");
assert.ok(engine.includes("function updateMiningCrackGeometry()"), "crack geometry uploads only when bounded progress changes, not every render");

console.log("single-player playtest polish tests passed");
