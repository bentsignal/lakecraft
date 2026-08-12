import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const server = readFileSync(new URL("../server/index.ts", import.meta.url), "utf8");
const client = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");

for (const required of [
  "droppedItems: table({",
  '.index("by_drop", ["dropId"])',
  '.index("by_chunk_expiry", ["chunkKey", "expiresAt"])',
  '.index("by_owner_expiry", ["ownerUserId", "expiresAt"])',
  '.index("by_expiry", ["expiresAt"])',
  "droppedItemReceipts: table({",
  "droppedItems: query(async",
  "dropItem: mutation(async",
  "pickupDroppedItem: mutation(async",
  "authoritativeDroppedItemPosition(presence",
  "compareDroppedItemStoredPlayerState(",
  "applyDropItemToInventory(request)",
  "applyPickupDroppedItem(",
]) assert.ok(server.includes(required), `missing dropped-item server integration: ${required}`);

const dropMutation = server.slice(server.indexOf("dropItem: mutation(async"), server.indexOf("pickupDroppedItem: mutation(async"));
assert.equal(dropMutation.includes("request.x"), false, "drop position must never be trusted from the request payload");
assert.equal(dropMutation.includes("request.y"), false, "drop position must never be trusted from the request payload");
assert.equal(dropMutation.includes("request.z"), false, "drop position must never be trusted from the request payload");
assert.ok(dropMutation.indexOf("inventories.update") < dropMutation.indexOf("droppedItems.insert"));
assert.ok(dropMutation.indexOf("droppedItems.insert") < dropMutation.indexOf("droppedItemReceipts.insert"));

const pickupMutation = server.slice(server.indexOf("pickupDroppedItem: mutation(async"), server.indexOf("saveChest: mutation(async"));
assert.equal(pickupMutation.includes("request.x"), false, "pickup distance must use authoritative presence");
assert.ok(pickupMutation.includes("droppedItems.delete"), "a complete pickup removes the world entity");
assert.ok(pickupMutation.includes("droppedItems.update"), "a partial pickup retains the exact remainder");
assert.ok(pickupMutation.indexOf("inventories.update") < pickupMutation.indexOf("droppedItemReceipts.insert"));

const realtimeMine = client.slice(client.indexOf("async function submitPendingWorldBlockEdit"), client.indexOf("function handleBlockEdit"));
assert.ok(realtimeMine.includes("getDeterministicMiningDrop") && realtimeMine.includes("realtimeDropSinkRef.current")
  && realtimeMine.includes("await dropSink(dropOperationId, drop, dropPose)"),
"a confirmed Railway block break publishes one deterministic shared drop through the existing exact-once world-drop authority");

console.log("lakecraft dropped item Lakebed integration tests: ok");
