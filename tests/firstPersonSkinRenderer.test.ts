import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  FIRST_PERSON_SKIN_ARM_BUFFER_BYTES,
  FIRST_PERSON_SKIN_ARM_VERTICES,
  buildFirstPersonSkinArmGeometry,
} from "../client/game/firstPersonSkinRenderer.ts";

const source = readFileSync(new URL("../client/game/firstPersonSkinRenderer.ts", import.meta.url), "utf8");
assert.equal(FIRST_PERSON_SKIN_ARM_VERTICES, 72, "base arm and transparent sleeve remain one fixed batch");
assert.equal(buildFirstPersonSkinArmGeometry("wide").length, FIRST_PERSON_SKIN_ARM_VERTICES * 6);
assert.equal(FIRST_PERSON_SKIN_ARM_BUFFER_BYTES, FIRST_PERSON_SKIN_ARM_VERTICES * 6 * 4);
for (const contract of [
  "buildPlayerSkinPartGeometry", 'buildPlayerSkinPartGeometry("rightArm", model)', "gl.NEAREST", "uSkin", "uLight",
  "setSkin(source, nextModel)", "gl.drawArrays(gl.TRIANGLES, 0, FIRST_PERSON_SKIN_ARM_VERTICES)",
]) assert.ok(source.includes(contract), `first-person skin renderer retains ${contract}`);
assert.doesNotMatch(source, /setInterval|requestAnimationFrame|fetch\(/);
console.log("first-person standard-skin arm renderer tests passed");
