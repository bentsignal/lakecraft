import assert from "node:assert/strict";
import { ITEMS, type ArmorId } from "../shared/game.ts";
import {
  buildPlayerArmorGeometry,
  fullPlayerArmorAppearance,
  PLAYER_ARMOR_BOX_GROUPS,
  PLAYER_ARMOR_MAX_BOXES,
  PLAYER_ARMOR_MAX_VERTICES,
  PLAYER_ARMOR_VERTEX_STRIDE,
} from "../client/game/playerArmorGeometry.ts";

for (const material of ["leather", "iron", "golden", "diamond"] as const) {
  const appearance = fullPlayerArmorAppearance(material);
  for (const [slot, itemId] of Object.entries(appearance)) {
    assert.equal(ITEMS[itemId as ArmorId].armor?.slot, slot, `${material} ${slot} resolves to its exact catalog slot`);
  }
  for (const model of ["wide", "slim"] as const) {
    const geometry = buildPlayerArmorGeometry(appearance, model);
    assert.equal(geometry.length % PLAYER_ARMOR_VERTEX_STRIDE, 0);
    assert.equal(geometry.length / PLAYER_ARMOR_VERTEX_STRIDE, PLAYER_ARMOR_MAX_VERTICES,
      `${material} ${model} full set exactly fills the fixed detailed-plate budget`);
    assert.ok(geometry.every(Number.isFinite));
  }
}

assert.equal(buildPlayerArmorGeometry({}).length, 0, "an unequipped player uploads no armor vertices");
assert.equal(buildPlayerArmorGeometry({ head: "iron_boots" }).length, 0,
  "an armor ID in the wrong slot fails closed instead of drawing the wrong shell");
assert.equal(PLAYER_ARMOR_MAX_BOXES, 20, "the fidelity pass remains a small fixed cuboid budget");
assert.deepEqual(PLAYER_ARMOR_BOX_GROUPS, {
  head: [["root", 4]],
  chest: [["root", 4], ["rightArm", 2], ["leftArm", 2]],
  legs: [["root", 2], ["rightLeg", 1], ["leftLeg", 1]],
  feet: [["rightLeg", 2], ["leftLeg", 2]],
});
assert.equal(buildPlayerArmorGeometry({ head: "iron_helmet" }).length / PLAYER_ARMOR_VERTEX_STRIDE, 144);
assert.equal(buildPlayerArmorGeometry({ chest: "diamond_chestplate" }).length / PLAYER_ARMOR_VERTEX_STRIDE, 288);
assert.equal(buildPlayerArmorGeometry({ legs: "golden_leggings" }).length / PLAYER_ARMOR_VERTEX_STRIDE, 144);
assert.equal(buildPlayerArmorGeometry({ feet: "leather_boots" }).length / PLAYER_ARMOR_VERTEX_STRIDE, 144);

const BOX_FLOATS = 36 * PLAYER_ARMOR_VERTEX_STRIDE;
function boxBounds(data: Float32Array, box: number) {
  const start = box * BOX_FLOATS;
  const end = start + BOX_FLOATS;
  const bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (let offset = start; offset < end; offset += PLAYER_ARMOR_VERTEX_STRIDE) {
    bounds.minX = Math.min(bounds.minX, data[offset]); bounds.maxX = Math.max(bounds.maxX, data[offset]);
    bounds.minY = Math.min(bounds.minY, data[offset + 1]); bounds.maxY = Math.max(bounds.maxY, data[offset + 1]);
    bounds.minZ = Math.min(bounds.minZ, data[offset + 2]); bounds.maxZ = Math.max(bounds.maxZ, data[offset + 2]);
  }
  return bounds;
}
function boxFirstColor(data: Float32Array, box: number): string {
  const offset = box * BOX_FLOATS + 3;
  return [data[offset], data[offset + 1], data[offset + 2]].map((value) => value.toFixed(4)).join(":");
}

const helmet = buildPlayerArmorGeometry({ head: "diamond_helmet" });
assert.ok(boxBounds(helmet, 0).minY >= 1.9, "the crown is a thin top plate instead of a featureless head cube");
assert.ok(boxBounds(helmet, 1).minZ > 0.25 && boxBounds(helmet, 1).minY >= 1.8,
  "the raised brow projects beyond the skin while leaving the face opening exposed");
assert.ok(boxBounds(helmet, 2).maxX <= -0.25 && boxBounds(helmet, 3).minX >= 0.25,
  "separate temple guards stay outside the head skin with no coplanar clipping");

const chest = buildPlayerArmorGeometry({ chest: "diamond_chestplate" }, "wide");
assert.ok(boxBounds(chest, 1).maxX <= -0.07 && boxBounds(chest, 2).minX >= 0.07,
  "split upper breastplates leave a visible central neckline");
assert.ok(boxBounds(chest, 4).minY > boxBounds(chest, 5).maxY,
  "the right shoulder cap and bracer leave a readable sleeve gap");
assert.ok(boxBounds(chest, 6).minY > boxBounds(chest, 7).maxY,
  "the left shoulder cap and bracer leave a readable sleeve gap");

const boots = buildPlayerArmorGeometry({ feet: "diamond_boots" });
assert.ok(boxBounds(boots, 1).maxZ > boxBounds(boots, 0).maxZ,
  "the right toe projects beyond its cuff for a readable edge silhouette");
assert.ok(boxBounds(boots, 3).maxZ > boxBounds(boots, 2).maxZ,
  "the left toe projects beyond its cuff for a readable edge silhouette");

const diamond = buildPlayerArmorGeometry(fullPlayerArmorAppearance("diamond"));
assert.ok(new Set(Array.from({ length: PLAYER_ARMOR_MAX_BOXES }, (_, box) => boxFirstColor(diamond, box))).size >= 4,
  "base, highlight, shadow, and deep material tones distinguish individual plates");
assert.notEqual(boxFirstColor(diamond, 0), boxFirstColor(buildPlayerArmorGeometry(fullPlayerArmorAppearance("leather")), 0),
  "material palettes remain visibly distinct instead of sharing one cyan shell");

console.log("standard-skin player armor geometry tests passed");
