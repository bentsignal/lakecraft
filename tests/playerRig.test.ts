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
assert.equal(playerRigInputForMovement("sneak", 450).crouching, true);
assert.deepEqual(playerRigInputForMovement("sneak", 450, false), {
  motion: "idle", phase: 0.1875, crouching: true,
}, "stationary crouching never reuses the walking cycle");
const crouchWalkInput = playerRigInputForMovement("sneak", 225, true);
const crouchWalk = resolvePlayerRigPose(crouchWalkInput);
assert.equal(crouchWalkInput.motion, "walk");
assert.equal(crouchWalkInput.crouching, true);
assert.notEqual(crouchWalk.rightLegPitch, 0, "moving crouch has its own restrained step animation");
assert.ok(Math.abs(crouchWalk.rightLegPitch) < Math.abs(walk.rightLegPitch),
  "crouch-walking never reuses the full standing stride");
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

const action = resolvePlayerRigPose({ motion: "idle", phase: 0, actionProgress: 0.5 });
assert.ok(action.rightArmPitch < -0.9 && action.rightArmPitch > -1.1,
  "a local action has a readable but restrained forward pitch");
assert.ok(resolvePlayerRigPose({ motion: "idle", phase: 0, actionProgress: 0.25 }).rightArmYaw > 0.25
  && resolvePlayerRigPose({ motion: "idle", phase: 0, actionProgress: 0.75 }).rightArmYaw < -0.25,
"the action travels outward and back in a circular arc instead of flicking on one axis");
assert.ok(Math.abs(action.rightArmYaw) < 1e-7, "the action crosses its resting yaw at mid-swing");
assert.equal(action.leftArmPitch, resolvePlayerRigPose({ motion: "idle", phase: 0 }).leftArmPitch,
  "one-handed actions do not disturb the off hand");
const crouch = resolvePlayerRigPose({ motion: "idle", phase: 0, crouching: true });
assert.ok(crouch.bodyPitch > 0.4 && crouch.bodyYOffset < 0 && crouch.bodyZOffset < 0,
  "sneaking lowers and counterbalances the shared hip behind the standing center line");
writePlayerRigPartMatrix(matrix, "root", crouch, "wide", true, new Float32Array(16));
assert.notEqual(matrix[6], 0, "the crouched torso leans forward around its hip pivot");
const crouchedHipY = 0.75 * Math.cos(crouch.bodyPitch);
const crouchedHipZ = -0.75 * Math.sin(crouch.bodyPitch);
assert.ok(Math.abs(matrix[5] * 0.75 + matrix[13] - crouchedHipY) < 1e-7
  && Math.abs(matrix[6] * 0.75 + matrix[14] - crouchedHipZ) < 1e-7,
  "the crouched torso remains connected to the backward-displaced leg hip pivot");
const standingLook = resolvePlayerRigPose({ motion: "idle", phase: 0, headYaw: 0.55, headPitch: -0.3 });
const crouchedLook = resolvePlayerRigPose({
  motion: "idle", phase: 0, headYaw: 0.55, headPitch: -0.3, crouching: true,
});
const standingHeadMatrix = new Float32Array(16);
const crouchedHeadMatrix = new Float32Array(16);
writePlayerRigPartMatrix(standingHeadMatrix, "head", standingLook, "wide", true);
writePlayerRigPartMatrix(crouchedHeadMatrix, "head", crouchedLook, "wide", true);
assert.deepEqual([...crouchedHeadMatrix.slice(0, 12)], [...standingHeadMatrix.slice(0, 12)],
  "crouching preserves standing head tracking without adding sideways roll");
assert.notEqual(crouchedHeadMatrix[13], standingHeadMatrix[13],
  "the crouched neck position follows the leaned torso");
assert.ok(Math.abs(crouchedHeadMatrix[14] - standingHeadMatrix[14]) < 1e-7,
  "counterbalanced crouching moves the head straight down without pushing it forward");
writePlayerRigPartMatrix(matrix, "rightLeg", crouch, "wide", true, new Float32Array(16));
assert.ok(Math.abs(matrix[5] * 0.75 + matrix[13] - crouchedHipY) < 1e-7
  && Math.abs(matrix[6] * 0.75 + matrix[14] - crouchedHipZ) < 1e-7,
"stationary crouching keeps the backward-leaning leg attached at the shared hip");
assert.ok(matrix[6] < 0, "stationary crouching leans both legs backward without a walk cycle");

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
assert.match(engineSource, /playerRigInputForMovement\(movementMode, now, movementActivity > 0\.5\)/,
  "third-person production distinguishes actual movement from idle crouch activity");
assert.match(engineSource, /@lakecraft-voxel-development:rig-preview:start[\s\S]*previewMode/,
  "the visual Pose Lab can override the live rig only inside its reviewed development surface");
assert.match(engineSource, /thirdPersonRigPreview === 8\) previewActionProgress = 0\.25/,
  "the visual Pose Lab exposes one deterministic quarter-swing frame for screenshot review");

console.log("articulated local player rig tests passed");
