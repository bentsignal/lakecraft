import assert from "node:assert/strict";
import {
  createDayNightState,
  DEFAULT_DAY_NIGHT_CONFIG,
  phaseAtTime,
  sampleDayNight,
  timeToMorningMs,
  type DayNightConfig,
} from "../client/game/dayNight.ts";
import { applyDayNightClockUpdate } from "../client/game/voxelEngine.ts";
import { readFileSync } from "node:fs";

const config: DayNightConfig = {
  cycleLengthMs: 1_000,
  epochMs: 10_000,
  epochPhase: 0,
};
assert.equal(DEFAULT_DAY_NIGHT_CONFIG.cycleLengthMs, 20 * 60 * 1_000);
const engineSource = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");
assert.match(engineSource,
  /phaseAtTime,[\s\S]*?setDaylightCycle\(enabled\)[\s\S]*?phaseAtTime\(worldTimeMs, dayNightConfig\)/,
  "the live engine imports the phase sampler used to re-anchor daylight toggles");
const localAppSource = readFileSync(new URL("../client/singleplayer/SinglePlayerApp.tsx", import.meta.url), "utf8");
assert.match(localAppSource, /Daylight cycle \$\{parsed\.command\.value \? "enabled" : "disabled"\}/,
  "local daylight changes emit a system confirmation");
const serverSource = readFileSync(new URL("../server/index.ts", import.meta.url), "utf8");
assert.match(serverSource, /oldestByIndex\(ctx\.db\.profiles, "by_creation"\)\.first\(\)[\s\S]*?owner\?\.userId !== ctx\.auth\.userId[\s\S]*?reason: "permission"/,
  "shared-world gamerules are restricted to the first immutable profile as world operator");
assert.match(serverSource, /username: rule \? "System"[\s\S]*?message: rule \? `Daylight cycle/,
  "authorized multiplayer daylight changes emit a system-authored confirmation");

assert.equal(phaseAtTime(10_000, config), 0);
assert.equal(phaseAtTime(10_250, config), 0.25);
assert.equal(phaseAtTime(11_000, config), 0);
assert.equal(phaseAtTime(9_750, config), 0.75, "times before the epoch must wrap positively");
assert.equal(phaseAtTime(10_000, { ...config, epochPhase: 1.25 }), 0.25);
assert.equal(phaseAtTime(10_750, { ...config, cycleLengthMs: -config.cycleLengthMs, epochPhase: 0.4 }), 0.4,
  "disabled daylight freezes the sky while world time continues");

const state = createDayNightState();
assert.equal(sampleDayNight(10_000, config, state), state, "caller-provided output should be reused");
assert.equal(state.label, "night");
assert.ok(state.sunIntensity < 0.001);
assert.ok(state.moonIntensity > 0.99);
assert.ok(state.starIntensity > 0.99);

sampleDayNight(10_180, config, state);
assert.equal(state.label, "dawn");
sampleDayNight(10_300, config, state);
assert.equal(state.label, "day");
sampleDayNight(10_700, config, state);
assert.equal(state.label, "dusk");
sampleDayNight(10_820, config, state);
assert.equal(state.label, "night");

const noon = sampleDayNight(10_500, config);
assert.equal(noon.phase, 0.5);
assert.ok(noon.sunIntensity > 0.99);
assert.ok(noon.ambientIntensity > 0.69);
assert.ok(noon.skyB > noon.skyR);
assert.ok(noon.directionalR >= noon.directionalG);

const justBeforeWrap = sampleDayNight(10_999.999, config);
const atWrap = sampleDayNight(11_000, config);
assert.ok(Math.abs(justBeforeWrap.skyR - atWrap.skyR) < 0.00001);
assert.ok(Math.abs(justBeforeWrap.skyG - atWrap.skyG) < 0.00001);
assert.ok(Math.abs(justBeforeWrap.skyB - atWrap.skyB) < 0.00001);

const dawnA = sampleDayNight(10_225, config);
const dawnB = sampleDayNight(10_250, config);
const dawnC = sampleDayNight(10_275, config);
assert.ok(dawnA.skyR < dawnB.skyR && dawnB.skyR < dawnC.skyR, "dawn color should interpolate smoothly");

assert.equal(timeToMorningMs(10_250, config), 0);
assert.equal(timeToMorningMs(10_000, config), 250);
assert.equal(timeToMorningMs(10_500, config), 750);
assert.equal(timeToMorningMs(9_750, config), 500);

const mutableClock = { ...config };
assert.equal(applyDayNightClockUpdate(mutableClock, { epochMs: 20_000, epochPhase: 0.25 }, 0, 125), 125);
assert.deepEqual(mutableClock, { ...config, epochMs: 20_000, epochPhase: 0.25 });
assert.equal(applyDayNightClockUpdate(mutableClock, { cycleLengthMs: 0 }, 125, Number.NaN), 125);
assert.equal(mutableClock.cycleLengthMs, config.cycleLengthMs, "invalid clock updates should be ignored");

for (const value of [noon, justBeforeWrap, atWrap, dawnA, dawnB, dawnC]) {
  for (const channel of [value.skyR, value.skyG, value.skyB, value.fogR, value.fogG, value.fogB]) {
    assert.ok(channel >= 0 && channel <= 1, `color channel ${channel} should be normalized`);
  }
}

const hotState = createDayNightState();
let checksum = 0;
const iterations = 1_000_000;
const startedAt = performance.now();
for (let index = 0; index < iterations; index += 1) {
  checksum += sampleDayNight(10_000 + index, config, hotState).ambientIntensity;
}
const elapsedMs = performance.now() - startedAt;
assert.ok(checksum > 0);
assert.ok(elapsedMs < 1_000, `expected ${iterations.toLocaleString()} reused samples under 1000ms, got ${elapsedMs.toFixed(1)}ms`);

console.log(JSON.stringify({
  benchmark: "allocation-free day/night sampling",
  iterations,
  elapsedMs: Number(elapsedMs.toFixed(2)),
  nanosecondsPerSample: Number((elapsedMs * 1e6 / iterations).toFixed(1)),
}));
console.log("lakecraft day/night tests: ok");
