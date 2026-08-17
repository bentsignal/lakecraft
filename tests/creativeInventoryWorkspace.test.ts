import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createEmptyEquipment,
  createEmptyInventory,
  createItemStack,
  type Inventory,
} from "../shared/game.ts";
import {
  createInventoryWorkspace,
  insertCreativeCatalogStack,
  leftClickInventorySlot,
  stowInventoryWorkspace,
  takeCreativeCatalogStack,
} from "../shared/inventoryWorkspace.ts";

// Normal click takes one visible infinite-use item onto the same cursor used by
// every inventory interaction; Creative placement itself does not consume it.
let state = createInventoryWorkspace(createEmptyInventory(), createEmptyEquipment());
let result = takeCreativeCatalogStack(state, "dirt");
assert.equal(result.ok, true);
if (!result.ok) throw new Error(result.reason);
state = result.state;
assert.deepEqual(state.cursor, createItemStack("dirt"));
result = leftClickInventorySlot(state, 11);
assert.equal(result.ok, true);
if (!result.ok) throw new Error(result.reason);
state = result.state;
assert.deepEqual(state.inventory[11], createItemStack("dirt"));
assert.equal(state.cursor, null);

// A second catalog item goes to the next chosen slot and never replaces slot 8
// or the first selection. Drag/drop uses these exact two reducers as well.
result = takeCreativeCatalogStack(state, "stone");
assert.equal(result.ok, true);
if (!result.ok) throw new Error(result.reason);
result = leftClickInventorySlot(result.state, 23);
assert.equal(result.ok, true);
if (!result.ok) throw new Error(result.reason);
state = result.state;
assert.equal(state.inventory[8], null);
assert.equal(state.inventory[11]?.itemId, "dirt");
assert.equal(state.inventory[23]?.itemId, "stone");

// Selecting a different item while a stack is held fails visibly and leaves a
// detached, byte-for-byte equivalent state rather than deleting the held item.
result = takeCreativeCatalogStack(state, "glass");
assert.equal(result.ok, true);
if (!result.ok) throw new Error(result.reason);
const held = result.state;
const blocked = takeCreativeCatalogStack(held, "tnt");
assert.equal(blocked.ok, false);
assert.equal(blocked.reason, "cursor_blocked");
assert.deepEqual(blocked.state, held);
assert.notEqual(blocked.state, held);

// Ctrl/Cmd-click adds exactly one item to the first compatible stack. Repeated
// distinct choices accumulate without touching slot 8 or showing 64 counters.
const partial = createEmptyInventory();
partial[0] = createItemStack("dirt", 32);
state = createInventoryWorkspace(partial, createEmptyEquipment());
result = insertCreativeCatalogStack(state, "dirt");
assert.equal(result.ok, true);
if (!result.ok) throw new Error(result.reason);
state = result.state;
assert.equal(state.inventory[0]?.count, 33);
assert.equal(state.inventory[1], null);
result = insertCreativeCatalogStack(state, "diamond_pickaxe");
assert.equal(result.ok, true);
if (!result.ok) throw new Error(result.reason);
state = result.state;
assert.deepEqual(state.inventory[1], createItemStack("diamond_pickaxe"));
assert.equal(state.inventory[8], null);

// Full capacity remains conservative, while one compatible unit of capacity
// accepts the complete one-item Creative grant.
const full = Array.from({ length: 36 }, () => createItemStack("cobblestone", 64)) as Inventory;
state = createInventoryWorkspace(full, createEmptyEquipment());
const fullFailure = insertCreativeCatalogStack(state, "dirt");
assert.equal(fullFailure.ok, false);
assert.equal(fullFailure.reason, "no_capacity");
assert.deepEqual(fullFailure.state, state);

const oneSpace = full.map((stack) => ({ ...stack })) as Inventory;
oneSpace[0] = createItemStack("dirt", 63);
state = createInventoryWorkspace(oneSpace, createEmptyEquipment());
const exactFit = insertCreativeCatalogStack(state, "dirt");
assert.equal(exactFit.ok, true);
if (!exactFit.ok) throw new Error(exactFit.reason);
assert.deepEqual(exactFit.state.inventory[0], createItemStack("dirt", 64),
  "one free unit accepts the complete one-item Creative grant");

// Closing/reopening projects the exact shared workspace into the canonical save.
state = createInventoryWorkspace(createEmptyInventory(), createEmptyEquipment());
result = insertCreativeCatalogStack(state, "tnt");
assert.equal(result.ok, true);
if (!result.ok) throw new Error(result.reason);
const saved = stowInventoryWorkspace(result.state);
assert.equal(saved.ok, true);
if (!saved.ok) throw new Error(saved.reason);
const reopened = createInventoryWorkspace(saved.snapshot.inventory, saved.snapshot.equipment);
assert.deepEqual(reopened.inventory, saved.snapshot.inventory);
assert.deepEqual(reopened.equipment, saved.snapshot.equipment);

// UI structure keeps the catalog footprint constant across search result counts,
// presents both panes on desktop, and switches to tabs without horizontal scroll.
const drawer = readFileSync(new URL("../client/components/InventoryDrawer.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../client/components/HudStyles.tsx", import.meta.url), "utf8");
assert.ok(drawer.includes('className="lc-creative-workspace"'));
assert.ok(drawer.includes('className="lc-creative-grid-wrap"'));
assert.ok(drawer.indexOf('className="lc-creative-grid-wrap"') < drawer.indexOf("items.length === 0"),
  "the permanent grid frame wraps both populated and empty search states");
assert.match(styles, /\.lc-creative-grid-wrap\{height:296px;/);
assert.match(styles, /\.lc-creative-workspace\{display:grid;/);
assert.match(styles, /@media \(max-width: 900px\).*\.lc-creative-switch\{display:flex\}/);
assert.match(styles, /\.lc-creative-pane\{display:none\}\.lc-creative-pane\.is-active\{display:block\}/);
assert.equal(styles.includes("overflow-x:auto"), false, "Creative tabs and panes never force horizontal scrolling");
assert.ok(drawer.includes("onDragStart") && drawer.includes("onDragOver") && drawer.includes("onDrop"));
assert.ok(drawer.includes("event.metaKey || event.ctrlKey"));
assert.ok(drawer.includes('aria-live="polite"'));
assert.ok(drawer.includes("const stack = createItemStack(item.id)"));
assert.ok(drawer.includes("take one infinite Creative item"));

console.log("Creative side-by-side inventory workspace checks passed");
