import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveFallingBlocks } from "../shared/fallingBlocks.ts";

const resolution = resolveFallingBlocks({
  trigger: { x: 0, y: 70, z: 0, coordKey: "0:70:0", previousBlock: "dirt", nextBlock: "air" },
  authoritativeCells: [
    { x: 0, y: 68, z: 0, coordKey: "0:68:0", block: "stone", blockInstanceToken: null },
    { x: 0, y: 69, z: 0, coordKey: "0:69:0", block: "air", blockInstanceToken: null },
    { x: 0, y: 70, z: 0, coordKey: "0:70:0", block: "air", blockInstanceToken: null },
    { x: 0, y: 71, z: 0, coordKey: "0:71:0", block: "sand", blockInstanceToken: null },
    { x: 0, y: 72, z: 0, coordKey: "0:72:0", block: "air", blockInstanceToken: null },
  ],
});
assert.equal(resolution.ok, true);
assert.deepEqual(resolution.ok ? resolution.edits.map(({ y, block }) => ({ y, block })) : [], [
  { y: 71, block: "air" }, { y: 69, block: "sand" },
]);

const multiplayer = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");
const offline = readFileSync(new URL("../client/singleplayer/SinglePlayerApp.tsx", import.meta.url), "utf8");
const engine = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");
assert.doesNotMatch(multiplayer, /settledEdits|editWorldBlock/,
  "multiplayer settlement must arrive in Railway world patches, not a Lakebed receipt");
assert.match(offline, /acceptWorldEdits: acceptLocalWorldEdits/);
assert.match(engine, /planLocalFallingBlockSettlement\([\s\S]*?options\.acceptWorldEdits\?\.\(batch\)/);

console.log("falling-block authority split tests passed");
