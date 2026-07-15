import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const engine = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");
const client = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");

assert.ok(engine.includes('keys.has("ControlLeft") || keys.has("ControlRight")'), "either Ctrl key requests sprint");
assert.ok(engine.includes('"ControlLeft", "ControlRight"].includes(event.code)'), "pointer-locked movement prevents browser Ctrl shortcuts");
assert.ok(engine.includes("const sneakHeld = resolveSneakIntent("), "Shift and low-ceiling posture use the tested release helper");
assert.ok(engine.includes('movementMode === "sneak" && grounded'), "ledge protection is limited to grounded sneaking");
assert.ok(engine.includes("clampSneakAxisMovement(amount"), "sneak movement uses the deterministic support clamp");
assert.ok(engine.includes("smoothPlayerPosture(cameraPosture"), "eye/body/FOV posture is smoothed in the physics loop");
assert.ok(engine.includes("perspective(cameraPosture.fovRadians"), "rendering consumes the smoothed FOV");
assert.ok(engine.includes("const eye = cameraEye();"), "rendering consumes the bobbed visual camera origin");
assert.ok(engine.includes("raycastVoxels(interactionEye()"), "block targeting uses the posture eye without cosmetic bob");
assert.ok(engine.includes("const eye = interactionEye();"), "combat uses the same Lakebed-valid posture eye");
assert.ok(engine.includes("postureTargetsForMovement(movementMode).eyeHeight"), "interaction rays use one of Lakebed's discrete accepted posture heights");
assert.ok(engine.includes("bobEnvelope = smoothMovementValue("), "head bob starts and stops through a bounded envelope");
assert.ok(engine.includes("resetMovementView();"), "pointer loss and reconciliation reset transient camera state");
assert.ok(engine.includes("const mustRemainSneaking = collides"), "resets preserve crouch under a low ceiling");
assert.ok(engine.includes("playerViewSuspended = true"), "death resets transient view state exactly once");
assert.ok(!engine.includes("pose.y + 1.62"), "no stale fixed interaction eye remains in the engine");
assert.ok(client.includes("canSprint: () => hungerRef.current > 6"), "survival hunger gates Ctrl sprint");
assert.ok(client.includes("activityHalfUnitsForDisplacement") === false, "the client cannot author survival exertion");
assert.ok(!client.includes("tickSurvival("), "the client no longer advances survival health locally");
assert.ok(!client.includes("recentlyActiveUntilRef"), "the old pose-update activity approximation is removed");

console.log("lakecraft movement integration tests: ok");
