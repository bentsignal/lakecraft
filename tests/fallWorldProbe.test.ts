import assert from "node:assert/strict";
import {
  fallProbeCells,
  fallSupportBlockHasCollision,
  validFallProbeBlock,
} from "../shared/fallWorldProbe.ts";

const centered = fallProbeCells({ x: 10.5, y: 4.02, z: -2.5 });
assert.equal(centered.filter((cell) => cell.support).length, 1, "four foot samples deduplicate inside one block");
assert.deepEqual(
  centered.find((cell) => cell.support),
  { coordKey: "10:3:-3", x: 10, y: 3, z: -3, support: true, slabSupport: false, doorTop: false, ladder: false },
);
assert.deepEqual(
  centered.find((cell) => cell.doorTop),
  { coordKey: "10:2:-3", x: 10, y: 2, z: -3, support: false, slabSupport: false, doorTop: true, ladder: false },
  "the lower closed-door cell can support the player's two-block collision top",
);
assert.equal(centered.filter((cell) => cell.ladder).length, 2, "centered standing body probes two vertical ladder cells");

const corner = fallProbeCells({ x: 10.99, y: 4.02, z: -2.01 });
assert.equal(corner.filter((cell) => cell.support).length, 4, "edge footprint samples all four supporting columns");
assert.ok(corner.length <= 20, "one heartbeat performs a bounded world probe");
assert.deepEqual(fallProbeCells({ x: Number.NaN, y: 0, z: 0 }), []);
const slabHeight = fallProbeCells({ x: 10.5, y: 4.5, z: -2.5 });
assert.equal(slabHeight.some((cell) => cell.support || cell.doorTop), false, "half height never claims a full support surface");
assert.deepEqual(
  slabHeight.find((cell) => cell.slabSupport),
  { coordKey: "10:4:-3", x: 10, y: 4, z: -3, support: false, slabSupport: true, doorTop: false, ladder: true },
  "half-height grounding is authorized only if the sampled cell contains a slab",
);

for (const block of ["grass", "dirt", "stone", "glass", "leaves", "door_closed", "oak_fence_gate_closed", "bed"] as const) {
  assert.equal(fallSupportBlockHasCollision(block), true, `${block} supports the player`);
}
for (const block of ["air", "torch", "door_open", "oak_fence_gate_open", "ladder", "stone_brick_slab",
  "sandstone_slab", "deepslate_tile_slab"] as const) {
  assert.equal(fallSupportBlockHasCollision(block), false, `${block} does not count as solid support`);
}
assert.equal(validFallProbeBlock("ladder"), true);
assert.equal(validFallProbeBlock("water"), false);

console.log("authoritative fall world probe tests passed");
