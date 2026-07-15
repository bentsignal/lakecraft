import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BLOCK_CRACK_STAGE_COUNT, miningCrackStage } from "../client/components/firstPersonFeedback.ts";

assert.equal(miningCrackStage(Number.NaN), -1, "invalid progress hides cracks");
assert.equal(miningCrackStage(0), -1, "idle mining hides cracks");
assert.equal(miningCrackStage(0.001), 0, "mining starts on the first crack frame");
assert.equal(miningCrackStage(0.5), 5, "halfway mining selects the midpoint frame");
assert.equal(miningCrackStage(0.999), BLOCK_CRACK_STAGE_COUNT - 1, "near-complete mining shows maximum damage");
assert.equal(miningCrackStage(1), -1, "completed mining removes the crack overlay");

const component = readFileSync(new URL("../client/components/FirstPersonHeldItem.tsx", import.meta.url), "utf8");
const hud = readFileSync(new URL("../client/components/GameHud.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../client/components/HudStyles.tsx", import.meta.url), "utf8");

assert.ok(component.includes("HeldBlockVoxel"), "held full blocks use the dedicated three-face voxel renderer");
assert.ok(component.includes("ItemIcon compact"), "held tools and non-cubic items retain the canonical 16x16 renderer");
assert.ok(component.includes('data-held-mode={heldAsVoxel ? "voxel"'), "held mode distinguishes cubes from sprites and the empty hand");
assert.ok(component.includes("actionToken > 0"), "an action token controls the replayable swing state");
assert.ok(component.includes("if (hidden || paused) return null"), "hidden and paused states remove the bounded overlay DOM");
assert.equal(component.match(/\"M\d+/g)?.length, BLOCK_CRACK_STAGE_COUNT, "crack overlay has ten bounded damage segments");
assert.ok(hud.includes("stack={inventory[selectedIndex] ?? null}"), "GameHud drives the held rig from the selected hotbar stack");
assert.ok(hud.includes("inventoryOpen || mobileUnsupported"), "blocking UI hides the first-person overlay");
assert.ok(styles.includes("@keyframes lc-held-item-swing"), "swing feedback has a dedicated short animation");
assert.ok(styles.includes("rotateX(-24deg) rotateY(-38deg)"), "held block rotates its front, right, and top faces toward the camera");
assert.ok(styles.includes("lc-held-voxel__face--front") && styles.includes("lc-held-voxel__face--right") && styles.includes("lc-held-voxel__face--top"), "held cube exposes three independently shaded faces");
assert.ok(styles.includes(".lc-first-person__rig.is-swinging { animation: none; }"), "reduced-motion users do not receive the swing animation");

console.log("first-person held item and block crack feedback tests passed");
