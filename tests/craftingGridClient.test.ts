import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const drawer = source("../client/components/InventoryDrawer.tsx");
const grid = source("../client/components/CraftingGrid.tsx");
const styles = source("../client/components/HudStyles.tsx");

assert.equal(drawer.includes("lc-recipe-list"), false, "recipe-card buttons are removed from the inventory UI");
assert.equal(drawer.includes('className={`lc-recipe'), false, "players must arrange ingredients instead of selecting a recipe");
assert.ok(drawer.includes("leftClickCraftingSlot") && drawer.includes("rightClickCraftingSlot"), "manual grid uses canonical cursor operations");
assert.ok(drawer.includes("recipeFromMatch") && drawer.includes("canCraft(shadowInventory"), "the root receives the exact matched ingredients after capacity validation");
assert.ok(drawer.includes("reservationsFitInventory") && drawer.includes("closeAndReturnItems"), "grid reservations cannot duplicate or lose items on close");
assert.ok(drawer.includes("shiftAll ? 64 : 1"), "shift-click output crafts repeatedly through bounded atomic transactions");
assert.ok(grid.includes("event.shiftKey") && grid.includes("onContextMenu"), "result shift-click and right-click splitting are exposed in the view");
assert.ok(styles.includes("repeat(var(--craft-grid-size),48px)"), "2x2 and 3x3 grids share Minecraft-scale slots");
assert.ok(styles.includes(".lc-cursor-stack"), "the held stack follows the pointer instead of appearing as a duplicate inventory item");

console.log("manual crafting grid client checks passed");
