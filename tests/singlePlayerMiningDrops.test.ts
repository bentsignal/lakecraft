import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { INVENTORY_SIZE, addItemStack, createItemStack, type Inventory } from "../shared/game.ts";

const app = readFileSync(new URL("../client/singleplayer/SinglePlayerApp.tsx", import.meta.url), "utf8");
const engine = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");

assert.ok(engine.includes("options.canMineBlock?.(mined) !== false"), "drop capacity is proven before the edit");
assert.ok(app.includes("dropsRef.current.length < SINGLEPLAYER_SAVE_LIMITS.drops"));
assert.ok(app.includes("dropId: `local_mine_${droppedAt}_${edit.x}_${edit.y}_${edit.z}`"));
assert.ok(app.includes("engine.setDroppedItems(dropsRef.current)"));
const miningBranch = app.slice(app.indexOf("if (!toggledBlock && edit.block === BLOCK.AIR"), app.indexOf("} else if (!toggledBlock && previousBlock === BLOCK.AIR"));
assert.equal(miningBranch.includes("addItem(next, drop.itemId"), false, "mining no longer teleports loot into the pack");

const fullPack = Array.from({ length: INVENTORY_SIZE }, () => createItemStack("dirt", 64)) as Inventory;
const rejectedPickup = addItemStack(fullPack, createItemStack("diamond", 1));
assert.equal(rejectedPickup.remainder, 1, "a full pack preserves the entire world stack");
assert.deepEqual(rejectedPickup.inventory, fullPack);

console.log("lakecraft single-player mined world-drop conservation tests: ok");
