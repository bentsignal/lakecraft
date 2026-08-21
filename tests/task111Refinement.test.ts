import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  TARGET_OUTLINE_COLOR,
  TARGET_OUTLINE_VERTEX_COUNT,
  bypassBlockInteractionForPlacement,
  writeTargetOutlineGeometry,
} from "../client/game/voxelEngine.ts";
import { BLOCK, type BlockTarget } from "../client/game/types.ts";
import { STONE_BRICK_SLAB_HEIGHT } from "../client/game/blockGeometry.ts";

function blockTarget(block: BlockTarget["block"]): BlockTarget {
  return { block, place: { x: block.x, y: block.y + 1, z: block.z }, distance: 2 };
}

const backing = new Float32Array(TARGET_OUTLINE_VERTEX_COUNT * 6 + 2).fill(99);
const geometry = backing.subarray(1, backing.length - 1);
const fullTarget = blockTarget({ x: 10, y: 20, z: -4, block: BLOCK.STONE });
assert.equal(writeTargetOutlineGeometry(geometry, fullTarget), TARGET_OUTLINE_VERTEX_COUNT);
assert.equal(backing[0], 99);
assert.equal(backing[backing.length - 1], 99, "the retained writer stays inside its supplied view");

const xs: number[] = [];
const ys: number[] = [];
const zs: number[] = [];
for (let vertex = 0; vertex < TARGET_OUTLINE_VERTEX_COUNT; vertex += 1) {
  const offset = vertex * 6;
  xs.push(geometry[offset]);
  ys.push(geometry[offset + 1]);
  zs.push(geometry[offset + 2]);
  for (const color of geometry.subarray(offset + 3, offset + 6)) {
    assert.ok(Math.abs(color - TARGET_OUTLINE_COLOR) < 0.000001);
  }
}
assert.ok(TARGET_OUTLINE_COLOR > 0 && TARGET_OUTLINE_COLOR < 0.3,
  "aimed blocks use a visible dark wireframe instead of a bright white outline");
assert.ok(Math.abs(Math.min(...xs) - 9.997) < 0.00001);
assert.ok(Math.abs(Math.max(...xs) - 11.003) < 0.00001);
assert.ok(Math.abs(Math.min(...ys) - 19.997) < 0.00001);
assert.ok(Math.abs(Math.max(...ys) - 21.003) < 0.00001);
assert.ok(Math.abs(Math.min(...zs) - -4.003) < 0.00001);
assert.ok(Math.abs(Math.max(...zs) - -2.997) < 0.00001);

const firstWrite = geometry.slice();
assert.equal(writeTargetOutlineGeometry(geometry, fullTarget), TARGET_OUTLINE_VERTEX_COUNT);
assert.deepEqual(geometry, firstWrite, "repeated writes are byte-stable and need no replacement allocation");

const slabGeometry = new Float32Array(TARGET_OUTLINE_VERTEX_COUNT * 6);
writeTargetOutlineGeometry(
  slabGeometry,
  blockTarget({ x: -100_000, y: 4, z: 99_999, block: BLOCK.STONE_BRICK_SLAB }),
);
const slabYs = Array.from({ length: TARGET_OUTLINE_VERTEX_COUNT }, (_, vertex) => slabGeometry[vertex * 6 + 1]);
assert.ok(Math.abs(Math.max(...slabYs) - (4 + STONE_BRICK_SLAB_HEIGHT + 0.003)) < 0.00001);
const undersized = new Float32Array(10).fill(7);
assert.equal(writeTargetOutlineGeometry(undersized, fullTarget), 0);
assert.deepEqual(Array.from(undersized), Array(10).fill(7));

assert.equal(bypassBlockInteractionForPlacement(true, BLOCK.DIRT), true);
assert.equal(bypassBlockInteractionForPlacement(true, BLOCK.CHEST), true);
assert.equal(bypassBlockInteractionForPlacement(true, BLOCK.AIR), false, "non-placeable item selections keep normal use behavior");
assert.equal(bypassBlockInteractionForPlacement(false, BLOCK.DIRT), false);

const source = await readFile(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");
assert.ok(source.includes("gl.bufferData(gl.ARRAY_BUFFER, targetOutlineGeometry.byteLength, gl.DYNAMIC_DRAW)"));
assert.ok(source.includes("target = nextTarget;\n      updateTargetOutlineGeometry();"));
const outlineRender = source.slice(
  source.indexOf("if (target) {\n      if (crackVertexCount"),
  source.indexOf("\n\n  function frame", source.indexOf("if (target) {\n      if (crackVertexCount")),
);
assert.doesNotMatch(outlineRender, /bufferData|bufferSubData|new Float32Array|const corners|const lines/,
  "stable aim only binds and draws the retained outline");
const secondaryAction = source.slice(
  source.indexOf("} else if (button === 2)"),
  source.indexOf("const pressedMouseButtons"),
);
assert.ok(secondaryAction.indexOf("useMobUnderCrosshair()") < secondaryAction.indexOf("bypassBlockInteractionForPlacement"),
  "mob use such as shearing keeps first priority");
assert.match(secondaryAction, /if \(target && !bypassBlockInteraction\)/);
assert.ok(secondaryAction.indexOf("!bypassBlockInteraction") < secondaryAction.indexOf("createDoorToggleEdit"));
assert.ok(secondaryAction.indexOf("!bypassBlockInteraction") < secondaryAction.indexOf("tryInteractBlock"));
assert.ok(secondaryAction.indexOf("tryInteractBlock") < secondaryAction.indexOf("tryPlaceSelectedBlock()"),
  "bypassed interactions proceed through existing placement validation");

console.log("task111 sneak-place and retained target-outline tests passed");
