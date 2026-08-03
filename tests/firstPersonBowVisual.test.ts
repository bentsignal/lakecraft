import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  FIRST_PERSON_BOW_ARROW_TIP,
  firstPersonBowChargeStage,
  writeFirstPersonModelMatrix,
} from "../client/game/firstPersonRenderer.ts";

assert.deepEqual(
  [0, 0.54, 0.55, 0.89, 0.9, 1].map((progress) => firstPersonBowChargeStage(true, progress)),
  [0, 0, 1, 1, 2, 2],
  "bow geometry has three stable draw stages",
);
assert.equal(firstPersonBowChargeStage(false, 1), 0, "cancel/release returns the retained model to rest");

const source = readFileSync(new URL("../client/game/firstPersonRenderer.ts", import.meta.url), "utf8");
assert.match(source, /const nockX = 0\.26 - chargeStage \* 0\.10/,
  "each stage pulls the solid string nock monotonically toward screen center");
assert.ok(source.includes("Math.hypot(arrowDx, arrowDy, arrowDz)")
  && source.includes("Math.atan2(arrowDx, arrowDz)"),
"the arrow is a depth-oriented shaft rather than a sideways screen-space segment");
assert.ok(source.includes("ARROWHEAD") && source.includes("FLETCHING"),
  "the charged projectile has a solid shaft, head, and fletching");
assert.equal(source.includes("<svg"), false, "the bow no longer falls back to flat SVG presentation");

const model = writeFirstPersonModelMatrix(new Float32Array(16), [0, 0, 0, 0, 0, 0]);
const tipX = model[0] * FIRST_PERSON_BOW_ARROW_TIP[0]
  + model[4] * FIRST_PERSON_BOW_ARROW_TIP[1]
  + model[8] * FIRST_PERSON_BOW_ARROW_TIP[2] + model[12];
const tipY = model[1] * FIRST_PERSON_BOW_ARROW_TIP[0]
  + model[5] * FIRST_PERSON_BOW_ARROW_TIP[1]
  + model[9] * FIRST_PERSON_BOW_ARROW_TIP[2] + model[13];
assert.ok(Math.abs(tipX) < 0.003 && Math.abs(tipY) < 0.001,
  "the fully drawn visual arrow converges on the unchanged camera crosshair");
assert.equal(source.includes("appendArm(geometry[0]);\n    if (itemId === \"bow\")"), false,
  "bow staging never composes the ordinary one-arm model underneath itself");

const engine = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");
assert.match(engine, /const bowCharging = selectedItem === "bow" && rangedChargeStartedAt > 0/);
assert.match(engine, /setFirstPersonBowCharge\([\s\S]{0,240}PLAYER_BOW_FULL_CHARGE_MS/,
  "engine-owned monotonic charge directly selects the retained bow model");
assert.ok(engine.includes('emitHandAction("use");') && engine.includes("options.onRangedRelease?.(intent)"),
  "release keeps a readable pose edge without changing combat authority");

console.log("solid WebGL bow visual tests passed");
