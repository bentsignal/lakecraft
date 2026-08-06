import assert from "node:assert/strict";
import {
  ATMOSPHERE_FRAGMENT_SHADER,
  ATMOSPHERE_SCREEN_TRIANGLE,
  atmosphereLightLevels,
  celestialDirection,
  writeCelestialDirection,
} from "../client/game/atmosphere.ts";
import { createDayNightState, sampleDayNight } from "../client/game/dayNight.ts";

assert.equal(ATMOSPHERE_SCREEN_TRIANGLE.length, 6, "sky remains one fullscreen triangle");
assert.match(ATMOSPHERE_FRAGMENT_SHADER, /96\.-E\.y/, "cloud height is intersected in world space, not offset from the eye");
assert.match(ATMOSPHERE_FRAGMENT_SHADER, /i=abs\(r\.y\)/, "cloud horizon fading works above and below the world plane");
assert.match(
  ATMOSPHERE_FRAGMENT_SHADER,
  /float i=abs\(r\.y\);if\(i>\.035\)\{float d=\(96\.-E\.y\)\/r\.y;if\(d>0\.\)\{/,
  "cloud intersection divides only after excluding zero and near-horizon rays",
);
assert.ok(
  ATMOSPHERE_FRAGMENT_SHADER.indexOf("if(i>.035)")
    < ATMOSPHERE_FRAGMENT_SHADER.indexOf("(96.-E.y)/r.y"),
  "the horizon guard precedes the potentially undefined ray-plane division",
);
assert.doesNotMatch(ATMOSPHERE_FRAGMENT_SHADER, /if\(r\.y>/, "downward rays above cloud height remain eligible for intersection");
assert.match(ATMOSPHERE_FRAGMENT_SHADER, /float b\(/, "celestial bodies keep pixel-square silhouettes");
assert.doesNotMatch(ATMOSPHERE_FRAGMENT_SHADER, /\bsin\s*\(/, "fullscreen hashes avoid expensive per-pixel sine calls");

const noon = celestialDirection(Math.PI / 2);
const midnight = celestialDirection(Math.PI * 1.5);
assert.ok(noon[1] > 0.999 && midnight[1] < -0.999, "the sun follows a full horizon-to-horizon arc");
for (let axis = 0; axis < 3; axis += 1) {
  assert.ok(Math.abs(noon[axis] + midnight[axis]) < 0.000001, "sun and moon directions stay antipodal");
}

const reusable = new Float32Array(3);
assert.equal(writeCelestialDirection(0, reusable), reusable, "the hot path reuses caller storage");
assert.ok(reusable.every(Number.isFinite));
assert.ok(Math.abs(Math.hypot(...reusable) - 1) < 0.000001, "celestial direction remains normalized");

const sampled = sampleDayNight(500, { cycleLengthMs: 1_000, epochMs: 0, epochPhase: 0 });
assert.deepEqual(atmosphereLightLevels(sampled), { sun: 1, moon: 0, stars: 0 });
const invalid = createDayNightState();
invalid.sunIntensity = 2;
invalid.moonIntensity = -2;
invalid.starIntensity = Number.NaN;
assert.deepEqual(atmosphereLightLevels(invalid), { sun: 1, moon: 0, stars: 0 });

const target: readonly [number, number, number] = [20, 96, -12];
for (const eye of [[0, 8, 0], [0, 28, 0], [0, 128, 0], [0, 148, 0]] as const) {
  const delta = [target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]] as const;
  const distance = (96 - eye[1]) / delta[1];
  const projected = [eye[0] + delta[0] * distance, eye[2] + delta[2] * distance];
  assert.ok(Math.abs(projected[0] - target[0]) < 1e-9 && Math.abs(projected[1] - target[2]) < 1e-9,
    "jumping changes the viewing ray but not the cloud's world coordinate");
  assert.ok(distance > 0, "upward and downward cloud rays intersect in front of the camera");
}

let checksum = 0;
const startedAt = performance.now();
for (let index = 0; index < 1_000_000; index += 1) {
  checksum += writeCelestialDirection(index / 1_000, reusable)[1];
}
const elapsedMs = performance.now() - startedAt;
assert.ok(Number.isFinite(checksum));
assert.ok(elapsedMs < 500, `one million allocation-free sky samples took ${elapsedMs.toFixed(1)}ms`);

console.log(JSON.stringify({
  benchmark: "allocation-free celestial direction sampling",
  iterations: 1_000_000,
  elapsedMs: Number(elapsedMs.toFixed(2)),
}));
console.log("lakecraft atmosphere tests: ok");
