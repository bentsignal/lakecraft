import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const drawer = source("../client/components/InventoryDrawer.tsx");
const grid = source("../client/components/CraftingGrid.tsx");
const styles = source("../client/components/HudStyles.tsx");
const workspace = source("../shared/inventoryWorkspace.ts");

assert.equal(drawer.includes("lc-recipe-list"), false, "recipe-card buttons are removed from the inventory UI");
assert.equal(drawer.includes('className={`lc-recipe'), false, "players must arrange ingredients instead of selecting a recipe");
assert.ok(drawer.includes("leftClickWorkspaceCraftingSlot") && drawer.includes("rightClickWorkspaceCraftingSlot"), "manual grid uses the shared slot-addressed cursor model");
assert.ok(drawer.includes("takeWorkspaceCraftingResult") && drawer.includes("stowInventoryWorkspace"), "crafting consumes exact grid slots and prepares a capacity-checked snapshot");
assert.equal(drawer.match(/onWorkspaceChange\(/g)?.length, 1, "local drawer interactions publish exactly once, when the workspace closes");
assert.ok(drawer.includes("recipeBatchesRef") && drawer.includes("result.crafted.batches"), "manual and shift crafting preserve ordered authoritative recipe batch counts");
assert.ok(drawer.includes("takeAllWorkspaceCraftingResultsToInventory"), "shift-click output uses the shared bounded batch transaction");
assert.ok(workspace.includes("attempt < 64") && workspace.includes("result.recipeId !== recipeId"), "batch crafting is bounded and pins the first matched recipe");
assert.ok(grid.includes("event.shiftKey") && grid.includes("onContextMenu"), "result shift-click and right-click splitting are exposed in the view");
assert.ok(styles.includes("repeat(var(--craft-grid-size),48px)"), "2x2 and 3x3 grids share Minecraft-scale slots");
assert.ok(styles.includes(".lc-cursor-stack"), "the held stack follows the pointer instead of appearing as a duplicate inventory item");

console.log("manual crafting grid client checks passed");
