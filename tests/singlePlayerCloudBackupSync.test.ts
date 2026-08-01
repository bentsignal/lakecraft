import assert from "node:assert/strict";
import {
  parseSinglePlayerCloudMutationWire,
  parseSinglePlayerCloudQueryWire,
  parseSinglePlayerCloudDescriptor,
  singlePlayerCloudUploadRevision,
  type PreparedSinglePlayerCloudBackup,
  type SinglePlayerCloudBackupWire,
  type SinglePlayerCloudLineage,
} from "../client/singleplayer/cloudBackupClient.ts";

const local = (raw: string, sequence = 1, savedAt = 10, checksum = "00000000", revision = "1"):
  PreparedSinglePlayerCloudBackup => [JSON.stringify([1, "world-a", "World A", 1, "survival", 1, revision, raw]), raw,
    sequence, savedAt, checksum];
const remote = (raw: string, revision = "1"): SinglePlayerCloudBackupWire =>
  [1, "world-a", "World A", "1", "survival", "1", "00000000", raw, revision, "20"];

const baseline = local("baseline");
const lineage: SinglePlayerCloudLineage = ["1", baseline[2], baseline[3], baseline[4]];
assert.equal(singlePlayerCloudUploadRevision(baseline, null, null, false), "0");
assert.equal(singlePlayerCloudUploadRevision(baseline, remote("different"), null, false), null,
  "an unknown cloud generation is never overwritten");
assert.equal(singlePlayerCloudUploadRevision(baseline, null, lineage, false), null,
  "a deleted cloud generation is never silently recreated");
assert.equal(singlePlayerCloudUploadRevision(baseline, remote("baseline"), null, false), null,
  "exact queried bytes are already fresh");
const descendant = local("next", 2, 20, "11111111");
const authorized = singlePlayerCloudUploadRevision(descendant, remote("baseline"), lineage, false);
assert.equal(authorized, "1",
  "a strict local journal descendant may compare-and-swap its known generation");
assert.equal(JSON.parse(descendant[0])[6], authorized,
  "the stable tuple authorized by ancestry already carries the exact CAS token dispatched to mutation");
assert.equal(singlePlayerCloudUploadRevision(local("rollback", 1, 20, "11111111"), remote("baseline"), lineage, false), null,
  "same-sequence checksum disagreement cannot establish ancestry");
assert.equal(singlePlayerCloudUploadRevision(local("next", 2, 20), remote("recreated", "2"), lineage, false), null,
  "delete and recreate receives a different global generation and cannot reuse stale ancestry");
assert.equal(singlePlayerCloudUploadRevision(local("next", 2, 20), remote("baseline"), lineage, true), null,
  "durable delete opt-out suppresses later autosaves");

assert.deepEqual(parseSinglePlayerCloudQueryWire([]), []);
for (const descriptor of [[1, "world-a", "3", "2", "10"], [2, "4"], [3, "world-a", "0"]]) {
  assert.deepEqual(parseSinglePlayerCloudDescriptor(descriptor), descriptor);
}
for (const descriptor of [[1, "world-a", "0", "2", "10"], [2, "0"], [3, "World A", "0"],
  [3, "world-a", "0", "extra"]]) assert.equal(parseSinglePlayerCloudDescriptor(descriptor), null);
for (const wire of [[1, 10, [], []], [2, 10], [3, 10, "4"]]) assert.deepEqual(parseSinglePlayerCloudQueryWire(wire), wire);
for (const wire of [[1, 10, []], [1, 10, [], [], 0], [4, 10], [2, "10"], [1, 8_640_000_000_000_001, [], []],
  [3, 10], [3, 10, "bad"], [1, 10, new Array(1), []], {}, null]) assert.equal(parseSinglePlayerCloudQueryWire(wire), null);
const mutationWires = [[1, "1", 10], [2, "2", 10], [3, "cloud_capacity", 10], [3, "world_limit", 10],
  [4, 10], [5, "conflict", 10], [6, 1, 10], [7, "3", 0, 10], [7, "3", 1, 10], [8, "4", 10]];
for (const wire of mutationWires) assert.deepEqual(parseSinglePlayerCloudMutationWire(wire), wire);
const sparse = new Array(3); sparse[0] = 1; sparse[2] = 10;
for (const wire of [[1, "1"], [1, "1", 10, 0], [2, 10], [7, "conflict", 10], [7, "0", 1, 10], [7, "2", 2, 10],
  [7, "2", 1, 8_640_000_000_000_001],
  [1, String(Number.MAX_SAFE_INTEGER), 10], [3, "conflict", 10], [5, "", 10], [6, 0, 10],
  [6, 8_640_000_000_000_001, 10], [2, 8_640_000_000_000_001], sparse, {}, null]) {
  assert.equal(parseSinglePlayerCloudMutationWire(wire), null);
}

console.log("single-player cloud global-generation lineage decisions passed");
