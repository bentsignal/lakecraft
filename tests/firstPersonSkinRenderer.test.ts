import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  FIRST_PERSON_SKIN_ARM_BUFFER_BYTES,
  FIRST_PERSON_SKIN_ARM_VERTICES,
  FIRST_PERSON_SKIN_SLEEVE_INFLATE,
  buildFirstPersonSkinArmGeometry,
} from "../client/game/firstPersonSkinRenderer.ts";
import { PLAYER_SKIN_BOX_FLOATS, PLAYER_SKIN_VERTEX_STRIDE } from "../client/game/playerSkinGeometry.ts";

const source = readFileSync(new URL("../client/game/firstPersonSkinRenderer.ts", import.meta.url), "utf8");
assert.equal(FIRST_PERSON_SKIN_ARM_VERTICES, 72, "one anatomical arm retains its concentric standard-skin sleeve layer");
assert.equal(buildFirstPersonSkinArmGeometry("wide").length, FIRST_PERSON_SKIN_ARM_VERTICES * 6);
assert.equal(FIRST_PERSON_SKIN_ARM_BUFFER_BYTES, FIRST_PERSON_SKIN_ARM_VERTICES * 6 * 4);
assert.equal(FIRST_PERSON_SKIN_SLEEVE_INFLATE, 0.015625, "the sleeve is a thin quarter-pixel shell");
assert.equal(buildFirstPersonSkinArmGeometry("wide").length, PLAYER_SKIN_BOX_FLOATS * 2,
  "the camera view contains one base arm and its standard-UV sleeve, never a separate fist");
assert.equal(buildFirstPersonSkinArmGeometry("slim").length / PLAYER_SKIN_VERTEX_STRIDE, 72,
  "the slim model remains one anatomical three-pixel-wide arm plus its sleeve");
const arm = buildFirstPersonSkinArmGeometry("wide");
const centroid = (start: number): number[] => {
  const sum = [0, 0, 0];
  for (let offset = start; offset < start + PLAYER_SKIN_BOX_FLOATS; offset += PLAYER_SKIN_VERTEX_STRIDE) {
    sum[0] += arm[offset]; sum[1] += arm[offset + 1]; sum[2] += arm[offset + 2];
  }
  return sum.map((value) => Number((value / 36).toFixed(6)));
};
assert.deepEqual(centroid(0), centroid(PLAYER_SKIN_BOX_FLOATS),
  "the sleeve is concentric with the anatomical arm and cannot read as an offset hand box");
const uvBounds = (start: number): readonly [number, number, number, number] => {
  let minU = Infinity; let maxU = -Infinity; let minV = Infinity; let maxV = -Infinity;
  for (let offset = start; offset < start + PLAYER_SKIN_BOX_FLOATS; offset += PLAYER_SKIN_VERTEX_STRIDE) {
    minU = Math.min(minU, arm[offset + 3]); maxU = Math.max(maxU, arm[offset + 3]);
    minV = Math.min(minV, arm[offset + 4]); maxV = Math.max(maxV, arm[offset + 4]);
  }
  return [minU, maxU, minV, maxV];
};
assert.notDeepEqual(uvBounds(0), uvBounds(PLAYER_SKIN_BOX_FLOATS),
  "the retained sleeve samples the standard second-layer UV island rather than duplicating base-arm pixels");
for (const contract of [
  "buildPlayerSkinPartGeometry", 'buildPlayerSkinPartGeometry("rightArm", model, FIRST_PERSON_SKIN_SLEEVE_INFLATE)', "gl.NEAREST", "uSkin", "uLight",
  "setSkin(source, nextModel)", "gl.drawArrays(gl.TRIANGLES, 0, FIRST_PERSON_SKIN_ARM_VERTICES)",
]) assert.ok(source.includes(contract), `first-person skin renderer retains ${contract}`);
assert.doesNotMatch(source, /setInterval|requestAnimationFrame|fetch\(/);
console.log("first-person standard-skin arm renderer tests passed");
