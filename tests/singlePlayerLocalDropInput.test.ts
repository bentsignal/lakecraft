import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../client/singleplayer/SinglePlayerApp.tsx", import.meta.url), "utf8");
const collection = readFileSync(new URL("../client/singleplayer/localDroppedItems.ts", import.meta.url), "utf8");

const dropStart = app.indexOf("function dropLocalSelected(wholeStack: boolean)");
const dropEnd = app.indexOf("function respawnLocally", dropStart);
const drop = app.slice(dropStart, dropEnd);
assert.ok(dropStart >= 0 && dropEnd > dropStart);
assert.ok(drop.includes("dropsRef.current.length >= SINGLEPLAYER_SAVE_LIMITS.drops"), "a full pool changes nothing");
assert.ok(drop.includes("const count = wholeStack ? source.count : 1"));
assert.ok(drop.includes("item: { ...source, count }"), "durability metadata survives the drop");
assert.ok(drop.includes("stack.count === count ? null : { ...stack, count: stack.count - count }"));
assert.ok(drop.includes("inventoryRef.current = next") && drop.includes("dropsRef.current = [...dropsRef.current, dropped]"));

assert.ok(app.includes('action === "drop" && !event.repeat'), "dropping follows the remappable Drop Item control");
assert.ok(app.includes("pauseOpen || inventoryOpen || worldModalOpen || deathScreenOpen"));
assert.ok(app.includes("document.querySelector('[aria-modal=\"true\"]')"), "an already-rendered modal closes the state-effect race");
assert.ok(app.includes("dropLocalSelected(event.ctrlKey || event.metaKey)"));
assert.ok(app.includes("collectLocalDrops(engine.getPose())") && app.includes("}, 125)"),
  "a stationary player retries collection when the universal timer opens");
assert.ok(collection.includes("drop.droppedAt + DROPPED_ITEM_PICKUP_DELAY_MS"));
assert.ok(!collection.includes("OWNER_PICKUP_LEAVE_DISTANCE") && !collection.includes("releaseOwnerPickupBarrier"),
  "manual drops never require walking away and returning");
assert.equal(app.includes("lakebed/client"), false);

console.log("lakecraft single-player Q-drop input and conservation tests: ok");
