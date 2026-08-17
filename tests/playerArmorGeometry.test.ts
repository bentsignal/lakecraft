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
      `${material} ${model} full set exactly fills the fixed Minecraft humanoid-layer budget`);
    assert.ok(geometry.every(Number.isFinite));
  }
}

assert.equal(buildPlayerArmorGeometry({}).length, 0, "an unequipped player uploads no armor vertices");
assert.equal(buildPlayerArmorGeometry({ head: "iron_boots" }).length, 0,
  "an armor ID in the wrong slot fails closed instead of drawing the wrong shell");
assert.equal(PLAYER_ARMOR_MAX_BOXES, 9, "the exact humanoid layers remain a small fixed cuboid budget");
assert.deepEqual(PLAYER_ARMOR_BOX_GROUPS, {
  head: [["head", 1]],
  chest: [["root", 1], ["rightArm", 1], ["leftArm", 1]],
  legs: [["root", 1], ["rightLeg", 1], ["leftLeg", 1]],
  feet: [["rightLeg", 1], ["leftLeg", 1]],
});
assert.equal(buildPlayerArmorGeometry({ head: "iron_helmet" }).length / PLAYER_ARMOR_VERTEX_STRIDE, 36);
assert.equal(buildPlayerArmorGeometry({ chest: "diamond_chestplate" }).length / PLAYER_ARMOR_VERTEX_STRIDE, 108);
assert.equal(buildPlayerArmorGeometry({ legs: "golden_leggings" }).length / PLAYER_ARMOR_VERTEX_STRIDE, 108);
assert.equal(buildPlayerArmorGeometry({ feet: "leather_boots" }).length / PLAYER_ARMOR_VERTEX_STRIDE, 72);

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
const helmet = buildPlayerArmorGeometry({ head: "diamond_helmet" });
assert.deepEqual(boxBounds(helmet, 0), { minX: -0.3125, maxX: 0.3125, minY: 1.4375, maxY: 2.0625, minZ: -0.3125, maxZ: 0.3125 },
  "the exact 8px helmet texture fits one uniformly inflated humanoid head layer");

const chest = buildPlayerArmorGeometry({ chest: "diamond_chestplate" }, "wide");
assert.ok(boxBounds(chest, 0).minX < -0.25 && boxBounds(chest, 0).maxX > 0.25,
  "the exact breastplate texture wraps one inflated torso cuboid");
assert.ok(boxBounds(chest, 1).maxX > 0.5 && boxBounds(chest, 2).minX < -0.5,
  "the exact chestplate sleeves cover both articulated arms");

const boots = buildPlayerArmorGeometry({ feet: "diamond_boots" });
assert.equal(boxBounds(boots, 0).maxZ, 0.1875, "boots use the standard one-pixel outer armor inflation");
assert.equal(boxBounds(boots, 1).maxZ, 0.1875, "both boots share the exact humanoid equipment texture fit");

const leatherUv = buildPlayerArmorGeometry({ head: "leather_helmet" })[4];
const diamondUv = buildPlayerArmorGeometry({ head: "diamond_helmet" })[4];
assert.equal(diamondUv - leatherUv, 6 * 32 / 256,
  "material changes select the exact installed atlas row without changing geometry");

console.log("standard-skin player armor geometry tests passed");
