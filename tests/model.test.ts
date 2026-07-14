import assert from "node:assert/strict";
import {
  RECIPES,
  addItem,
  countItem,
  craftRecipe,
  createEmptyInventory,
  toolEffectiveness,
} from "../shared/game.ts";
import { activePlayerPresences, isBlockType, latestWorldEdits, type PlayerPresence, type WorldEdit } from "../shared/protocol.ts";
import { createTerrain, raycastVoxels, terrainHeight } from "../client/game/terrain.ts";
import { BLOCK } from "../client/game/types.ts";

function recipe(id: string) {
  const found = RECIPES.find((candidate) => candidate.id === id);
  assert.ok(found, `recipe ${id} should exist`);
  return found;
}

let inventory = addItem(createEmptyInventory(), "log", 2).inventory;
for (let index = 0; index < 2; index += 1) {
  const result = craftRecipe(inventory, recipe("planks_from_log"));
  assert.equal(result.ok, true);
  inventory = result.inventory;
}
inventory = craftRecipe(inventory, recipe("sticks_from_planks")).inventory;
inventory = craftRecipe(inventory, recipe("wooden_pickaxe")).inventory;
inventory = craftRecipe(inventory, recipe("wooden_axe")).inventory;
assert.equal(countItem(inventory, "wooden_pickaxe"), 1);
assert.equal(countItem(inventory, "wooden_axe"), 1);
assert.ok(toolEffectiveness("stone", "wooden_pickaxe") > toolEffectiveness("stone", "wooden_axe"));

const terrain = createTerrain(7319, 8);
assert.ok(terrain.size > 1_000);
const top = terrainHeight(0, 0, 7319);
assert.equal(terrain.get(`0,${top},0`), BLOCK.GRASS);
const hit = raycastVoxels([0.5, top + 5, 0.5], [0, -1, 0], (x, y, z) => terrain.get(`${x},${y},${z}`) ?? BLOCK.AIR);
assert.equal(hit?.block.y, top);

const editBase = { actorId: "alice", createdAt: "1", updatedAt: "1" };
const edits: WorldEdit[] = [
  { ...editBase, id: "a", coordKey: "1:2:3", x: "1", y: "2", z: "3", blockType: "stone" },
  { ...editBase, id: "b", coordKey: "1:2:3", x: "1", y: "2", z: "3", blockType: "air" },
];
assert.equal(latestWorldEdits(edits)[0]?.blockType, "air");
assert.equal(latestWorldEdits([...edits].reverse())[0]?.blockType, "air");
assert.equal(isBlockType("coal_ore"), true);
assert.equal(isBlockType("iron_ore"), true);
assert.equal(isBlockType("furnace"), true);
assert.equal(isBlockType("ladder"), true);
assert.equal(isBlockType("diamond_ore"), false);

const now = Date.now();
const presenceBase = { color: "#ffffff", x: "0", y: "8", z: "0", yaw: "0", pitch: "0", vx: "0", vy: "0", vz: "0", createdAt: "1", updatedAt: "1" };
const presences: PlayerPresence[] = [
  { ...presenceBase, id: "p1", userId: "alice", displayName: "Alice", heartbeatAt: String(now - 1_000), online: true },
  { ...presenceBase, id: "p2", userId: "bob", displayName: "Bob", heartbeatAt: String(now - 500), online: true },
  { ...presenceBase, id: "p3", userId: "bob", displayName: "Bob", heartbeatAt: String(now), online: false },
];
assert.deepEqual(activePlayerPresences(presences, now).map((player) => player.userId), ["alice"]);

console.log("lakecraft model tests: ok");
