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
assert.equal(NAMEPLATE_FONT.length, 96, "supported ASCII nameplate glyph lookup stays fixed and bounded");
assert.equal(NAMEPLATE_FONT.every((glyph) => glyph <= 0x7fff), true, "every glyph fits its 3x5 bit mask");
assert.equal(NAMEPLATE_FONT[32], 0, "space remains blank");
assert.equal(NAMEPLATE_FONT[33], NAMEPLATE_FONT[63], "unsupported ASCII falls back to the question mark");
assert.equal(NAMEPLATE_FONT["A".charCodeAt(0)].toString(2).padStart(15, "0"), "010101111101101");
assert.equal(NAMEPLATE_FONT["_".charCodeAt(0)].toString(2).padStart(15, "0"), "000000000000111");

const canonical = JSON.stringify([
  [...BOX_VERTEX_COORDINATES],
  BOX_FACE_SHADES,
  [...NAMEPLATE_FONT],
]);
assert.equal(fnv1a32(canonical), "f697727a",
  "the complete cube-coordinate, face-shade, and nameplate-glyph fixture changed unexpectedly");

const generatedPath = new URL("../client/game/generated/renderGeometry.ts", import.meta.url);
const generatedSource = readFileSync(generatedPath, "utf8");
const payloads = [...generatedSource.matchAll(/decodeStaticBytes\("([^"]+)", (\d+)\)/g)];
assert.deepEqual(payloads.map((match) => [Buffer.from(match[1], "base64").length, Number(match[2])]),
  [[50, 108], [111, 192]], "renderer fixtures retain their reviewed packed and decoded bounds");
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
