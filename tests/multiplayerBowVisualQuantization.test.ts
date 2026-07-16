import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const referenceStage = (progress: number): 0 | 1 | 2 => progress >= 0.9 ? 2 : progress >= 0.55 ? 1 : 0;
const visualChargeMs = (charging: boolean, normalizedCharge: number): number => (
  charging ? referenceStage(normalizedCharge) * 550 : 0
);

const visualValues = new Set<number>();
for (let step = 0; step <= 100; step += 1) visualValues.add(visualChargeMs(true, step / 100));
assert.deepEqual([...visualValues], [0, 550, 1_100], "one draw has only three distinct visual values");
assert.deepEqual([...visualValues].map((value) => referenceStage(Math.min(1, value / 1_000))), [0, 1, 2]);
assert.equal(visualChargeMs(false, 1), 0, "cancel and release clear the visual immediately");

const bow = readFileSync(new URL("../client/components/FirstPersonBow.tsx", import.meta.url), "utf8");
assert.match(bow, /bounded >= 0\.9[\s\S]*?return 2;[\s\S]*?bounded >= 0\.55[\s\S]*?return 1;/,
  "the reference values match the shipped three-stage bow reducer");

const client = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");
const chargeStart = client.indexOf("onRangedChargeChange:");
const chargeEnd = client.indexOf("onRangedCancel:", chargeStart);
const charge = client.slice(chargeStart, chargeEnd);
assert.match(charge, /setBowChargeMs\(charging \? bowChargeStage\(normalizedCharge\) \* 550 : 0\)/,
  "multiplayer quantizes only its three-stage visual state");
assert.match(charge, /if \(!charging \|\| normalizedCharge !== 0 \|\| rangedChargeStartRef\.current\) return;/,
  "the begin mutation still gates on raw zero progress");
assert.ok(charge.includes('kind: "begin_charge"') && charge.includes("rangedCombat(requestJson)"),
  "Lakebed remains authoritative for beginning the draw");

const releaseStart = client.indexOf("onRangedRelease:", chargeEnd);
const releaseEnd = client.indexOf("getPlayerProtection:", releaseStart);
const release = client.slice(releaseStart, releaseEnd);
assert.ok(release.includes("targetKind: intent.target.kind") && release.includes("targetId: intent.target.id"),
  "release preserves the exact engine intent target");
assert.doesNotMatch(release, /chargeMs\s*:\s*bowChargeMs/,
  "quantized visual state never enters the release request");

const singlePlayer = readFileSync(new URL("../client/singleplayer/SinglePlayerApp.tsx", import.meta.url), "utf8");
const localChargeStart = singlePlayer.indexOf("onRangedChargeChange:");
const localChargeEnd = singlePlayer.indexOf("onRangedCancel:", localChargeStart);
const localCharge = singlePlayer.slice(localChargeStart, localChargeEnd);
assert.match(localCharge, /setBowChargeMs\(charging \? bowChargeStage\(normalizedCharge\) \* 550 : 0\)/,
  "single-player uses the same three visual stages without quantizing combat");
assert.equal(singlePlayer.includes("lakebed/client"), false, "local bow feedback remains offline");

const engine = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");
const intentStart = engine.indexOf("function rangedShotIntent");
const intentEnd = engine.indexOf("function requestCanvasPointerLock", intentStart);
assert.match(engine.slice(intentStart, intentEnd), /chargeMs: Math\.max\(0, Math\.min\(PLAYER_BOW_FULL_CHARGE_MS, now - rangedChargeStartedAt\)\)/,
  "exact monotonic charge duration remains engine-owned");

console.log("multiplayer bow visual quantization tests passed");
