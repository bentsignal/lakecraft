import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const multiplayer = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");
const singleplayer = readFileSync(new URL("../client/singleplayer/SinglePlayerApp.tsx", import.meta.url), "utf8");
const localTree = readFileSync(new URL("../shared/treeGrowth.ts", import.meta.url), "utf8");

assert.doesNotMatch(multiplayer, /growOakTree|treeGrowthBusyRef|retryExactLakebedMutation/,
  "Railway multiplayer cannot commit tree growth through Lakebed");
assert.match(singleplayer, /target\.block\.block === BLOCK\.SAPLING/);
assert.match(singleplayer, /itemId === "bone_meal"/);
assert.match(singleplayer, /planOakTreeGrowth/);
assert.match(localTree, /OAK_TREE_MAX_EDITS/);

console.log("tree-growth authority boundary tests passed");
