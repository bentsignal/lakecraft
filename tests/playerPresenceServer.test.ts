import assert from "node:assert/strict";
import {
  buildOfflinePresenceValue,
  validatePresencePoseFields
} from "../server/playerPresence.ts";

assert.deepEqual(
  validatePresencePoseFields(" -128 ", "128", "128", "100000", "-2"),
  { x: -128, y: 128, z: 128, yaw: 100_000, pitch: -2 },
  "the documented spatial envelope is accepted at its exact bounds",
);
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
  vx: "0",
  vy: "0",
  vz: "0",
  heartbeatAt: "2000",
  online: false,
}, "leave preserves the last authoritative pose while ending motion");

assert.equal(authoritative.heartbeatAt, "1000", "the client-authored/previous timestamp is never reused");

console.log("player presence server persistence tests passed");
