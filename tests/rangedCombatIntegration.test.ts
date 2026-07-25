import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const server = readFileSync(new URL("../server/index.ts", import.meta.url), "utf8");
const client = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");
const engine = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");
const remote = readFileSync(new URL("../client/game/remotePlayerRenderer.ts", import.meta.url), "utf8");

for (const required of [
  "rangedCharges: table({",
  "rangedCombatReceipts: table({",
  "beginFingerprint: string().default",
  "beginInventoryRevision: string().default",
  'rangedCombat: mutation(async (ctx, requestJson: string)',
  "validateRangedCombatRequestJson(requestJson)",
  "authoritativeCombatPose(presenceRows[0]",
  "authoritativeRangedOccluders(ctx.db, trajectory, target)",
  'removeItem(playerState.state.inventory, "arrow", 1)',
  'selectedStack?.itemId === "bow"',
  "remainingItemDurability(bow)",
  "encodeRangedCombatReceipt(resolution.receipt)",
  "maintainRangedCombatReceipts",
]) assert.ok(server.includes(required), `missing ranged server integration: ${required}`);

assert.equal(server.includes("request.origin"), false, "server must never trust a client shot origin");
assert.equal(server.includes("request.direction"), false, "server must never trust a client shot direction");
assert.equal(server.includes("request.damage"), false, "server must never trust client ranged damage");
assert.ok(server.includes('.take(2)'), "authority rows and receipts must detect duplicate state");

for (const required of [
  'useMutation<[requestJson: string], RangedCombatMutationResult>("rangedCombat")',
  'kind: "begin_charge"',
  'kind: "cancel_charge"',
  'kind: "release"',
  "retryExactLakebedMutation",
  "expectedInventoryRevision",
  "loadCanonicalPlayer(result.inventory)",
  "setPlayerProjectiles(playerProjectilesRef.current)",
  "FirstPersonBow",
]) assert.ok(client.includes(required), `missing ranged client integration: ${required}`);

assert.ok(engine.includes("createPlayerProjectileRenderer(gl)"));
assert.ok(engine.includes("setPlayerProjectiles(projectiles"));
assert.ok(engine.includes("onRangedRelease?.(intent)"));
assert.ok(remote.includes('itemId === "bow"'), "remote avatars need a recognizable held bow");

console.log("Lakebed ranged combat integration tests passed");
