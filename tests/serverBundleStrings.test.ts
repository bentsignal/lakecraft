import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as BS from "../shared/bundleStrings.ts";

const serverSource = readFileSync(new URL("../server/index.ts", import.meta.url), "utf8");
assert.equal(BS.isString("lakecraft"), true, "shared guard accepts primitive strings");
for (const value of [null, undefined, 0, false, {}, [], new String("lakecraft")]) {
  assert.equal(BS.isString(value), false, "shared guard preserves exact typeof-string semantics");
}
const reviewed = [
  ["activePresenceRequired", "active_presence_required", 19],
  ["attackerDead", "attacker_dead", 2],
  ["attackerStateInvalid", "attacker_state_invalid", 2],
  ["authorizationFailure", "authorization_failure", 2],
  ["conflict", "conflict", 15],
  ["craftingTableRequired", "crafting_table_required", 2],
  ["dropIdCollision", "drop_id_collision", 3],
  ["dropLimit", "drop_limit", 3],
  ["duplicateOrMissingState", "duplicate_or_missing_state", 2],
  ["duplicateWorldState", "duplicate_world_state", 4],
  ["furnaceRequired", "furnace_required", 2],
  ["fuseCapacity", "fuse_capacity", 2],
  ["initializationFailed", "initialization_failed", 2],
  ["invalidDeathSettlement", "invalid_death_settlement", 2],
  ["invalidFuse", "invalid_fuse", 3],
  ["invalidOperation", "invalid_operation", 2],
  ["invalidPose", "invalid_pose", 2],
  ["invalidPresenceState", "invalid_presence_state", 2],
  ["invalidReplayInput", "invalid_replay_input", 3],
  ["invalidSession", "invalid_session", 2],
  ["invalidState", "invalid_state", 11],
  ["invalidSupport", "invalid_support", 2],
  ["invalidWorldProbe", "invalid_world_probe", 3],
  ["inventoryRequired", "inventory_required", 14],
  ["mobDead", "mob_dead", 2],
  ["rateLimited", "rate_limited", 3],
  ["revisionConflict", "revision_conflict", 2],
  ["staleSequence", "stale_sequence", 3],
  ["targetStateInvalid", "target_state_invalid", 4],
  ["unknownMob", "unknown_mob", 2],
] as const;

for (const [name, value, references] of reviewed) {
  assert.equal(BS[name], value, `${name} preserves its public runtime value`);
  assert.equal((serverSource.match(new RegExp(`BS\\.${name}\\b`, "g")) ?? []).length, references, `${name} live set changed`);
}
assert.equal((serverSource.match(/"crafting_table_required"/g) ?? []).length, 1, "one erased type spelling remains");
assert.equal((serverSource.match(/"duplicate_world_state"/g) ?? []).length, 1, "one erased type spelling remains");
assert.equal((serverSource.match(/"invalid_state"/g) ?? []).length, 1, "one erased type spelling remains");
assert.doesNotMatch(serverSource, /"(?:active_presence_required|inventory_required)"/);

console.log("server repeated reason string identity and live-set guard: ok");
