import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const client = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");
const engine = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");

for (const required of [
  '"playerCombatStates", inWorld ? combatUserIds : []',
  'useMutation<[requestJson: string]',
  '>("attackPlayer")',
  "onRemotePlayerAttack: (target) =>",
  "targetUserId: target.id",
  "selectedHotbar,",
  "weaponItemId,",
  "appliedOwnCombatHealthRef",
]) assert.ok(client.includes(required), `missing PvP client integration: ${required}`);

const callback = client.slice(
  client.indexOf("onRemotePlayerAttack: (target) =>"),
  client.indexOf("onMobDrops:", client.indexOf("onRemotePlayerAttack: (target) =>")),
);
assert.ok(callback.length > 0);
assert.ok(
  callback.indexOf("flushInventoryActions()") < callback.indexOf("attackPlayer(JSON.stringify"),
  "the revisioned inventory action queue must flush before the authoritative hit request",
);
assert.ok(callback.includes("if (result.attackerInventory) loadCanonicalPlayer(result.attackerInventory)"), "PvP weapon wear reconciles from the same Lakebed transaction");
assert.equal(callback.includes("damage:"), false, "the client must not submit damage authority");
assert.equal(callback.includes("target.distance"), false, "the client must not submit its own reach claim");

assert.ok(engine.includes("raycastRemotePlayers(eye, facing, remoteStates.values(), reach)"));
assert.ok(engine.includes("mobTargetHasClickPriority(nearestDistance, target?.distance ?? null)"));
assert.ok(engine.includes("options.onRemotePlayerAttack?.({ ...remoteTarget }, attackDamage)"));
const identityReset = client.slice(
  client.indexOf("appliedOwnCombatHealthRef.current = null"),
  client.indexOf("}, [auth.userId]") + "}, [auth.userId]".length,
);
assert.ok(identityReset.includes("appliedOwnCombatRevisionRef.current = -1"), "combat ordering resets when auth identity changes");

console.log("lakecraft player combat client integration tests: ok");
