import assert from "node:assert/strict";
import {
  buildOfflinePresenceValue,
  validatePresencePoseFields
} from "../server/playerPresence.ts";
import {
  MAX_AVATAR_APPEARANCE_ITEM_LENGTH,
  normalizeArmorAppearanceItem,
  normalizeAvatarAppearance,
  normalizeHeldAppearanceItem,
} from "../shared/avatarAppearance.ts";

assert.deepEqual(
  validatePresencePoseFields(" -128 ", "128", "128", "100000", "-2"),
  { x: -128, y: 128, z: 128, yaw: 100_000, pitch: -2 },
  "the documented spatial envelope is accepted at its exact bounds",
);

assert.equal(normalizeHeldAppearanceItem(" iron_sword "), "iron_sword");
assert.equal(normalizeHeldAppearanceItem("cobblestone"), "cobblestone");
assert.equal(normalizeHeldAppearanceItem("diamond_sword"), "");
assert.equal(normalizeHeldAppearanceItem("x".repeat(MAX_AVATAR_APPEARANCE_ITEM_LENGTH + 1)), "");
assert.equal(normalizeArmorAppearanceItem("iron_helmet", "head"), "iron_helmet");
assert.equal(normalizeArmorAppearanceItem("iron_helmet", "chest"), "");
assert.equal(normalizeArmorAppearanceItem("iron_sword", "head"), "");
assert.deepEqual(
  normalizeAvatarAppearance("wooden_pickaxe", "leather_helmet", "iron_chestplate", "leather_leggings", "iron_boots"),
  {
    heldItem: "wooden_pickaxe",
    armorHead: "leather_helmet",
    armorChest: "iron_chestplate",
    armorLegs: "leather_leggings",
    armorFeet: "iron_boots",
  },
);
assert.deepEqual(normalizeAvatarAppearance(undefined, "iron_boots", "stone", "", null), {
  heldItem: "",
  armorHead: "",
  armorChest: "",
  armorLegs: "",
  armorFeet: "",
});
for (const fields of [
  ["-128.01", "8", "0", "0", "0"],
  ["0", "128.01", "0", "0", "0"],
  ["0", "8", "128.01", "0", "0"],
  ["0", "8", "0", "100000.01", "0"],
  ["0", "8", "0", "0", "2.01"],
  ["", "8", "0", "0", "0"],
  ["0x10", "8", "0", "0", "0"],
  ["Infinity", "8", "0", "0", "0"],
] as const) {
  assert.equal(validatePresencePoseFields(...fields), null, `invalid pose field is rejected: ${fields.join(",")}`);
}
assert.deepEqual(
  validatePresencePoseFields("1e-7", "8.02", "-2e1", "-3.2e-1", "0"),
  { x: 1e-7, y: 8.02, z: -20, yaw: -0.32, pitch: 0 },
  "normal JavaScript exponent serialization remains wire-compatible",
);

const authoritative = {
  userId: "user-alex",
  displayName: "Alex",
  color: "#4a90e2",
  x: "12.25",
  y: "8.02",
  z: "-19.5",
  yaw: "2.4",
  pitch: "-0.35",
  heldItem: "iron_sword",
  armorHead: "iron_helmet",
  armorChest: "iron_chestplate",
  armorLegs: "iron_leggings",
  armorFeet: "iron_boots",
  vx: "5.5",
  vy: "-7.25",
  vz: "-3",
  heartbeatAt: "1000",
  online: true,
};

const offline = buildOfflinePresenceValue(authoritative, 2_000);
assert.deepEqual(offline, {
  userId: "user-alex",
  displayName: "Alex",
  color: "#4a90e2",
  x: "12.25",
  y: "8.02",
  z: "-19.5",
  yaw: "2.4",
  pitch: "-0.35",
  heldItem: "iron_sword",
  armorHead: "iron_helmet",
  armorChest: "iron_chestplate",
  armorLegs: "iron_leggings",
  armorFeet: "iron_boots",
  vx: "0",
  vy: "0",
  vz: "0",
  heartbeatAt: "2000",
  online: false,
}, "leave preserves the last authoritative pose while ending motion");

const legacyOffline = buildOfflinePresenceValue({
  userId: "legacy",
  displayName: "Legacy",
  color: "#ffffff",
  x: "0",
  y: "8",
  z: "0",
  yaw: "0",
  pitch: "0",
}, 3_000);
assert.deepEqual(
  [legacyOffline.heldItem, legacyOffline.armorHead, legacyOffline.armorChest, legacyOffline.armorLegs, legacyOffline.armorFeet],
  ["", "", "", "", ""],
  "legacy presence rows surface an empty appearance",
);

assert.equal(authoritative.heartbeatAt, "1000", "the client-authored/previous timestamp is never reused");

console.log("player presence server persistence tests passed");
