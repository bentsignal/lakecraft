import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const client = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");
const engine = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");
const engineTypes = readFileSync(new URL("../client/game/types.ts", import.meta.url), "utf8");

assert.ok(client.includes('WorldBlockEditMutationResult>("editWorldBlock")'));
assert.equal(client.includes('>("setBlock")'), false);
assert.equal(client.includes('>("removeBlock")'), false);

const actionQueue = client.slice(client.indexOf("function enqueueInventoryAction"), client.indexOf("async function handleDropSelected"));
assert.ok(actionQueue.includes("inventoryActionQueueRef.current.push"));
assert.ok(actionQueue.includes("operationId: createInventoryActionOperationId()"));
assert.ok(actionQueue.includes("expectedRevision: inventoryRevisionRef.current"));
assert.ok(actionQueue.includes("pending.requestJson = JSON.stringify"));
assert.ok(actionQueue.includes("pending.transportFailures <= 3"));
assert.ok(actionQueue.includes("continue;"), "transport retries reuse the same frozen action request");
assert.ok(actionQueue.includes("inventoryActionQueueRef.current.shift()"), "the queue advances only after Lakebed confirms an action");
assert.ok(actionQueue.includes("latestSavedInventoryRef.current"), "rejected optimistic actions fall back to the reactive canonical row");
assert.equal(client.includes("requestInventorySave"), false, "legacy generic saves and their autosave path stay removed");
assert.equal(client.includes("inventorySavePendingRef"), false);
for (const interval of client.matchAll(/window\.setInterval\([\s\S]*?\},[^)]*\)/g)) {
  assert.equal(interval[0].includes("flushInventoryActions"), false, "inventory actions are user-driven, never idle autosave traffic");
  assert.equal(interval[0].includes("applyInventoryActionMutation"), false, "idle timers cannot issue inventory mutations");
}

const submission = client.slice(client.indexOf("async function submitPendingWorldBlockEdit"), client.indexOf("function handleBlockEdit"));
assert.ok(submission.indexOf("await flushInventoryActions()") < submission.indexOf("invokeWorldBlockEditWithOneRetry(editWorldBlock, args)"));
assert.ok(submission.includes("expectedInventoryRevision: inventoryRevisionRef.current"));
assert.ok(submission.includes('worldChunkRevisionRef.current.get(chunkKey) ?? "0"'));
assert.ok(submission.includes("pending.requestJson = JSON.stringify(request)"));
assert.ok(submission.includes("const args = [pending.requestJson, ...pending.pose] as const"));
assert.ok(submission.includes("loadCanonicalPlayer(result.inventory)"));
assert.ok(submission.includes("pending.awaitingInventoryRevision = result.inventoryRevision"));
assert.ok(submission.includes("result.currentChunkRevision !== result.chunkRevision"));
assert.ok(submission.includes("authoritativeWorldEditRef.current.get(coordKey)"));
assert.equal(submission.includes("updateInventory("), false, "world edits may apply only returned/query canonical inventory rows");

assert.ok(client.includes("savedInventory.revision !== inventoryRevisionRef.current"));
assert.ok(client.includes("currentPlayerStateJson() === lastCommittedPlayerJsonRef.current"));

const handler = client.slice(client.indexOf("function handleBlockEdit"), client.indexOf("useEffect(() =>", client.indexOf("function handleBlockEdit")));
assert.ok(handler.includes("if (pendingWorldBlockEditRef.current)"));
assert.ok(handler.includes("block: previousBlock"));
assert.ok(handler.includes("serializeWorldBlockEditPose"));
assert.equal(handler.includes("updateInventory("), false);

const rollback = client.slice(client.indexOf("function rollbackPendingWorldBlockEdit"), client.indexOf("function notifyConfirmedWorldBlockEdit"));
assert.ok(rollback.includes("authoritativeWorldEditRef.current.get(coordKey)"));
assert.ok(rollback.includes("latestInventory.revision !== inventoryRevisionRef.current"));

const worldSync = client.slice(client.indexOf("if (worldChunks?.ok)"), client.indexOf("}, [worldEvents, worldChunks, worldChunkKeys]"));
assert.ok(worldSync.includes("chunk.revision"));
assert.ok(worldSync.includes("overlayPendingWorldBlockEdit"));
assert.ok(worldSync.includes("authoritativeWorldEditRef.current.set"));
assert.ok(worldSync.indexOf("chunkSnapshotsToEngineEdits") < worldSync.indexOf("pendingWorldBlockEditRef.current?.optimisticEdit"));

assert.ok(client.includes("canEditBlock: () => pendingWorldBlockEditRef.current === null"));
assert.ok(client.includes("droppedPickupAttemptRef.current.set(result.dropId"));
assert.equal(client.includes("droppedPickupAttemptRef.current.set(drop.dropId"), false);
assert.equal(client.includes("deferredMobDropsRef"), false, "mob drops cannot enter inventory through a deferred client-only mint path");
assert.ok(client.includes("loadCanonicalPlayer(result.inventory)"), "authoritative operations reconcile their canonical inventory result");
assert.ok(engineTypes.includes("canEditBlock?: () => boolean"));
assert.ok(engine.includes("const editAllowed = mined.block !== BLOCK.BEDROCK"));
assert.ok(engine.includes("&& options.canEditBlock?.() !== false"));
assert.ok(engine.includes("shouldStartHeldMining(primaryActionHold"));
assert.ok((engine.match(/options\.canEditBlock\?\.\(\) === false/g) ?? []).length >= 2);

console.log("atomic world block client integration source tests passed");
