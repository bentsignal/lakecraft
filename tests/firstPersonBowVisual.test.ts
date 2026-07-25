import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { firstPersonBowChargeStage } from "../client/game/firstPersonRenderer.ts";

assert.deepEqual(
  [0, 0.54, 0.55, 0.89, 0.9, 1].map((progress) => firstPersonBowChargeStage(true, progress)),
  [0, 0, 1, 1, 2, 2],
  "bow geometry has three stable draw stages",
);
assert.equal(firstPersonBowChargeStage(false, 1), 0, "cancel/release returns the retained model to rest");

const source = readFileSync(new URL("../client/game/firstPersonRenderer.ts", import.meta.url), "utf8");
assert.match(source, /const nockX = 0\.43 - chargeStage \* 0\.17/,
  "each stage pulls the solid string nock monotonically toward screen center");
assert.ok(source.includes("appendSegment(output, [-0.72, 0], [nockX + 0.06, 0]"),
  "the arrow stays visibly nocked to the staged string");
assert.ok(source.includes("COLORS.arrowhead") && source.includes("COLORS.fletching"),
  "the charged projectile has a solid shaft, head, and fletching");
assert.equal(source.includes("<svg"), false, "the bow no longer falls back to flat SVG presentation");

const engine = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");
assert.match(engine, /const bowCharging = selectedItem === "bow" && rangedChargeStartedAt > 0/);
assert.match(engine, /firstPersonRenderer\.setBowCharge\([\s\S]{0,240}PLAYER_BOW_FULL_CHARGE_MS/,
  "engine-owned monotonic charge directly selects the retained bow model");
assert.ok(engine.includes('emitHandAction("use");') && engine.includes("options.onRangedRelease?.(intent)"),
  "release keeps a readable pose edge without changing combat authority");

console.log("solid WebGL bow visual tests passed");
