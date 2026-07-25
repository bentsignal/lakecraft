import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  advanceLocalMobAttackReadyAt,
  localMobAttackIsReady,
} from "../client/game/voxelEngine.ts";
import { PLAYER_ATTACK_COOLDOWN_MS } from "../shared/playerCombat.ts";

const firstAttackAt = 1_000;
const readyAt = advanceLocalMobAttackReadyAt(0, firstAttackAt, true);
assert.equal(readyAt, firstAttackAt + PLAYER_ATTACK_COOLDOWN_MS);
assert.equal(localMobAttackIsReady(readyAt, readyAt - 1), false, "499ms cannot apply a second local hit");
assert.equal(localMobAttackIsReady(readyAt, readyAt), true, "the shared 500ms boundary accepts exactly");
assert.equal(localMobAttackIsReady(readyAt, Number.NaN), false, "an invalid clock cannot bypass the cooldown");
assert.equal(
  advanceLocalMobAttackReadyAt(readyAt, readyAt - 1, false),
  readyAt,
  "cooldown rejection cannot move the deadline",
);
assert.equal(
  advanceLocalMobAttackReadyAt(readyAt, readyAt, false),
  readyAt,
  "a rejected fatal-drop reservation cannot consume the next legal hit",
);
assert.equal(
  advanceLocalMobAttackReadyAt(readyAt, readyAt, true),
  readyAt + PLAYER_ATTACK_COOLDOWN_MS,
  "one confirmed post-boundary hit advances one cooldown",
);

const engine = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");
const delegatedStart = engine.indexOf("if (options.onMobAttack)");
const localGate = engine.indexOf("const attackNow = performance.now()", delegatedStart);
const damageCall = engine.indexOf("const result = damageMob", localGate);
const localEnd = engine.indexOf("writeMobPoseSnapshots", damageCall);
assert.ok(delegatedStart > 0 && localGate > delegatedStart && damageCall > localGate && localEnd > damageCall);
const delegatedBranch = engine.slice(delegatedStart, localGate);
const localBranch = engine.slice(localGate, localEnd);
assert.equal(delegatedBranch.includes("localMobAttackIsReady"), false, "Lakebed-delegated mob attacks remain server-authoritative");
assert.match(localBranch, /if \(!localMobAttackIsReady[\s\S]*?return true;[\s\S]*?damageMob/,
  "a cooldown mob target retains click priority without reaching damage");
assert.match(localBranch, /if \(result\.applied\) \{[\s\S]*?advanceLocalMobAttackReadyAt[\s\S]*?onLocalMobHit[\s\S]*?emitHandAction/,
  "only confirmed health reduction advances cooldown, spends durability, and emits hit feedback");
assert.equal((localBranch.match(/emitHandAction\("attack"\)/g) ?? []).length, 1,
  "cooldown rejection emits no swing or hit audio token");

console.log("single-player local melee cooldown tests passed");
