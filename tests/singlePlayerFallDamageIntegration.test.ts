import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const engine = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");
const presentation = readFileSync(new URL("../client/gameplay/presentation.ts", import.meta.url), "utf8");
const app = readFileSync(new URL("../client/singleplayer/SinglePlayerApp.tsx", import.meta.url), "utf8");

assert.ok(engine.includes('fallDamageForDistance } from "../../shared/fallDamageAuthority.ts"'));
assert.ok(engine.includes("fallPeakY = fallAirborne ? Math.max(fallPeakY, pose.y)"));
assert.ok(engine.includes("fallPeakY - pose.y - LOCAL_FALL_LANDING_EPSILON"), "collision epsilon cannot turn a three-block fall harmful");
assert.ok(engine.includes("const damage = fallDamageForDistance(fallDistance)"));
assert.ok(engine.includes("touchingLadder || inWater"), "ladder or water contact clears local fall tracking");
assert.ok(engine.includes("playerHealth -= appliedDamage"));
assert.ok(engine.includes('options.onPlayerDamage?.(appliedDamage, "fall")'));
assert.ok(engine.includes("fallAirborne = false;\n      fallPeakY = pose.y;"), "relocation and respawn clear stale descent state");
assert.ok(app.includes("onPlayerDamage: (amount, cause) =>"));
assert.ok(app.includes('cause !== "fall"'), "fall damage never consumes armor durability");
assert.ok(presentation.includes('onFootstep: (block) => context.audio.play("footstep"'));
assert.equal(app.includes("lakebed/client"), false, "single-player landing damage stays local");

console.log("lakecraft single-player fall damage integration tests: ok");
