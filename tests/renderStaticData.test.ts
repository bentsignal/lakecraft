import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  BOX_FACE_SHADES,
  BOX_VERTEX_COORDINATES,
  NAMEPLATE_FONT,
} from "../client/game/generated/renderGeometry.ts";

function fnv1a32(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

assert.equal(BOX_VERTEX_COORDINATES.length, 6 * 6 * 3, "six cube faces retain six xyz vertices");
assert.equal(BOX_VERTEX_COORDINATES.every((coordinate) => coordinate === 0 || coordinate === 1), true,
  "cube coordinates remain normalized and bounded");
assert.deepEqual(BOX_FACE_SHADES, [0.79, 0.68, 1, 0.52, 0.88, 0.73],
  "shared mob, player, and dropped-item face lighting stays exact");
assert.equal(NAMEPLATE_FONT.length, 96 * 7, "supported ASCII nameplates retain seven bounded rows per glyph");
assert.equal(NAMEPLATE_FONT.every((row) => row <= 0b11111), true, "every row fits its five-pixel mask");
const rows = (character: string) => [...NAMEPLATE_FONT.slice(character.charCodeAt(0) * 7, (character.charCodeAt(0) + 1) * 7)];
assert.deepEqual(rows(" "), [0,0,0,0,0,0,0], "space remains blank");
assert.deepEqual(rows("!"), rows("?"), "unsupported ASCII falls back to the question mark");
assert.deepEqual(rows("A"), [14,17,17,31,17,17,17]);
assert.deepEqual(rows("_"), [0,0,0,0,0,0,31]);

const canonical = JSON.stringify([
  [...BOX_VERTEX_COORDINATES],
  BOX_FACE_SHADES,
  [...NAMEPLATE_FONT],
]);
assert.equal(fnv1a32(canonical), "8c774e39",
  "the complete cube-coordinate, face-shade, and nameplate-glyph fixture changed unexpectedly");

const generatedPath = new URL("../client/game/generated/renderGeometry.ts", import.meta.url);
const generatedSource = readFileSync(generatedPath, "utf8");
const payloads = [...generatedSource.matchAll(/decodeStaticBytes\("([^"]+)", (\d+), (\d+)\)/g)];
assert.deepEqual(payloads.map((match) => [match[1].length, Number(match[2]), Number(match[3])]),
  [[65, 108, 50], [330, 672, 261]], "renderer fixtures retain their reviewed packed and decoded bounds");
assert.equal((generatedSource.match(/decodeStaticBytes\(/g) ?? []).length, 2,
  "renderer tables decode once at module initialization through the shared helper");

const regenerationDirectory = mkdtempSync(join(tmpdir(), "lakecraft-render-static-"));
try {
  const regeneratedPath = join(regenerationDirectory, "renderGeometry.ts");
  const regeneration = spawnSync(process.execPath, [
    "--experimental-strip-types",
    new URL("../scripts/generate-render-geometry.ts", import.meta.url).pathname,
    regeneratedPath,
  ], { encoding: "utf8" });
  assert.equal(regeneration.status, 0, regeneration.stderr || regeneration.stdout);
  assert.equal(readFileSync(regeneratedPath, "utf8"), generatedSource,
    "the offline renderer table generator deterministically reproduces the checked-in module");
} finally {
  rmSync(regenerationDirectory, { recursive: true, force: true });
}

console.log("shared renderer static data fingerprint, bounds, and regeneration tests passed");
