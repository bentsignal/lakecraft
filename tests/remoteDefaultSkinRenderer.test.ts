import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRemoteAvatarMotion, type RemoteAvatarMotion } from "../client/game/avatar.ts";
import {
  BASE_AVATAR_VERTICES_PER_PLAYER,
  REMOTE_DEFAULT_PLAYER_BOX_COUNT,
  REMOTE_DEFAULT_PLAYER_HEIGHT,
  remotePlayerBufferCapacity,
} from "../client/game/remotePlayerRenderer.ts";
import {
  REMOTE_SKIN_FLOATS_PER_PLAYER,
  createRemotePlayerSkinRenderer,
  writeRemotePlayerSkinGeometry,
} from "../client/game/remotePlayerSkinRenderer.ts";
import {
  buildPlayerSkinGeometry,
  PLAYER_SKIN_BOX_COUNT,
  PLAYER_SKIN_VERTEX_COUNT,
  PLAYER_SKIN_VERTEX_STRIDE,
} from "../client/game/playerSkinGeometry.ts";
import type { RemotePlayer } from "../client/game/types.ts";

const player: RemotePlayer = { id: "default-skin-rig", name: "Explorer", x: 0, y: 1, z: 0, yaw: 0, pitch: 0 };
const state = createRemoteAvatarMotion(player, 0);
const states = new Map<string, RemoteAvatarMotion>([[state.id, state]]);
const output = new Float32Array(REMOTE_SKIN_FLOATS_PER_PLAYER);
const vertexCount = writeRemotePlayerSkinGeometry(states, [0, 2, -4], output);
const canonical = buildPlayerSkinGeometry("wide");
const rendererSource = readFileSync(new URL("../client/game/remotePlayerSkinRenderer.ts", import.meta.url), "utf8");
assert.equal(
  rendererSource.match(/buildPlayerSkinGeometry\("wide"\)/g)?.length,
  1,
  "canonical skin geometry is built once at module initialization, never inside the 30Hz batch writer",
);
const engineSource = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");
assert.ok(engineSource.includes("remoteStats.updated || (remoteStates.size === 0 && remoteSkinVertexCount !== 0)"),
  "an already-empty remote batch skips skin geometry work while the first empty frame clears stale vertices");

assert.equal(REMOTE_DEFAULT_PLAYER_BOX_COUNT, PLAYER_SKIN_BOX_COUNT);
assert.equal(REMOTE_DEFAULT_PLAYER_HEIGHT, 2);
assert.equal(BASE_AVATAR_VERTICES_PER_PLAYER, PLAYER_SKIN_VERTEX_COUNT);
assert.equal(vertexCount, PLAYER_SKIN_VERTEX_COUNT, "one remote uses the complete base+outer-layer skin mesh");
for (let vertex = 0; vertex < vertexCount; vertex += 1) {
  const offset = vertex * PLAYER_SKIN_VERTEX_STRIDE;
  assert.deepEqual(
    [...output.subarray(offset + 3, offset + 6)],
    [...canonical.subarray(offset + 3, offset + 6)],
    `remote vertex ${vertex} preserves canonical UV and face shade`,
  );
}

let minY = Infinity; let maxY = -Infinity;
for (let offset = 0; offset < vertexCount * PLAYER_SKIN_VERTEX_STRIDE; offset += PLAYER_SKIN_VERTEX_STRIDE) {
  minY = Math.min(minY, output[offset + 1]);
  maxY = Math.max(maxY, output[offset + 1]);
}
assert.ok(minY > 0.98 && minY < 1, "outer trouser layer extends a fraction below the base feet");
assert.ok(maxY > 3 && maxY < 3.04, "outer hat layer preserves the two-block canonical silhouette");

const idle = output.slice();
state.horizontalSpeed = 4;
state.walkPhase = Math.PI / 2;
writeRemotePlayerSkinGeometry(states, [0, 2, -4], output);
const torsoStart = 2 * 36 * PLAYER_SKIN_VERTEX_STRIDE;
const torsoEnd = 4 * 36 * PLAYER_SKIN_VERTEX_STRIDE;
assert.deepEqual(output.slice(torsoStart, torsoEnd), idle.slice(torsoStart, torsoEnd), "walk cycle keeps the torso stable");
const armStart = 4 * 36 * PLAYER_SKIN_VERTEX_STRIDE;
const armEnd = 8 * 36 * PLAYER_SKIN_VERTEX_STRIDE;
assert.notDeepEqual(output.slice(armStart, armEnd), idle.slice(armStart, armEnd), "canonical arms animate for remote walking");

let unpackFlip = 1;
let uploadedFlip = -1;
const blendEvents: string[] = [];
const textureUnits: number[] = [];
const fakeGl = {
  ARRAY_BUFFER: 0x8892, DYNAMIC_DRAW: 0x88e8, FLOAT: 0x1406,
  VERTEX_SHADER: 0x8b31, FRAGMENT_SHADER: 0x8b30, COMPILE_STATUS: 0x8b81, LINK_STATUS: 0x8b82,
  TEXTURE_2D: 0x0de1, TEXTURE0: 0x84c0, TEXTURE_MIN_FILTER: 0x2801, TEXTURE_MAG_FILTER: 0x2800,
  TEXTURE_WRAP_S: 0x2802, TEXTURE_WRAP_T: 0x2803, NEAREST: 0x2600, CLAMP_TO_EDGE: 0x812f,
  RGBA: 0x1908, UNSIGNED_BYTE: 0x1401, UNPACK_FLIP_Y_WEBGL: 0x9240,
  BLEND: 0x0be2, SRC_ALPHA: 0x0302, ONE_MINUS_SRC_ALPHA: 0x0303, TRIANGLES: 4,
  createShader: () => ({}), shaderSource: () => undefined, compileShader: () => undefined,
  getShaderParameter: () => true, getShaderInfoLog: () => "", deleteShader: () => undefined,
  createProgram: () => ({}), attachShader: () => undefined, linkProgram: () => undefined,
  getProgramParameter: () => true, getProgramInfoLog: () => "", deleteProgram: () => undefined,
  createBuffer: () => ({}), deleteBuffer: () => undefined, bindBuffer: () => undefined,
  bufferData: () => undefined, bufferSubData: () => undefined,
  createTexture: () => ({}), deleteTexture: () => undefined, bindTexture: () => undefined,
  pixelStorei: (name: number, value: number) => { if (name === 0x9240) unpackFlip = value; },
  texParameteri: () => undefined, texImage2D: () => { uploadedFlip = unpackFlip; },
  getAttribLocation: (_program: unknown, name: string) => ({ aPosition: 0, aUv: 1, aShade: 2 })[name] ?? -1,
  getUniformLocation: () => ({}), useProgram: () => undefined, enableVertexAttribArray: () => undefined,
  vertexAttribPointer: () => undefined, uniformMatrix4fv: () => undefined, uniform3f: () => undefined,
  uniform1i: () => undefined, activeTexture: (unit: number) => textureUnits.push(unit),
  enable: (state: number) => { if (state === 0x0be2) blendEvents.push("enable"); },
  disable: (state: number) => { if (state === 0x0be2) blendEvents.push("disable"); },
  blendFunc: () => undefined, drawArrays: () => blendEvents.push("draw"),
} as unknown as WebGLRenderingContext;
const glRenderer = createRemotePlayerSkinRenderer(fakeGl);
assert.equal(uploadedFlip, 0, "remote default skin upload resets inherited UNPACK_FLIP_Y_WEBGL state");
glRenderer.update(states, [0, 2, -4]);
glRenderer.draw(new Float32Array(16), [1, 1, 1]);
assert.deepEqual(blendEvents, ["enable", "draw", "disable"], "remote skin draw contains its blend state");
assert.deepEqual(textureUnits, [fakeGl.TEXTURE0], "remote skin explicitly samples texture unit zero");
glRenderer.destroy();

const capacity = remotePlayerBufferCapacity(32);
assert.equal(capacity.skinFloats, 32 * REMOTE_SKIN_FLOATS_PER_PLAYER);
assert.equal(capacity.avatarFloats / 32 / PLAYER_SKIN_VERTEX_STRIDE, 10 * 36 + 24 * 6,
  "gear batch carries only bounded armor and held-item geometry, never a duplicate body");

console.log(JSON.stringify({
  benchmark: "remote canonical installed-skin batch",
  boxesPerPlayer: REMOTE_DEFAULT_PLAYER_BOX_COUNT,
  skinVerticesPerPlayer: BASE_AVATAR_VERTICES_PER_PLAYER,
  skinCapacityBytes32: capacity.skinFloats * Float32Array.BYTES_PER_ELEMENT,
}));
