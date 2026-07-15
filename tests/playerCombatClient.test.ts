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
  callback.indexOf("requestInventorySave()") < callback.indexOf("attackPlayer(JSON.stringify"),
  "persisted selected inventory must be synchronized before the authoritative hit request",
);
assert.equal(callback.includes("damage:"), false, "the client must not submit damage authority");
assert.equal(callback.includes("target.distance"), false, "the client must not submit its own reach claim");

assert.ok(engine.includes("raycastRemotePlayers(eye, facing, remoteStates.values(), reach)"));
assert.ok(engine.includes("mobTargetHasClickPriority(nearestDistance, target?.distance ?? null)"));
assert.ok(engine.includes("options.onRemotePlayerAttack?.({ ...remoteTarget }, attackDamage)"));

console.log("lakecraft player combat client integration tests: ok");
