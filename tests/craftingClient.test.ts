import assert from "node:assert/strict";
import { CRAFTING_TABLE_USE_REACH, isCraftingTableWithinReach } from "../client/crafting.ts";

const table = { x: 4, y: 2, z: -3 };
assert.equal(isCraftingTableWithinReach({ x: 4.5, y: 2.5, z: -2.5 }, table), true);
assert.equal(isCraftingTableWithinReach({ x: 4.5 + CRAFTING_TABLE_USE_REACH, y: 2.5, z: -2.5 }, table), true, "the reach boundary stays usable");
assert.equal(isCraftingTableWithinReach({ x: 4.51 + CRAFTING_TABLE_USE_REACH, y: 2.5, z: -2.5 }, table), false, "walking beyond the table reach closes advanced crafting");

console.log("lakecraft client crafting context tests: ok");
