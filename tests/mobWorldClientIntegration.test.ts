import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");
const engine = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");
const types = readFileSync(new URL("../client/game/types.ts", import.meta.url), "utf8");

assert.equal(app.includes('"mobWorldAuthority"'), false, "mob snapshots must not use a second client query");
assert.equal(app.includes("mobQuerySample"), false, "the 200ms mob polling sample is removed");
assert.equal(app.includes("<MultiplayerSegmentTransport"), false,
  "the retired Lakebed segment transport is not mounted beside Railway realtime multiplayer");
assert.equal(app.includes("onMobWorldAuthority={setMobWorldAuthority}"), false,
  "the first Railway slice does not pretend its server implements mob authority");
assert.equal(app.includes("mobIds={mobIds}"), false,
  "mob ids are not sent through the retired Lakebed transport");
assert.ok(app.includes("MOB_CHECKPOINT_ATTEMPT_MIN_MS = 30_000"));
assert.ok(app.includes("checkpointForeground"), "menus/background must not checkpoint mob authority");
assert.ok(app.includes('useMutation<[requestJson: string], MobWorldCheckpointResult>("checkpointMobWorld")'));
assert.ok(app.includes('useMutation<[requestJson: string], MobPlayerDamageResult>("claimMobPlayerDamage")'));
assert.ok(app.includes("engineRef.current?.applyMobMotionSnapshot(mobWorldAuthority.poses, clockOffset)"));
assert.ok(app.includes("engineRef.current?.applyMobCombatStates(mobWorldAuthority.states, clockOffset)"));
assert.ok(app.includes("mobDamageClaimsRef.current.has(claim.operationId)"));
assert.ok(app.includes("expectedRevision: mobWorldAuthority.checkpointRevision"));
const mobAttack = app.slice(app.indexOf("onMobAttack:"), app.indexOf("onRemotePlayerAttack:"));
assert.ok(mobAttack.includes("loadCanonicalPlayer(result.inventory)"));
assert.equal(mobAttack.includes("Mob drops collected"), false, "canonical mob drops do not produce a routine top-right toast");
assert.ok(mobAttack.indexOf("!result.replayed && !result.killed") < mobAttack.indexOf("loadCanonicalPlayer(result.inventory)"),
  "receipt replay suppresses only the transient knockback reaction, not canonical inventory reconciliation");

assert.ok(types.includes("applyMobMotionSnapshot(poses: readonly MobMotionPose[]"));
const authorityBranch = engine.slice(
  engine.indexOf("if (sharedMobMotionActive)"),
  engine.indexOf("mobAccumulatorSeconds = Math.min", engine.indexOf("if (sharedMobMotionActive)")),
);
assert.ok(authorityBranch.includes("mobProjectileSnapshots.length = 0"));
assert.equal(authorityBranch.includes("onPlayerDamage"), false);
assert.equal(authorityBranch.includes("stepMobSimulation"), false);

const reconcile = engine.slice(
  engine.indexOf("applyMobMotionSnapshot(poses:"),
  engine.indexOf("getMobIds()", engine.indexOf("applyMobMotionSnapshot(poses:")),
);
assert.ok(reconcile.includes("mob.previousX = displayedX"));
assert.ok(reconcile.includes("mob.x = authoritative.x"));
assert.ok(reconcile.includes("sharedMobMotionAppliedAt = now"));

console.log("mob world client integration tests passed");
