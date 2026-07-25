import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DROPPED_ITEM_PICKUP_RADIUS } from "../shared/droppedItems.ts";

const app = readFileSync(new URL("../client/singleplayer/SinglePlayerApp.tsx", import.meta.url), "utf8");

const dropStart = app.indexOf("function dropLocalSelected(wholeStack: boolean)");
const dropEnd = app.indexOf("function respawnLocally", dropStart);
const drop = app.slice(dropStart, dropEnd);
assert.ok(dropStart >= 0 && dropEnd > dropStart);
assert.ok(drop.includes("dropsRef.current.length >= SINGLEPLAYER_SAVE_LIMITS.drops"), "a full pool changes nothing");
assert.ok(drop.includes("const count = wholeStack ? source.count : 1"));
assert.ok(drop.includes("item: { ...source, count }"), "durability metadata survives the drop");
assert.ok(drop.includes("stack.count === count ? null : { ...stack, count: stack.count - count }"));
assert.ok(drop.includes("inventoryRef.current = next") && drop.includes("dropsRef.current = [...dropsRef.current, dropped]"));

assert.ok(app.includes('event.code === "KeyQ" && !event.repeat'));
assert.ok(app.includes("pauseOpen || inventoryOpen || worldModalOpen || deathScreenOpen"));
assert.ok(app.includes("document.querySelector('[aria-modal=\"true\"]')"), "an already-rendered modal closes the state-effect race");
assert.ok(app.includes("dropLocalSelected(event.ctrlKey || event.metaKey)"));
assert.ok(Math.hypot(2.25, 1.1) > DROPPED_ITEM_PICKUP_RADIUS, "the dropped stack starts outside immediate pickup range");
assert.equal(app.includes("lakebed/client"), false);

console.log("lakecraft single-player Q-drop input and conservation tests: ok");
