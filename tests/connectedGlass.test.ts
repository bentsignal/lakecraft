import assert from "node:assert/strict";
import { CUBE_FACES } from "../client/game/cubeFaces.ts";
import { appendConnectedGlassFace, blockFaceIsOccluded } from "../client/game/voxelEngine.ts";
import { BLOCK } from "../client/game/types.ts";

const east = CUBE_FACES[0];
const mesh = (neighbors: ReadonlySet<string>): number[] => {
  const output: number[] = [];
  appendConnectedGlassFace(output, 4, 5, 6, east,
    (x, y, z) => neighbors.has(`${x},${y},${z}`) ? BLOCK.GLASS : BLOCK.AIR, 1, 4);
  return output;
};

assert.equal(mesh(new Set()).length / 6, 30,
  "an isolated glass face retains its center and all four one-pixel borders");
assert.equal(mesh(new Set(["4,5,5"])).length / 6, 24,
  "one connected neighbor removes exactly the shared border strip");
assert.equal(mesh(new Set(["4,5,5", "4,5,7", "4,4,6", "4,6,6"])).length / 6, 6,
  "a glass wall interior keeps only the transparent texture center");
assert.equal(blockFaceIsOccluded(BLOCK.GLASS, BLOCK.GLASS), true,
  "adjacent glass cells never draw their shared internal face");
assert.equal(blockFaceIsOccluded(BLOCK.GLASS, BLOCK.AIR), false);

console.log("connected glass perimeter and internal-face tests passed");
