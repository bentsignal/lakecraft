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
assert.ok(realtimeMine.includes("await sink(pending.operationId") && realtimeMine.includes("expectedInventoryRevision"),
  "Railway receives the block and inventory preconditions in one authority request");
assert.equal(realtimeMine.includes('kind: "place_block"'), false,
  "the browser cannot separately debit a placement outside the Railway block transaction");
assert.equal(realtimeMine.includes('kind: "world_credit"'), false,
  "the browser cannot mint a mining pickup or placement refund");
assert.equal(realtimeMine.includes("await dropSink("), false,
  "Railway publishes the one persisted mining drop atomically with the block edit");
const realtimeToss = client.slice(client.indexOf("async function handleDropSelected"), client.indexOf("async function pickupNearbyDroppedItem"));
assert.ok(realtimeToss.includes("await sink(operationId") && realtimeToss.includes("sourceSlot"),
  "manual drops submit the exact source slot for Railway's atomic debit plus entity creation");
assert.equal(realtimeToss.includes('kind: "world_debit"'), false,
  "manual drops cannot split the debit from world entity creation");
const realtimePickup = client.slice(client.indexOf("async function pickupNearbyDroppedItem"), client.indexOf("function maybePickupNearbyDroppedItem"));
assert.ok(realtimePickup.includes("await sink("), "pickups require Railway confirmation");
assert.equal(realtimePickup.includes('kind: "world_credit"'), false,
  "Railway atomically credits the pack while consuming the exact world entity");
assert.equal(realtimePickup.includes('`return:${confirmed.dropId}`'), false,
  "there is no client-side compensating drop that can duplicate a pickup");

assert.ok(client.includes("realtimeSink") && client.includes("realtimeInventorySinkRef.current"),
  "Railway gameplay never spends a Lakebed inventory mutation for these transfers");

console.log("lakecraft dropped item authority integration tests: ok");
