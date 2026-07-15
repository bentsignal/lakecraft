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
assert.ok(component.includes("HeldSpriteExtrusion"), "held tools and non-cubic items use the depth-preserving sprite renderer");
assert.ok(component.includes("ItemIcon compact"), "the depth renderer retains the canonical 16x16 artwork");
assert.ok(component.includes("HELD_SPRITE_DEPTH_SLICES = [0, 1, 2, 3, 4]"), "sprite depth has a deterministic five-slice DOM budget");
assert.equal(component.match(/lc-first-person__arm-face--/g)?.length, 3, "each reusable voxel arm segment defines exactly three camera-visible faces");
assert.ok(component.includes('<VoxelArmSegment material="sleeve" />') && component.includes('<VoxelArmSegment material="skin" />'), "the first-person arm joins a sleeve prism to a hand prism");
assert.ok(component.includes('data-held-mode={heldAsVoxel ? "voxel"'), "held mode distinguishes cubes from sprites and the empty hand");
assert.ok(component.includes("actionToken > 0"), "an action token controls the replayable swing state");
assert.ok(component.includes("if (hidden || paused) return null"), "hidden and paused states remove the bounded overlay DOM");
assert.equal(component.match(/\"M\d+/g)?.length, BLOCK_CRACK_STAGE_COUNT, "crack overlay has ten bounded damage segments");
assert.ok(hud.includes("stack={inventory[selectedIndex] ?? null}"), "GameHud drives the held rig from the selected hotbar stack");
assert.ok(hud.includes("inventoryOpen || mobileUnsupported"), "blocking UI hides the first-person overlay");
assert.ok(styles.includes("@keyframes lc-held-item-swing"), "swing feedback has a dedicated short animation");
assert.ok(styles.includes("rotateX(-24deg) rotateY(-34deg)"), "held block rotates its front, right, and top faces toward the camera");
assert.ok(styles.includes("lc-held-voxel__face--front") && styles.includes("lc-held-voxel__face--right") && styles.includes("lc-held-voxel__face--top"), "held cube exposes three independently shaded faces");
assert.ok(styles.includes("transform-style: preserve-3d") && styles.includes("perspective: 620px"), "the arm rig retains perspective through its nested cuboids");
assert.ok(component.includes("lc-first-person__arm-face--left") && styles.includes("rotateY(-90deg)"), "the inward-angled right arm exposes its camera-facing left side instead of the hidden outer face");
assert.ok(styles.includes(".lc-held-sprite__slice.is-front"), "the foremost sprite layer restores full authored color above its shaded depth slices");
assert.equal(styles.includes("lc-first-person__sleeve"), false, "the old flat sleeve rectangle is removed");
assert.ok(styles.includes(".lc-first-person__rig.is-swinging { animation: none; }"), "reduced-motion users do not receive the swing animation");

console.log("first-person held item and block crack feedback tests passed");
