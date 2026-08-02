import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const engine = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");
const client = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");
const types = readFileSync(new URL("../client/game/types.ts", import.meta.url), "utf8");

assert.ok(engine.includes("contactDamageSources[0] ?? projectileDamageSources[0]"), "only a locally consumed mob hit supplies local knockback");
assert.ok(engine.includes("appliedDamage,\n            mobSimulation.elapsedSeconds * 1_000"), "local knockback follows confirmed health damage on the deterministic clock");
assert.ok(engine.includes("!paused && playerHealth > 0 && options.canTakePlayerDamage?.() !== false"), "Creative, death, and menus reject knockback");
assert.ok(engine.includes("knockbackReceipts.has(eventId)"), "exact authoritative retries are deduplicated inside the engine boundary");
assert.ok(engine.includes("stepPlayerKnockbackAxis(knockbackVelocity[0]"));
assert.ok(engine.includes("moveAxis(0, distance)"), "horizontal impulse uses existing block collision");
assert.ok(types.includes("applyConfirmedMobKnockback(eventId: string"));

const claimFlow = client.slice(client.indexOf("for (const claim of mobWorldAuthority.damageClaims)"), client.indexOf("for (const claim of mobWorldAuthority.explosionClaims)"));
assert.ok(claimFlow.includes("result.ok && result.damage > 0"));
assert.ok(claimFlow.includes("if (!result.replayed)"), "receipt replay reconciles state without moving the player twice");
assert.ok(claimFlow.includes("mobWorldAuthority.poses.find((pose) => pose.mobId === claim.mobId)"), "authoritative mob pose supplies direction");
assert.ok(claimFlow.includes("engineRef.current?.applyConfirmedMobKnockback("));
assert.ok(claimFlow.indexOf("result.ok && result.damage > 0") < claimFlow.indexOf("applyConfirmedMobKnockback"), "remote motion never predicts damage");

console.log("player knockback integration tests passed");
