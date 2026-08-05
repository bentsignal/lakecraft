import assert from "node:assert/strict";
import {
  PLAYER_SKIN_MAX_BYTES,
  PLAYER_SKIN_STORAGE_KEY,
  clearPersistedPlayerSkin,
  inspectPlayerSkinPng,
  loadPersistedPlayerSkin,
  savePersistedPlayerSkin,
} from "../client/game/playerSkin.ts";
import {
  PLAYER_SKIN_BOX_COUNT,
  PLAYER_SKIN_BOX_FLOATS,
  PLAYER_SKIN_VERTEX_COUNT,
  PLAYER_SKIN_VERTEX_STRIDE,
  buildPlayerSkinGeometry,
  buildPlayerSkinPartGeometry,
  PLAYER_SKIN_PART_BOX_RANGES,
} from "../client/game/playerSkinGeometry.ts";

function pngHeader(width: number, height: number, colorType = 6, bitDepth = 8, interlace = 0): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
  for (let index = 0; index < 4; index += 1) {
    bytes[16 + index] = width >>> (24 - index * 8) & 255;
    bytes[20 + index] = height >>> (24 - index * 8) & 255;
  }
  bytes[24] = bitDepth; bytes[25] = colorType; bytes[28] = interlace;
  return bytes;
}

assert.deepEqual(inspectPlayerSkinPng(pngHeader(64, 64)), { width: 64, height: 64, bytes: 33 });
assert.deepEqual(inspectPlayerSkinPng(pngHeader(128, 128)), { width: 128, height: 128, bytes: 33 });
assert.deepEqual(inspectPlayerSkinPng(pngHeader(64, 64, 3, 4)), { width: 64, height: 64, bytes: 33 },
  "indexed PNG skins are accepted because the browser normalizes their palette and tRNS alpha");
assert.deepEqual(inspectPlayerSkinPng(pngHeader(128, 128, 6, 8, 1)), { width: 128, height: 128, bytes: 33 },
  "Adam7-interlaced skins are accepted");
assert.deepEqual(inspectPlayerSkinPng(pngHeader(64, 64, 0, 1)), { width: 64, height: 64, bytes: 33 },
  "legal grayscale PNG exports are accepted");
assert.throws(() => inspectPlayerSkinPng(pngHeader(64, 32)), /64×64 skin/);
assert.throws(() => inspectPlayerSkinPng(pngHeader(256, 256)), /64×64 skin/);
assert.throws(() => inspectPlayerSkinPng(pngHeader(64, 64, 3, 16)), /standard grayscale, indexed, RGB, or RGBA/);
assert.throws(() => inspectPlayerSkinPng(pngHeader(64, 64, 5, 8)), /standard grayscale, indexed, RGB, or RGBA/);
assert.throws(() => inspectPlayerSkinPng(pngHeader(64, 64, 6, 8, 2)), /standard compression, filtering, and interlacing/);
assert.throws(() => inspectPlayerSkinPng(new Uint8Array(PLAYER_SKIN_MAX_BYTES + 1)), /smaller than 2 MB/);

const values = new Map<string, string>();
const storage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => { values.set(key, value); },
  removeItem: (key: string) => { values.delete(key); },
};
const persisted = {
  version: 1 as const,
  name: "user-owned-skin.png",
  width: 64 as const,
  height: 64 as const,
  model: "slim" as const,
  dataUrl: "data:image/png;base64,iVBORw0KGgo=",
};
const persistedBeforeSave = { ...persisted };
assert.equal(savePersistedPlayerSkin(storage, persisted), true);
assert.deepEqual(persisted, persistedBeforeSave, "canonical serialization never mutates its input");
assert.equal(Object.isFrozen(persisted), false, "saving does not freeze the caller-owned input object");
const persistedJson = values.get(PLAYER_SKIN_STORAGE_KEY);
assert.equal(
  persistedJson,
  '{"version":1,"name":"user-owned-skin.png","width":64,"height":64,"model":"slim","dataUrl":"data:image/png;base64,iVBORw0KGgo="}',
  "the versioned storage schema has literal keys in one canonical order",
);
assert.deepEqual(Object.keys(JSON.parse(persistedJson!)), ["version", "name", "width", "height", "model", "dataUrl"]);
const loadedPersisted = loadPersistedPlayerSkin(storage);
assert.deepEqual(loadedPersisted, persisted, "the selected skin and arm model survive reload locally");
assert.equal(Object.isFrozen(loadedPersisted), true, "loaded canonical records are immutable");
values.set(PLAYER_SKIN_STORAGE_KEY, JSON.stringify({ ...persisted, model: "unknown" }));
assert.equal(loadPersistedPlayerSkin(storage), null, "malformed local records fail closed");
values.set(PLAYER_SKIN_STORAGE_KEY, JSON.stringify({ ...persisted, version: 2 }));
assert.equal(loadPersistedPlayerSkin(storage), null, "future versions fail closed instead of guessing a schema");
values.set(PLAYER_SKIN_STORAGE_KEY, JSON.stringify({ ...persisted, extra: true }));
assert.equal(loadPersistedPlayerSkin(storage), null, "unknown storage keys fail closed");
values.set(
  PLAYER_SKIN_STORAGE_KEY,
  '{"version":1,"name":"user-owned-skin.png","width":64,"height":64,"a9":"slim","Vt":"data:image/png;base64,iVBORw0KGgo="}',
);
assert.equal(loadPersistedPlayerSkin(storage), null, "compact aliases are never accepted as a storage schema");
values.set(PLAYER_SKIN_STORAGE_KEY, JSON.stringify(persisted));
assert.equal(clearPersistedPlayerSkin(storage), true);
assert.equal(loadPersistedPlayerSkin(storage), null, "restoring the bundled skin removes only the skin preference");
assert.equal(savePersistedPlayerSkin({ getItem: () => null, setItem: () => { throw new Error("full"); } }, persisted), false,
  "storage quota failures do not make an in-session skin import fail");

for (const model of ["wide", "slim"] as const) {
  const geometry = buildPlayerSkinGeometry(model);
  assert.equal(geometry.length, PLAYER_SKIN_VERTEX_COUNT * PLAYER_SKIN_VERTEX_STRIDE);
  assert.equal(PLAYER_SKIN_BOX_COUNT, 12);
  for (let index = 0; index < geometry.length; index += PLAYER_SKIN_VERTEX_STRIDE) {
    assert.ok(Number.isFinite(geometry[index]) && Number.isFinite(geometry[index + 1]) && Number.isFinite(geometry[index + 2]));
    assert.ok(geometry[index + 3] >= 0 && geometry[index + 3] <= 1);
    assert.ok(geometry[index + 4] >= 0 && geometry[index + 4] <= 1);
    assert.ok(geometry[index + 5] > 0 && geometry[index + 5] <= 1);
  }
  const xs = geometry.filter((_, index) => index % PLAYER_SKIN_VERTEX_STRIDE === 0);
  const ys = geometry.filter((_, index) => index % PLAYER_SKIN_VERTEX_STRIDE === 1);
  assert.ok(Math.min(...ys) < 0 && Math.max(...ys) > 2, "outer layers surround the exact two-block-tall base rig");
  assert.ok(Math.max(...xs) > 0.43 && Math.min(...xs) < -0.43, "both arms extend from the torso");
}
assert.notDeepEqual(buildPlayerSkinGeometry("wide"), buildPlayerSkinGeometry("slim"));
const wideArm = buildPlayerSkinPartGeometry("rightArm", "wide");
const boxBounds = (data: Float32Array, box: 0 | 1) => {
  const start = box * PLAYER_SKIN_BOX_FLOATS;
  const end = start + PLAYER_SKIN_BOX_FLOATS;
  const min = [Infinity, Infinity, Infinity]; const max = [-Infinity, -Infinity, -Infinity];
  for (let offset = start; offset < end; offset += PLAYER_SKIN_VERTEX_STRIDE) for (let axis = 0; axis < 3; axis += 1) {
    min[axis] = Math.min(min[axis], data[offset + axis]);
    max[axis] = Math.max(max[axis], data[offset + axis]);
  }
  return { min, max };
};
const baseArmBounds = boxBounds(wideArm, 0); const sleeveBounds = boxBounds(wideArm, 1);
for (let axis = 0; axis < 3; axis += 1) {
  assert.ok(Math.abs(baseArmBounds.min[axis] - sleeveBounds.min[axis] - 0.015625) < 1e-7,
    `sleeve axis ${axis} starts exactly one quarter-pixel outside the arm`);
  assert.ok(Math.abs(sleeveBounds.max[axis] - baseArmBounds.max[axis] - 0.015625) < 1e-7,
    `sleeve axis ${axis} ends exactly one quarter-pixel outside the arm`);
}
assert.deepEqual(Object.keys(PLAYER_SKIN_PART_BOX_RANGES), ["head", "body", "rightArm", "leftArm", "rightLeg", "leftLeg"]);
for (const part of Object.keys(PLAYER_SKIN_PART_BOX_RANGES) as Array<keyof typeof PLAYER_SKIN_PART_BOX_RANGES>) {
  assert.equal(buildPlayerSkinPartGeometry(part, "wide").length, 72 * PLAYER_SKIN_VERTEX_STRIDE,
    `${part} exposes exactly its base and outer-layer boxes`);
}
console.log("standard player skin validation and geometry tests passed");
