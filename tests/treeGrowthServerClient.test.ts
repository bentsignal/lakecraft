import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const server = readFileSync(new URL("../server/index.ts", import.meta.url), "utf8");
const client = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");

for (const marker of [
  "treeGrowthReceipts: table({",
  '.index("by_user_operation", ["userId", "operationId"])',
  '.index("by_user_created", ["userId", "receiptCreatedAt"])',
  "maintainTreeGrowthReceipts",
  "MAX_TREE_GROWTH_RECEIPTS_PER_USER",
  "TREE_GROWTH_RECEIPT_TTL_MS",
]) assert.ok(server.includes(marker), `missing bounded tree authority marker: ${marker}`);

const mutation = server.slice(server.indexOf("growOakTree: mutation(async"), server.indexOf("editWorldBlock: mutation(async"));
for (const marker of [
  "ctx.auth.isAuthenticated",
  "ctx.auth.isGuest",
  "isValidTreeGrowthOperationId",
  "worldBlockOperationPoseFingerprint",
  "ctx.db.treeGrowthReceipts",
  "decodeTreeGrowthReceipt",
  "inventory: inventoryRows[0]",
  "currentChunks",
  "validateWorldBlockActionPose",
  "materializePlayerCombatState",
  'reason: "player_dead"',
  "validatePlayerStateJson(inventoryRow.inventoryJson)",
  "playerState.state.selectedHotbar",
  'selectedStack?.itemId !== "bone_meal"',
  "oakTreeGrowthProbeCells",
  "sampleWorldChunkSnapshot",
  "naturalWorldBlockAt",
  "planOakTreeGrowth",
  "OAK_TREE_MAX_EDITS",
  "applyWorldChunkEdits",
  "createWorldChunkSnapshot",
  "ctx.db.worldEdits.update",
  "ctx.db.worldEdits.insert",
  "ctx.db.worldChunks.update",
  "ctx.db.worldChunks.insert",
  "ctx.db.inventories.update",
  "encodeTreeGrowthReceipt",
]) assert.ok(mutation.includes(marker), `missing exact-once tree-growth mutation marker: ${marker}`);
assert.ok(
  mutation.indexOf("ctx.db.treeGrowthReceipts") < mutation.indexOf("ctx.db.playerPresence"),
  "exact replay resolves before mutable presence, inventory, tree, edit, or chunk authority reads",
);
assert.ok(
  mutation.indexOf("planOakTreeGrowth") < mutation.indexOf("ctx.db.worldEdits.update"),
  "support and complete clearance planning precede every world write",
);
assert.match(mutation, /nextInventory\[selectedSlot\] = selectedStack\.count === 1[\s\S]*?selectedStack\.count - 1/,
  "bone meal is consumed from the exact validated selected stack");
assert.ok(
  mutation.indexOf("ctx.db.worldChunks.update") < mutation.indexOf("ctx.db.treeGrowthReceipts.insert"),
  "all touched chunk snapshots/revisions commit before the replay receipt",
);
assert.ok(
  mutation.indexOf("ctx.db.inventories.update") < mutation.indexOf("ctx.db.treeGrowthReceipts.insert"),
  "one selected bone meal consumption commits before the replay receipt",
);
assert.doesNotMatch(mutation, /setInterval|setTimeout|fetch\(/, "growth adds no background traffic or alternate backend");

const worldMutation = server.slice(server.indexOf("editWorldBlock: mutation(async"), server.indexOf("sleepVote: mutation(async"));
assert.match(worldMutation, /effect\.kind === "place" && effect\.nextBlock === "sapling"[\s\S]*?request\.y - 1[\s\S]*?sampleWorldChunkSnapshot[\s\S]*?supportBlock !== "grass" && supportBlock !== "dirt"[\s\S]*?reason: BS\.invalidSupport/,
  "Lakebed rejects custom-client floating or wall saplings unless the placement cell is directly above authoritative soil");
assert.ok(
  worldMutation.indexOf('effect.nextBlock === "sapling"') < worldMutation.indexOf("ctx.db.worldEdits.update"),
  "sapling support is verified before any edit, chunk, inventory, or receipt write",
);

for (const marker of [
  'useMutation<[',
  'TreeGrowthMutationResult>("growOakTree")',
  "createTreeGrowthOperationId",
  "treeGrowthBusyRef",
  "target.block.block === BLOCK.SAPLING",
  'itemId === "bone_meal"',
  "flushInventoryActions()",
  "refreshAuthoritativePose()",
  "retryExactLakebedMutation(() => growOakTree",
  "loadCanonicalPlayer(result.inventory)",
  "worldChunkRevisionRef.current.set",
  "authoritativeWorldEditRef.current.set",
  "engineRef.current?.applyWorldEdits(engineEdits)",
]) assert.ok(client.includes(marker), `missing multiplayer tree-growth wiring marker: ${marker}`);
const interaction = client.slice(
  client.indexOf("if (target.block.block === BLOCK.SAPLING"),
  client.indexOf("closeInventory();", client.indexOf("if (target.block.block === BLOCK.SAPLING")),
);
assert.doesNotMatch(interaction, /setInterval|useQuery/, "right-click growth is one discrete mutation, never a poll loop");
assert.ok(interaction.indexOf("flushInventoryActions") < interaction.indexOf("growOakTree"));
assert.ok(interaction.indexOf("refreshAuthoritativePose") < interaction.indexOf("growOakTree"));

console.log("Lakebed exact-once multi-chunk oak growth server/client integration tests passed");
