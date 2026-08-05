import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  firstPersonBowChargeStage,
} from "../client/game/firstPersonRenderer.ts";
import { getBowIconArt } from "../client/components/itemIconArt.ts";
import { appendItemSpriteGeometry } from "../client/game/itemSpriteGeometry.ts";

assert.deepEqual(
  [0, 0.54, 0.55, 0.89, 0.9, 1].map((progress) => firstPersonBowChargeStage(true, progress)),
  [0, 0, 1, 1, 2, 2],
  "bow geometry has three stable draw stages",
);
assert.equal(firstPersonBowChargeStage(false, 1), 0, "cancel/release returns the retained model to rest");

const source = readFileSync(new URL("../client/game/firstPersonRenderer.ts", import.meta.url), "utf8");
const stageGeometry = [0, 1, 2, 3].map((stage) => {
  const output: number[] = [];
  appendItemSpriteGeometry(output, getBowIconArt(stage as 0 | 1 | 2 | 3));
  return output;
});
assert.equal(new Set(stageGeometry.map((geometry) => JSON.stringify(geometry))).size, 4,
  "idle and three draw states resolve to distinct canonical opaque-edge geometry");
assert.ok(source.includes("getBowIconArt(charging ? chargeStage + 1")
  && source.includes("appendItemSpriteGeometry"),
"the monotonic charge stage selects the shared inventory/held bow artwork");
assert.equal(source.includes("<svg"), false, "the bow no longer falls back to flat SVG presentation");
assert.equal(source.includes("appendArm(geometry[0]);\n    if (itemId === \"bow\")"), false,
  "bow staging never composes the ordinary one-arm model underneath itself");

const engine = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");
assert.match(engine, /const bowCharging = selectedItem === "bow" && rangedChargeStartedAt > 0/);
assert.match(engine, /setFirstPersonBowCharge\([\s\S]{0,240}PLAYER_BOW_FULL_CHARGE_MS/,
  "engine-owned monotonic charge directly selects the retained bow model");
assert.ok(engine.includes('emitHandAction("use");') && engine.includes("options.onRangedRelease?.(intent)"),
  "release keeps a readable pose edge without changing combat authority");

console.log("solid WebGL bow visual tests passed");
