import assert from "node:assert/strict";
import {
  candidateMatchesManifest,
  cloudBackupStoredPartBytes,
  decideSinglePlayerCloudBackupCommit,
  inventorySinglePlayerCloudBackupParts,
  loadSinglePlayerCloudBackupParts,
  parseSinglePlayerCloudBackupCommitRequest,
  parseSinglePlayerCloudBackupDeleteRequest,
  parseSinglePlayerCloudTombstone,
  SINGLE_PLAYER_CLOUD_MAX_REVISION,
  singlePlayerCloudBackupHeader,
  singlePlayerCloudBackupWire,
  singlePlayerCloudInteger,
  singlePlayerCloudTombstoneHeader,
  singlePlayerCloudUnsigned,
  type StoredSinglePlayerCloudBackupPart,
} from "../shared/singlePlayerCloudBackups.ts";

const request = JSON.stringify([1, "world-a", "World A", 7, "survival", 10, "0", "opaque"]);
const parsed = parseSinglePlayerCloudBackupCommitRequest(request);
assert.equal(parsed[0], 1);
if (!parsed[0]) throw new Error("valid tuple request rejected");
assert.deepEqual(parsed[1].slice(0, 8), ["world-a", "World A", 7, "survival", 10, "0", "6f15601e", "opaque"]);
assert.equal(parsed[1][8], 6);
assert.equal(parsed[1][10].join(""), "opaque");
assert.deepEqual(parseSinglePlayerCloudBackupCommitRequest("{}"), [0, "invalid_request"]);
assert.equal(singlePlayerCloudUnsigned(Symbol("revision"), 0, 1), false,
  "non-string validation is Symbol-safe");
assert.equal(singlePlayerCloudUnsigned("0001", 0, 10), true,
  "persisted noncanonical counters retain their prior acceptance semantics");
assert.equal(singlePlayerCloudUnsigned(String(SINGLE_PLAYER_CLOUD_MAX_REVISION), 1,
  SINGLE_PLAYER_CLOUD_MAX_REVISION), true);
assert.equal(singlePlayerCloudUnsigned("9007199254740992", 1, SINGLE_PLAYER_CLOUD_MAX_REVISION), false);
for (const value of ["-1", "1.0", "", "12345678901234567"]) {
  assert.equal(singlePlayerCloudUnsigned(value, 0, SINGLE_PLAYER_CLOUD_MAX_REVISION), false);
}
for (const value of [NaN, Infinity, 1.5, -1, 11]) assert.equal(singlePlayerCloudInteger(value, 0, 10), false);
assert.equal(singlePlayerCloudInteger(10, 0, 10), true);
assert.equal(parseSinglePlayerCloudBackupDeleteRequest('[1,"world-a","01","delete_op_1"]'), null,
  "wire revisions remain canonical even though persisted counters may contain leading zeroes");

const headerForCharge = JSON.stringify([1, "World A", "7", "survival", "10", parsed[1][6], "1", "1800000"]);
const stateBytes = cloudBackupStoredPartBytes("user-a", "world-a", "0", headerForCharge)
  + cloudBackupStoredPartBytes("user-a", "world-a", "1", "opaque");
const candidate = [...parsed[1]];
candidate[9] = stateBytes;
const decision = decideSinglePlayerCloudBackupCommit(null, null, candidate, 0, 0, 4_096, 0, 0, 0,
  "1", 1_800_000);
assert.equal(decision[0], 1);
if (!decision[0]) throw new Error("valid tuple commit rejected");
assert.equal(decision[1], "write");
assert.deepEqual(decision[2], ["world-a", "World A", "7", "survival", "10", parsed[1][6], "6",
  String(stateBytes), "1", "1", "1800000"]);
assert.equal(candidateMatchesManifest(candidate, decision[2]), true);
assert.deepEqual(singlePlayerCloudBackupWire(decision[2], "opaque"),
  [1, "world-a", "World A", "7", "survival", "10", parsed[1][6], "opaque", "1", "1800000"]);

const parts: StoredSinglePlayerCloudBackupPart[] = [
  { userId: "user-a", worldId: "world-a", part: "1", data: "opaque" },
  { userId: "user-a", worldId: "world-a", part: "0", data: singlePlayerCloudBackupHeader(decision[2]) },
];
const inventory = inventorySinglePlayerCloudBackupParts("user-a", parts);
assert.equal(inventory[0], 1);
assert.deepEqual(inventory[0] && inventory[1][0].slice(0, 2), ["world-a", parts]);
const loaded = loadSinglePlayerCloudBackupParts("user-a", parts);
assert.equal(loaded[0], 1);
if (!loaded[0]) throw new Error("valid tuple parts rejected");
assert.deepEqual(loaded[1][0][0], decision[2]);
assert.equal(loaded[1][0][1], "opaque");
assert.deepEqual(inventorySinglePlayerCloudBackupParts("user-b", parts), [0, "server_state"]);

const tombstone = ["world-a", "2", "1", "1800001", "delete_op_123"] as const;
const tombstoneHeader = singlePlayerCloudTombstoneHeader(tombstone);
assert.equal(tombstoneHeader, '[0,"2","1","1800001","delete_op_123"]');
assert.deepEqual(parseSinglePlayerCloudTombstone("world-a", tombstoneHeader), tombstone);
assert.equal(parseSinglePlayerCloudTombstone("world-a", `${tombstoneHeader} `), null,
  "noncanonical tombstone bytes never qualify for idempotent replay");
assert.deepEqual(decideSinglePlayerCloudBackupCommit(decision[2], "opaque", candidate, 1, stateBytes,
  stateBytes + 4_096, 0, 0, 0, "2", 1_800_001), [1, "deduped", decision[2]],
"exact retries retain the original global generation");

console.log("single-player cloud tagged tuple protocol and adversarial reconstruction: ok");
