import assert from "node:assert/strict";
import {
  buildOfflinePresenceValue,
  decidePresenceWriteGate,
  validatePresencePoseFields
} from "../server/playerPresence.ts";
import { PRESENCE_SERVER_MIN_WRITE_INTERVAL_MS } from "../shared/presenceMotion.ts";
import {
  MAX_AVATAR_APPEARANCE_ITEM_LENGTH,
  normalizeArmorAppearanceItem,
  normalizeAvatarAppearance,
  normalizeHeldAppearanceItem,
} from "../shared/avatarAppearance.ts";

assert.deepEqual(
  validatePresencePoseFields(" -1000000 ", "192", "1000000", "100000", "-2"),
  { x: -1_000_000, y: 192, z: 1_000_000, yaw: 100_000, pitch: -2 },
  "the documented spatial envelope is accepted at its exact bounds",
);

assert.deepEqual(decidePresenceWriteGate(undefined, 10_000), { accept: true, retryAfterMs: 0 });
assert.deepEqual(decidePresenceWriteGate("legacy-bad-time", 10_000), { accept: true, retryAfterMs: 0 });
assert.deepEqual(
  decidePresenceWriteGate("10000", 10_000 + PRESENCE_SERVER_MIN_WRITE_INTERVAL_MS),
  { accept: true, retryAfterMs: 0 },
  "the intended 200ms client cadence clears the more tolerant server guard",
);
assert.deepEqual(decidePresenceWriteGate("10000", 10_100), { accept: false, retryAfterMs: 50 });
assert.deepEqual(
  decidePresenceWriteGate("20000", 10_000),
  { accept: true, retryAfterMs: 0 },
  "a clock rollback heals the server-owned heartbeat instead of locking the player out",
);
assert.deepEqual(
  decidePresenceWriteGate("10000", Number.NaN),
  { accept: false, retryAfterMs: PRESENCE_SERVER_MIN_WRITE_INTERVAL_MS },
);

let guardedHeartbeat: string | undefined;
let guardedAccepts = 0;
for (let now = 0; now < 60_000; now += 1) {
  if (decidePresenceWriteGate(guardedHeartbeat, now).accept) {
    guardedHeartbeat = String(now);
    guardedAccepts += 1;
  }
}
assert.equal(guardedAccepts, 400, "pathological direct calls are capped at 400 accepted writes/minute");

let scheduledHeartbeat: string | undefined;
let scheduledAccepts = 0;
for (let now = 0; now < 60_000; now += 200) {
  if (decidePresenceWriteGate(scheduledHeartbeat, now).accept) {
    scheduledHeartbeat = String(now);
    scheduledAccepts += 1;
  }
}
assert.equal(scheduledAccepts, 300, "all intended 5 Hz scheduler writes clear the server guard");

assert.equal(normalizeHeldAppearanceItem(" iron_sword "), "iron_sword");
assert.equal(normalizeHeldAppearanceItem("cobblestone"), "cobblestone");
assert.equal(normalizeHeldAppearanceItem("obsidian_sword"), "");
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
  ["-1000000.01", "8", "0", "0", "0"],
  ["0", "0.99", "0", "0", "0"],
  ["0", "192.01", "0", "0", "0"],
  ["0", "8", "1000000.01", "0", "0"],
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
