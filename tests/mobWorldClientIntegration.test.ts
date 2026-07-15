import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");
const engine = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");
const types = readFileSync(new URL("../client/game/types.ts", import.meta.url), "utf8");

assert.ok(app.includes('useQuery<MobWorldAuthorityResult, { mobIds: string[]; sample: string }>('));
assert.ok(app.includes('{ mobIds, sample: inWorld ? mobQuerySample : "0" }'));
assert.ok(app.includes("window.setInterval(() => setMobQuerySample(String(Date.now())), 200)"));
assert.ok(app.includes('useMutation<[requestJson: string], MobWorldCheckpointResult>("checkpointMobWorld")'));
assert.ok(app.includes('useMutation<[requestJson: string], MobPlayerDamageResult>("claimMobPlayerDamage")'));
assert.ok(app.includes("engineRef.current?.applyMobMotionSnapshot(mobWorldAuthority.poses, clockOffset)"));
assert.ok(app.includes("engineRef.current?.applyMobCombatStates(mobWorldAuthority.states, clockOffset)"));
assert.ok(app.includes("mobDamageClaimsRef.current.has(claim.operationId)"));
assert.ok(app.includes("expectedRevision: mobWorldAuthority.checkpointRevision"));
const mobAttack = app.slice(app.indexOf("onMobAttack:"), app.indexOf("onRemotePlayerAttack:"));
assert.ok(mobAttack.includes("loadCanonicalPlayer(result.inventory)"));
assert.ok(mobAttack.includes("result.killed && result.drops.length"));
assert.equal(mobAttack.includes("!result.replayed"), false, "replayed attacks must reconcile the same server inventory");

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
