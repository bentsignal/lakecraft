import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const client = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");
const glyph = readFileSync(new URL("../client/components/ItemGlyph.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../client/components/HudStyles.tsx", import.meta.url), "utf8");

assert.ok(client.includes("applyConfirmedToolUse(inventoryRef.current, slot, kind, itemId)"));

const mining = client.slice(client.indexOf("void removeBlockMutation("), client.indexOf("return;", client.indexOf("void removeBlockMutation(")));
assert.ok(mining.indexOf(".then(() =>") < mining.indexOf("recordConfirmedToolUse(usedToolSlot, usedToolItemId, \"mine\")"));
assert.equal(mining.slice(mining.indexOf(".catch(() =>")).includes("recordConfirmedToolUse"), false, "rejected mining cannot wear a tool");

const mob = client.slice(client.indexOf("onMobAttack:"), client.indexOf("onRemotePlayerAttack:"));
assert.ok(mob.includes("if (result.ok) recordConfirmedToolUse(usedToolSlot, usedToolItemId, \"attack\")"));

const pvp = client.slice(client.indexOf("onRemotePlayerAttack:"), client.indexOf("onMobDrops:"));
assert.ok(pvp.indexOf("if (result.ok)") < pvp.indexOf("recordConfirmedToolUse(selectedHotbar, weaponItemId || null, \"attack\")"));

for (const interval of client.matchAll(/window\.setInterval\([\s\S]*?\},[^)]*\)/g)) {
  assert.equal(interval[0].includes("recordConfirmedToolUse"), false, "durability must not create a mutation/tick loop");
}

assert.ok(glyph.includes('className="lc-durability"'));
assert.ok(glyph.includes("data-remaining={durability}"));
assert.ok(styles.includes(".lc-durability"));

console.log("tool durability client confirmation and HUD wiring tests passed");
