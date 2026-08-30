import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chestAtlasUv, textureAtlasUv } from "../client/game/blockTextures.ts";
import {
  SPECIAL_BED_COLOR_VERTEX_COUNT,
  SPECIAL_BED_TEXTURED_VERTEX_COUNT,
  SPECIAL_CHEST_COLOR_VERTEX_COUNT,
  SPECIAL_CHEST_TEXTURED_VERTEX_COUNT,
  SPECIAL_DOOR_COLOR_VERTEX_COUNT,
  SPECIAL_DOOR_TEXTURED_VERTEX_COUNT,
  SPECIAL_LADDER_COLOR_VERTEX_COUNT,
  SPECIAL_LADDER_TEXTURED_VERTEX_COUNT,
  SPECIAL_TORCH_COLOR_VERTEX_COUNT,
  SPECIAL_TORCH_TEXTURED_VERTEX_COUNT,
  appendSpecialBedMesh,
  appendSpecialChestMesh,
  appendSpecialDoorMesh,
  appendSpecialLadderMesh,
  appendSpecialTorchMesh,
  type SpecialBlockMeshOutputs,
} from "../client/game/specialBlockGeometry.ts";
import { unpackSkyExposureShade } from "../client/game/skyExposure.ts";

function mesh(): { textured: number[]; color: number[] } {
  return { textured: [], color: [] };
}

function assertCounts(
  output: SpecialBlockMeshOutputs,
  textured: number,
  color: number,
): void {
  assert.equal(output.textured.length / 6, textured);
  assert.equal(output.color.length / 6, color);
}

function assertUvRange(
  vertices: readonly number[],
  startVertex: number,
  vertexCount: number,
  texture: "oak_planks" | "wool" | "torch",
): void {
  const uv = textureAtlasUv(texture);
  const end = (startVertex + vertexCount) * 6;
  for (let offset = startVertex * 6; offset < end; offset += 6) {
    assert.ok(vertices[offset + 3] >= uv.left && vertices[offset + 3] <= uv.right);
    assert.ok(vertices[offset + 4] >= uv.bottom && vertices[offset + 4] <= uv.top);
  }
}

const torch = mesh();
appendSpecialTorchMesh(torch, 3, 4, 5, 0.95, 0);
assertCounts(torch, SPECIAL_TORCH_TEXTURED_VERTEX_COUNT, SPECIAL_TORCH_COLOR_VERTEX_COUNT);
assertUvRange(torch.textured, 0, SPECIAL_TORCH_TEXTURED_VERTEX_COUNT, "torch");
for (let offset = 5; offset < torch.textured.length; offset += 6) {
  const shade = unpackSkyExposureShade(torch.textured[offset]);
  assert.equal(shade.exposureLevel, 0, "special atlas geometry retains cached cave exposure");
}
assert.equal(torch.color.length, 0, "the synthetic ember box is removed in favor of the exact torch texture");
const floorTorchY = torch.textured.filter((_, index) => index % 6 === 1);
assert.deepEqual([Math.min(...floorTorchY), Math.max(...floorTorchY)], [4, 4 + 10 / 16],
  "the floor torch uses the installed 2x10x2-pixel model bounds");
const wallTorch = mesh();
appendSpecialTorchMesh(wallTorch, 3, 4, 5, 1, 0, "east");
assertCounts(wallTorch, SPECIAL_TORCH_TEXTURED_VERTEX_COUNT, SPECIAL_TORCH_COLOR_VERTEX_COUNT);
const wallTorchX = wallTorch.textured.filter((_, index) => index % 6 === 0);
assert.ok(Math.min(...wallTorchX) > 2.93 && Math.max(...wallTorchX) < 3.31,
  "the installed east-facing wall torch clips slightly into its west support and tilts outward");

const chest = mesh();
appendSpecialChestMesh(chest, 10, 20, 30, 1, 3);
assertCounts(chest, SPECIAL_CHEST_TEXTURED_VERTEX_COUNT, SPECIAL_CHEST_COLOR_VERTEX_COUNT);
const chestBottomLeft = chestAtlasUv(0, 63);
const chestTopRight = chestAtlasUv(63, 0);
for (let offset = 0; offset < chest.textured.length; offset += 6) {
  assert.ok(chest.textured[offset + 3] >= chestBottomLeft[0] && chest.textured[offset + 3] <= chestTopRight[0]
    && chest.textured[offset + 4] >= chestBottomLeft[1] && chest.textured[offset + 4] <= chestTopRight[1],
  "every chest face samples the contiguous exact normal entity texture");
}
assert.equal(chest.color.length, 0, "the old synthetic band and latch colors are completely removed");
assert.ok(chest.textured.some((value, index) => index % 6 === 5
  && unpackSkyExposureShade(value).exposureLevel === 3),
"chest entity-texture faces remain in the retained exposure-packed batch");
const chestCoordinates = (axis: 0 | 1 | 2) => chest.textured.filter((_, index) => index % 6 === axis);
assert.deepEqual(
  [Math.min(...chestCoordinates(1)), Math.max(...chestCoordinates(1))],
  [20, 20 + 14 / 16],
  "closed chest geometry uses the installed model's exact y=0..10 bottom and y=9..14 lid bounds",
);
assert.deepEqual(
  [Math.min(...chestCoordinates(0)), Math.max(...chestCoordinates(0)),
    Math.min(...chestCoordinates(2)), Math.max(...chestCoordinates(2))],
  [10 + 1 / 16, 10 + 15 / 16, 30 + 1 / 16, 31],
  "closed chest body and front lock preserve the installed model's x/z bounds",
);
const bodyEastUv = Array.from({ length: 6 }, (_, vertex) =>
  [chest.textured[vertex * 6 + 3], chest.textured[vertex * 6 + 4]] as const);
assert.deepEqual(bodyEastUv, [
  chestAtlasUv(41, 42), chestAtlasUv(41, 33), chestAtlasUv(28, 33),
  chestAtlasUv(41, 42), chestAtlasUv(28, 33), chestAtlasUv(28, 42),
], "the body-east [28,42)x[33,43) rectangle uses exact inclusive texel centers without split seams");
assert.deepEqual(chest.textured.slice(0, 36).filter((_, index) => index % 6 < 3), [
  10 + 15 / 16, 20, 30 + 1 / 16,
  10 + 15 / 16, 20 + 10 / 16, 30 + 1 / 16,
  10 + 15 / 16, 20 + 10 / 16, 30 + 15 / 16,
  10 + 15 / 16, 20, 30 + 1 / 16,
  10 + 15 / 16, 20 + 10 / 16, 30 + 15 / 16,
  10 + 15 / 16, 20, 30 + 15 / 16,
], "installed east-face UV corners map to the exact mirrored-z model corners");

for (const open of [false, true]) {
  const door = mesh();
  appendSpecialDoorMesh(door, 10, 20, 30, open, "oak", "north", "left", 1, 2);
  assertCounts(door, SPECIAL_DOOR_TEXTURED_VERTEX_COUNT, SPECIAL_DOOR_COLOR_VERTEX_COUNT);
  assertUvRange(door.textured, 0, 30, "oak_door_bottom");
  assertUvRange(door.textured, 30, 30, "oak_door_top");
  const xs = door.textured.filter((_, index) => index % 6 === 0);
  const zs = door.textured.filter((_, index) => index % 6 === 2);
  assert.equal(open ? Math.max(...xs) - Math.min(...xs) < 0.2 : Math.max(...zs) - Math.min(...zs) < 0.2, true,
    "open and closed doors retain perpendicular thin-slab silhouettes");
  assert.equal(door.color.length, 0, "the installed door pixels carry every panel and handle detail");
  const middlePlaneVertices = door.textured.filter((_, index) => index % 6 === 1 && door.textured[index] === 21);
  assert.equal(middlePlaneVertices.length, 24,
    "only the four vertical faces from each half meet at the middle plane; hidden top and bottom faces are omitted");

  const uv = textureAtlasUv("oak_door_bottom");
  const tilePixelU = (uv.right - uv.left) / 15;
  const lowerEastFaceUs = door.textured.slice(0, 36).filter((_, index) => index % 6 === 3);
  assert.ok(Math.abs(Math.max(...lowerEastFaceUs) - Math.min(...lowerEastFaceUs) - tilePixelU * 2) < 1e-12,
    "the thin east edge maps the three source-pixel centers instead of compressing the full panel texture");
}
const birchDoor = mesh();
appendSpecialDoorMesh(birchDoor, 0, 0, 0, false, "birch", "east", "right");
assertCounts(birchDoor, SPECIAL_DOOR_TEXTURED_VERTEX_COUNT, SPECIAL_DOOR_COLOR_VERTEX_COUNT);
for (const [start, texture] of [[0, "birch_door_bottom"], [30, "birch_door_top"]] as const) {
  const uv = textureAtlasUv(texture);
  for (let offset = start * 6; offset < (start + 30) * 6; offset += 6) {
    assert.ok(birchDoor.textured[offset + 3] >= uv.left && birchDoor.textured[offset + 3] <= uv.right);
    assert.ok(birchDoor.textured[offset + 4] >= uv.bottom && birchDoor.textured[offset + 4] <= uv.top);
  }
}

for (const direction of ["north", "east", "south", "west"] as const) {
  const bed = mesh();
  appendSpecialBedMesh(bed, 0, 0, 0, "foot", direction, 1, 1);
  assertCounts(bed, SPECIAL_BED_TEXTURED_VERTEX_COUNT, SPECIAL_BED_COLOR_VERTEX_COUNT);
  assertUvRange(bed.textured, 0, 36, "oak_planks");
  assertUvRange(bed.textured, 36, 36, "wool");
  const blanketLongAxis = direction === "east" || direction === "west" ? 0 : 2;
  const coordinates = bed.color.filter((_, index) => index % 6 === blanketLongAxis);
  assert.ok(Math.max(...coordinates) - Math.min(...coordinates) > 1.8,
    `${direction} blanket is one continuous two-cell color box`);
}
const hiddenBedHead = mesh();
appendSpecialBedMesh(hiddenBedHead, 0, 0, 0, "head", "north");
assertCounts(hiddenBedHead, 0, 0);

const ladder = mesh();
appendSpecialLadderMesh(ladder, 4, 5, 6, 1, 0);
assertCounts(ladder, SPECIAL_LADDER_TEXTURED_VERTEX_COUNT, SPECIAL_LADDER_COLOR_VERTEX_COUNT);
assertUvRange(ladder.textured, 0, SPECIAL_LADDER_TEXTURED_VERTEX_COUNT, "oak_planks");

const world = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");
const lab = readFileSync(new URL("../client/game/visualLabRenderer.ts", import.meta.url), "utf8");
for (const appender of [
  "appendSpecialTorchMesh",
  "appendSpecialChestMesh",
  "appendSpecialDoorMesh",
  "appendSpecialBedMesh",
  "appendSpecialLadderMesh",
]) {
  assert.ok(world.includes(`${appender}(`), `production world mesh uses ${appender}`);
  assert.ok(lab.includes(`${appender}(`), `Visual Lab preview uses the same ${appender}`);
}
assert.ok(world.includes("const specialVertices = { textured: textureVertices, color: colorVertices }"),
  "one chunk-local bridge joins special geometry to retained texture and color batches");

console.log("lakecraft special block geometry tests: ok");
