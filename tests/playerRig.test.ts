import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fullPlayerArmorAppearance } from "../client/game/playerArmorGeometry.ts";
import {
  PLAYER_RIG_SKIN_DRAWS,
  playerArmorRigDraws,
  playerRigInputForMovement,
  resolvePlayerRigPose,
  writePlayerRigPartMatrix,
} from "../client/game/playerRig.ts";

const idle = resolvePlayerRigPose({ motion: "idle", phase: 0.25 });
assert.deepEqual(idle, resolvePlayerRigPose({ motion: "idle", phase: 1.25 }), "idle sampling wraps deterministically");
assert.equal(idle.rightLegPitch, 0);
assert.equal(idle.leftLegPitch, 0);
assert.notEqual(idle.rightArmPitch, idle.leftArmPitch, "idle arms rest with a subtle non-mannequin offset");
assert.equal(Object.isFrozen(idle), true);

const walk = resolvePlayerRigPose({ motion: "walk", phase: 0.25 });
assert.equal(walk.rightArmPitch, -walk.leftArmPitch);
assert.equal(walk.rightLegPitch, -walk.leftLegPitch);
assert.equal(walk.rightArmPitch, walk.leftLegPitch, "opposite arm and leg advance together");
assert.ok(Math.abs(walk.rightArmPitch) > 0.7, "full walk exposes a readable articulated stride");
assert.deepEqual(resolvePlayerRigPose({ motion: "walk", phase: Number.NaN }),
  resolvePlayerRigPose({ motion: "walk", phase: 0 }), "invalid phases fail to a stable stance");

assert.deepEqual(playerRigInputForMovement("idle", 1_200), { motion: "idle", phase: 0.5 });
assert.deepEqual(playerRigInputForMovement("sprint", 210), { motion: "walk", phase: 0.5, intensity: 1 });
assert.equal(playerRigInputForMovement("sneak", 450).intensity, 0.45);
assert.equal(playerRigInputForMovement("ladder", 360).intensity, 0.65);

assert.deepEqual(PLAYER_RIG_SKIN_DRAWS, [
  { part: "head", first: 0, count: 72 },
  { part: "root", first: 72, count: 72 },
  { part: "rightArm", first: 144, count: 72 },
  { part: "leftArm", first: 216, count: 72 },
  { part: "rightLeg", first: 288, count: 72 },
  { part: "leftLeg", first: 360, count: 72 },
]);
assert.equal(PLAYER_RIG_SKIN_DRAWS.reduce((total, draw) => total + draw.count, 0), 432,
  "base and outer skin layers are each covered exactly once");

const matrix = new Float32Array(16);
const looking = resolvePlayerRigPose({ motion: "idle", phase: 0, headYaw: 0.5, headPitch: -0.25 });
writePlayerRigPartMatrix(matrix, "head", looking, "wide", true);
assert.notEqual(matrix[2], 0, "head yaw articulates independently from the torso world matrix");
assert.notEqual(matrix[9], 0, "head pitch articulates around the neck pivot");
assert.ok(Math.abs(matrix[5] * 1.5 + matrix[13] - 1.5) < 1e-7,
  "head pitch preserves the neck pivot instead of orbiting the skull");
writePlayerRigPartMatrix(matrix, "rightArm", walk, "wide", true);
assert.equal(matrix[12], -0.75, "standard right-arm UV geometry moves to anatomical -X");
writePlayerRigPartMatrix(matrix, "leftArm", walk, "slim", true);
assert.equal(matrix[12], 0.6875, "slim left-arm UV geometry moves to anatomical +X");
const slimShoulderY = 1.46875;
const slimShoulderTransformedY = matrix[5] * slimShoulderY + matrix[13];
const slimShoulderTransformedZ = matrix[6] * slimShoulderY + matrix[14];
assert.ok(Math.abs(slimShoulderTransformedY - slimShoulderY) < 1e-7
  && Math.abs(slimShoulderTransformedZ) < 1e-7,
"the slim arm pivots at its half-pixel-lower shoulder instead of orbiting a gap above it");
writePlayerRigPartMatrix(matrix, "rightLeg", walk, "wide", true);
assert.equal(matrix[12], -0.25, "standard right-leg UV geometry moves to anatomical -X");
writePlayerRigPartMatrix(matrix, "rightArm", walk, "wide", false);
assert.equal(matrix[12], 0, "already anatomical armor shells retain their authored side");
const pivotY = 1.5;
const transformedPivotY = matrix[5] * pivotY + matrix[13];
const transformedPivotZ = matrix[6] * pivotY + matrix[14];
assert.ok(Math.abs(transformedPivotY - pivotY) < 1e-7 && Math.abs(transformedPivotZ) < 1e-7,
  "arm rotation preserves its shoulder pivot");

const armorDraws = playerArmorRigDraws(fullPlayerArmorAppearance("iron"));
assert.equal(armorDraws.reduce((total, draw) => total + draw.count, 0), 20 * 36);
assert.deepEqual(armorDraws.map((draw) => draw.part), [
  "head", "root", "rightArm", "leftArm", "root", "rightLeg", "leftLeg", "rightLeg", "leftLeg",
], "crown, chest plates, bracers, belt, leggings, cuffs, and boots follow their anatomical joints");
assert.deepEqual(armorDraws.map((draw) => draw.count), [144, 144, 72, 72, 72, 36, 36, 72, 72],
  "every detailed plate group maps to its exact articulated joint range");
assert.deepEqual(playerArmorRigDraws({ chest: "iron_helmet" }), [], "wrong-slot armor cannot corrupt rig ranges");

const source = readFileSync(new URL("../client/game/playerRig.ts", import.meta.url), "utf8");
assert.doesNotMatch(source, /Math\.random|setInterval|setTimeout|requestAnimationFrame/,
  "rig sampling is pure and driven only by caller-provided state");
const rendererSource = readFileSync(new URL("../client/game/playerSkinRenderer.ts", import.meta.url), "utf8");
assert.match(rendererSource, /setPartMvp\("rightArm", true, itemMvpLocation\)/,
  "held items inherit the same anatomical right-arm joint as the hand socket");
const engineSource = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");
assert.match(engineSource, /playerRigInputForMovement\(movementMode, now\)/,
  "third-person production samples the deterministic rig from live movement state");

console.log("articulated local player rig tests passed");
