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
const diagnostics = readFileSync(new URL("../client/gameplayDiagnostics.tsx", import.meta.url), "utf8");
const surface = readFileSync(new URL("../client/gameplay/GameplaySessionSurface.tsx", import.meta.url), "utf8");
assert.equal(singleplayer.includes("SINGLE-PLAYER · LOCAL SAVE · 0 LAKEBED REQUESTS"), false);
assert.equal(singleplayer.includes("Browser-local: no Google account and zero Lakebed requests."), false);
assert.ok(singleplayer.includes("GameplaySessionSurface") && surface.includes("GameplayDiagnostics") && diagnostics.includes("XYZ: {x} / {y} / {z}"));
assert.ok(singleplayer.includes("onPoseChange"), "coordinates are driven by the local engine pose callback");
const presentation = readFileSync(new URL("../client/gameplay/presentation.ts", import.meta.url), "utf8");
assert.ok(presentation.includes("onHotbarSelect: context.selectHotbar"));
assert.ok(presentation.includes("onHotbarCycle:"));
assert.ok(singleplayer.includes("selectHotbar,") && multiplayer.includes("selectHotbar: handleSelectHotbar"),
  "both modes inject their state sink into one pointer-lock-gated hotbar rule");
const multiplayerKeyHandler = multiplayer.slice(multiplayer.indexOf("const onKey = (event: KeyboardEvent)"), multiplayer.indexOf("const onKeyUp =", multiplayer.indexOf("const onKey = (event: KeyboardEvent)")));
assert.doesNotMatch(multiplayerKeyHandler, /\^Digit\[1-9\]/, "a global key handler cannot select slots behind menus");
assert.ok(multiplayer.includes("modalOpen={chatOpen}"),
  "multiplayer chat hides the shared survival HUD and selected-item caption");
assert.ok(engine.includes('document.pointerLockElement !== canvas'), "engine input remains gated on pointer lock");
assert.ok(engine.includes("appendWorldBlockCrackLines(crackLines, target.block"), "cracks use target.block, never target.place");
assert.ok(engine.includes("function updateMiningCrackGeometry()"), "crack geometry uploads only when bounded progress changes, not every render");
assert.ok(surface.includes('role="status" aria-live="polite"><strong>Loading world</strong>'),
  "world entry renders a blocking, announced loading state before terrain is ready");
assert.ok(surface.includes("ready && pointerCapture?.visible"),
  "Click to Play cannot cover or compete with initial world loading");
const streamingWindow = engine.slice(
  engine.indexOf("function updateStreamingWindow("),
  engine.indexOf("function setBlock(", engine.indexOf("function updateStreamingWindow(")),
);
assert.doesNotMatch(streamingWindow, /loadTerrainChunk\(|unloadTerrainChunk\(/,
  "crossing a chunk only replans bounded work; it never materializes the whole edge synchronously");
assert.match(engine, /if \(paused\) \{\s+const processedTerrain = processPendingTerrainChunks\(\);\s+if \(!processedTerrain\) processPendingChunkMeshes\(\);/,
  "paused render-distance changes continue through one bounded terrain or mesh queue step per frame");

console.log("single-player playtest polish tests passed");
