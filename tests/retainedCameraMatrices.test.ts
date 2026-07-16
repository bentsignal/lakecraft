import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  writeLookAtMatrix,
  writeMatrixProduct,
  writePerspectiveMatrix,
} from "../client/game/voxelEngine.ts";

type Vec3 = [number, number, number];

function referencePerspective(fov: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan(fov / 2);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) / (near - far), -1,
    0, 0, (2 * far * near) / (near - far), 0,
  ]);
}

function referenceLookAt(eye: Vec3, center: Vec3): Float32Array {
  let zx = eye[0] - center[0]; let zy = eye[1] - center[1]; let zz = eye[2] - center[2];
  let length = Math.hypot(zx, zy, zz) || 1;
  zx /= length; zy /= length; zz /= length;
  let xx = zz; let xy = 0; let xz = -zx;
  length = Math.hypot(xx, xy, xz) || 1;
  xx /= length; xy /= length; xz /= length;
  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;
  return new Float32Array([
    xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0,
    -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
    -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
    -(zx * eye[0] + zy * eye[1] + zz * eye[2]), 1,
  ]);
}

function referenceProduct(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(16);
  for (let column = 0; column < 4; column += 1) for (let row = 0; row < 4; row += 1) {
    out[column * 4 + row] = a[row] * b[column * 4] + a[4 + row] * b[column * 4 + 1]
      + a[8 + row] * b[column * 4 + 2] + a[12 + row] * b[column * 4 + 3];
  }
  return out;
}

const backing = new Float32Array(18).fill(77);
const output = backing.subarray(1, 17);
for (const fovDegrees of [30, 70, 90, 110]) for (const aspect of [0.5, 1, 16 / 9, 32 / 9]) {
  output.fill(Number.NaN);
  assert.equal(writePerspectiveMatrix(output, fovDegrees * Math.PI / 180, aspect, 0.05, 90), output);
  assert.deepEqual(output, referencePerspective(fovDegrees * Math.PI / 180, aspect, 0.05, 90));
  assert.equal(backing[0], 77); assert.equal(backing[17], 77);
  assert.equal(Array.from(output).some(Number.isNaN), false, "perspective overwrites every retained slot");
}

for (const eye of [[0, 8, 0], [-90, -4, 120], [250_000, 64, -250_000], [1, 2, 3]] as Vec3[]) {
  for (const center of [[0, 8, -1], [9, 20, 4], [-250, 80, 91], eye] as Vec3[]) {
    output.fill(Number.NaN);
    assert.equal(writeLookAtMatrix(output, eye, center), output);
    assert.deepEqual(output, referenceLookAt(eye, center));
    assert.equal(Array.from(output).some(Number.isNaN), false, "lookAt overwrites every retained slot");
  }
}

let seed = 0x114cafe;
const random = (): number => {
  seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
  return (seed / 0x1_0000_0000 - 0.5) * 20;
};
for (let sample = 0; sample < 256; sample += 1) {
  const left = Float32Array.from({ length: 16 }, random);
  const right = Float32Array.from({ length: 16 }, random);
  const leftBefore = left.slice(); const rightBefore = right.slice();
  output.fill(Number.NaN);
  assert.equal(writeMatrixProduct(output, left, right), output);
  assert.deepEqual(output, referenceProduct(left, right));
  assert.deepEqual(left, leftBefore); assert.deepEqual(right, rightBefore);
}

const source = await readFile(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");
const render = source.slice(source.indexOf("function render("), source.indexOf("\n  function frame("));
for (const retainedCall of [
  "cameraEye(renderEye)", "direction(renderFacing)", "writePerspectiveMatrix(projectionMatrix",
  "writeLookAtMatrix(viewMatrix, eye, renderCenter)", "writeMatrixProduct(mvpMatrix, projectionMatrix, viewMatrix)",
]) assert.ok(render.includes(retainedCall), `render uses retained camera state: ${retainedCall}`);
assert.doesNotMatch(render, /cameraEye\(\)|direction\(\)|new Float32Array|lookAt\(eye, \[/);
const update = source.slice(source.indexOf("function update(dt"), source.indexOf("\n  function bindBuffer"));
assert.ok(update.includes("interactionEye(raycastEye)") && update.includes("direction(raycastFacing)"));
assert.equal(13 * 60 * 60, 46_800, "render and target-ray hot paths avoid 46,800 explicit objects per minute at 60 FPS");

console.log("retained camera vectors and matrix parity tests passed");
