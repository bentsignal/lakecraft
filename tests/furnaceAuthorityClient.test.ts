import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");
const drawer = readFileSync(new URL("../client/components/FurnaceDrawer.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../client/components/HudStyles.tsx", import.meta.url), "utf8");

assert.ok(app.includes('useQuery<FurnaceAtResult, { coordKey: string; sample: string }>('));
assert.ok(app.includes('useMutation<[requestJson: string], FurnaceOperationResult>("operateFurnace")'));
assert.ok(app.includes("window.setInterval(() => setFurnaceQuerySample(String(Date.now())), 2_000)"));
assert.equal(app.includes("setFurnaceQuerySample(String(Date.now())), 250"), false, "furnace does not poll Lakebed four times per second");
assert.ok(drawer.includes("materializeFurnace(anchor.state, trustedNow)"));
assert.ok(drawer.includes("window.setInterval(renderProgress, 50)"));
assert.ok(drawer.includes("performance.now() - anchor.receivedAt"));
assert.ok(drawer.includes("setDisplayFurnace(projected.state)"), "smooth progress is isolated to the furnace drawer subtree");
assert.ok(app.includes("setActiveFurnaceKey(key)"));
assert.equal(app.includes("function handleSmelt("), false, "instant local batch smelting is removed");
const handler = app.slice(app.indexOf("async function handleFurnaceTransfer"), app.indexOf("function handleUseItem"));
assert.ok(handler.includes("await requestInventorySave(false, false, true)"));
assert.ok(handler.includes("currentPlayerStateJson() !== lastCommittedPlayerJsonRef.current"));
assert.ok(handler.includes("Your pack is still saving"));
assert.ok(handler.includes("expectedInventoryUpdatedAt: inventoryTokenRef.current"));
assert.ok(handler.includes("expectedFurnaceRevision: authority.revision"));
assert.ok(handler.includes("expectedBlockInstanceToken: authority.blockInstanceToken"));
assert.ok(handler.includes("loadCanonicalPlayer(result.player)"));
assert.equal(handler.includes("updateInventory("), false, "furnace transfers never grant optimistic local items");

const keyHandler = app.slice(app.indexOf('if (event.code === "KeyQ"'), app.indexOf('if ((event.code === "KeyT"'));
assert.ok(keyHandler.includes("if (inventoryOpen || furnaceOpen) return;"), "Q cannot drop items behind the furnace modal");

for (const marker of [
  "lc-furnace__station",
  "lc-furnace__source",
  "lc-furnace__flame",
  "lc-furnace__arrow",
  "lc-furnace-inventory-grid",
  'kind="input"',
  'kind="fuel"',
  'kind="output"',
]) assert.ok(drawer.includes(marker), `missing Minecraft furnace UI marker: ${marker}`);
assert.equal(drawer.includes("Smelting ledger"), false);
assert.equal(drawer.includes(">FIRE<"), false);
assert.ok(drawer.includes("MAIN_INVENTORY_SLOTS = 27"));
assert.ok(drawer.includes("HOTBAR_SLOTS = 9"));
assert.ok(styles.includes(".lc-furnace__station"));
assert.ok(styles.includes("grid-template-columns: repeat(9,48px)"));

console.log("lakecraft persistent furnace client wiring tests passed");
