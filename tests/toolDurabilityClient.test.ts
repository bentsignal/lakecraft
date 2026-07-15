import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const client = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");
const glyph = readFileSync(new URL("../client/components/ItemGlyph.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../client/components/HudStyles.tsx", import.meta.url), "utf8");

assert.equal(client.includes("recordConfirmedToolUse"), false, "clients never spend durability locally after a hit or edit");

const mining = client.slice(client.indexOf("async function submitPendingWorldBlockEdit"), client.indexOf("function handleBlockEdit"));
assert.ok(mining.includes("await flushInventoryActions()"));
assert.ok(mining.indexOf("await flushInventoryActions()") < mining.indexOf("invokeWorldBlockEditWithOneRetry(editWorldBlock, args)"));
assert.ok(mining.includes("invokeWorldBlockEditWithOneRetry(editWorldBlock, args)"));
assert.ok(mining.includes("loadCanonicalPlayer(result.inventory)"));
assert.equal(mining.includes("recordConfirmedToolUse"), false, "mining durability must come only from the canonical inventory row");
assert.equal(mining.includes("updateInventory(addItem"), false, "mining drops cannot be granted optimistically");

const mob = client.slice(client.indexOf("onMobAttack:"), client.indexOf("onRemotePlayerAttack:"));
assert.ok(mob.includes("flushInventoryActions().then((flushed) =>"));
assert.ok(mob.includes("if (!flushed) throw new Error(\"inventory_action_pending\")"));
assert.ok(mob.includes("return attackMob("));
assert.ok(mob.includes("loadCanonicalPlayer(result.inventory)"));
assert.equal(mob.includes("recordConfirmedToolUse"), false, "mob durability must come from the atomic canonical inventory row");

const pvp = client.slice(client.indexOf("onRemotePlayerAttack:"), client.indexOf("onMobDrops:"));
assert.ok(pvp.includes("flushInventoryActions().then((flushed) =>"));
assert.ok(pvp.includes("return attackPlayer(JSON.stringify"));
assert.ok(pvp.includes("if (result.attackerInventory) loadCanonicalPlayer(result.attackerInventory)"));
assert.equal(pvp.includes("recordConfirmedToolUse"), false, "PvP weapon wear is returned by the authoritative transaction");

for (const interval of client.matchAll(/window\.setInterval\([\s\S]*?\},[^)]*\)/g)) {
  assert.equal(interval[0].includes("recordConfirmedToolUse"), false, "durability must not create a mutation/tick loop");
}

assert.ok(glyph.includes('className="lc-durability"'));
assert.ok(glyph.includes("data-remaining={durability}"));
assert.ok(styles.includes(".lc-durability"));

console.log("tool durability client confirmation and HUD wiring tests passed");
