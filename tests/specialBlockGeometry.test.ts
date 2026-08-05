import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { textureAtlasUv } from "../client/game/blockTextures.ts";
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
  texture: "oak_planks" | "wool",
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
assertUvRange(torch.textured, 0, SPECIAL_TORCH_TEXTURED_VERTEX_COUNT, "oak_planks");
for (let offset = 5; offset < torch.textured.length; offset += 6) {
  const shade = unpackSkyExposureShade(torch.textured[offset]);
  assert.equal(shade.exposureLevel, 0, "special atlas geometry retains cached cave exposure");
}
assert.ok(torch.color.some((value, index) => index % 6 === 3 && value > 0.9),
  "the torch keeps a readable emissive ember detail");

const chest = mesh();
appendSpecialChestMesh(chest, 10, 20, 30, 1, 3);
assertCounts(chest, SPECIAL_CHEST_TEXTURED_VERTEX_COUNT, SPECIAL_CHEST_COLOR_VERTEX_COUNT);
assertUvRange(chest.textured, 0, SPECIAL_CHEST_TEXTURED_VERTEX_COUNT, "oak_planks");
assert.ok(chest.color.some((value, index) => index % 6 === 3 && value > 0.8),
  "the atlas-backed chest keeps its contrasting latch");
assert.ok(chest.color.some((value, index) => index % 6 === 3 && value > 0.2 && value < 0.4),
  "the atlas-backed chest keeps a dark wraparound band");

for (const open of [false, true]) {
  const door = mesh();
  appendSpecialDoorMesh(door, 10, 20, 30, open, 1, 2);
  assertCounts(door, SPECIAL_DOOR_TEXTURED_VERTEX_COUNT, SPECIAL_DOOR_COLOR_VERTEX_COUNT);
  assertUvRange(door.textured, 0, SPECIAL_DOOR_TEXTURED_VERTEX_COUNT, "oak_planks");
  const xs = door.textured.filter((_, index) => index % 6 === 0);
  const zs = door.textured.filter((_, index) => index % 6 === 2);
  assert.equal(open ? Math.max(...xs) - Math.min(...xs) < 0.2 : Math.max(...zs) - Math.min(...zs) < 0.2, true,
    "open and closed doors retain perpendicular thin-slab silhouettes");
  assert.ok(door.color.some((value, index) => index % 6 === 3 && value > 0.75),
    "both sides of each door state retain a contrasting handle");
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
