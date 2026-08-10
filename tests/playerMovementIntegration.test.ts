import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const engine = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");
const client = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");

assert.ok(engine.includes("sprintControlHeld(sprintControls)"), "either physical Ctrl side requests sprint");
assert.ok(engine.includes("sprintControlHeld(sprintControls) || forwardSprintTap.active"),
  "Ctrl and Minecraft-style W double tap independently request sprint");
assert.ok(engine.includes('"ControlLeft", "ControlRight"].includes(event.code)'), "pointer-locked movement prevents browser Ctrl shortcuts");
const keyDown = engine.slice(engine.indexOf("function onKeyDown"), engine.indexOf("function onKeyUp"));
const keyUp = engine.slice(engine.indexOf("function onKeyUp"), engine.indexOf("function releaseTransientInput"));
assert.ok(keyDown.includes("updateSprintControl(sprintControls, event.code as SprintControlCode, true)"),
  "keydown records the exact physical Ctrl side without toggle heuristics");
assert.ok(keyDown.includes("transitionForwardSprintTap(forwardSprintTap, performance.now(), true, event.repeat)"),
  "W keydown advances the repeat-safe double-tap state");
assert.ok(keyUp.includes("updateSprintControl(sprintControls, event.code, false)"),
  "keyup releases the exact Ctrl side without trusting modifier metadata");
assert.ok(keyUp.includes("transitionForwardSprintTap(forwardSprintTap, performance.now(), false)"),
  "W keyup arms or releases Minecraft-style double-tap sprint");
assert.equal(keyUp.includes("event.ctrlKey"), false, "keyup cannot leave sprint latched through inconsistent modifier metadata");
assert.ok(engine.includes('window.addEventListener("blur", onWindowBlur)'), "focus loss releases held movement input");
assert.ok(engine.includes('document.addEventListener("visibilitychange", onVisibilityChange)'), "backgrounding the tab releases held movement input");
const transientReset = engine.slice(engine.indexOf("function releaseTransientInput"), engine.indexOf("function onWindowBlur"));
assert.ok(transientReset.includes("clearHeldMovementInput();"), "blur and background handlers share the complete sprint reset");
const heldMovementReset = engine.slice(engine.indexOf("function clearHeldMovementInput"), engine.indexOf("function updateMiningCrackGeometry"));
assert.ok(heldMovementReset.includes("forwardSprintTap = createForwardSprintTapState();"),
  "pause, focus loss, death, and pointer loss cannot leave double-tap sprint latched");
assert.ok(engine.includes("const sneakHeld = resolveSneakIntent("), "Shift and low-ceiling posture use the tested release helper");
assert.ok(engine.includes('movementMode === "sneak" && grounded'), "ledge protection is limited to grounded sneaking");
assert.ok(engine.includes("clampSneakAxisMovement(amount"), "sneak movement uses the deterministic support clamp");
assert.ok(engine.includes("smoothPlayerPosture(cameraPosture"), "eye/body/FOV posture is smoothed in the physics loop");
assert.ok(engine.includes("cameraPostureTarget.fovRadians = movementFovRadians(movementMode, options.getFieldOfViewRadians?.())"),
  "the smoothed posture target combines live configured FOV with the resolved movement mode");
assert.ok(engine.includes("cameraPosture.fovRadians = movementFovRadians(movementMode, options.getFieldOfViewRadians?.())"),
  "camera resets discard sprint widening without discarding the configured base FOV");
assert.match(
  engine,
  /writePerspectiveMatrix\(\s*projectionMatrix,\s*cameraPosture\.fovRadians,\s*aspect,\s*0\.05,\s*fogRange\[1\] \+ WORLD_CHUNK_SIZE,\s*\)/,
  "rendering consumes the smoothed FOV with the render-distance fog-derived far plane",
);
assert.match(engine,
  /writePerspectiveMatrix\(firstPersonProjectionMatrix,\s*options\.getFieldOfViewRadians\?\.\(\) \?\? cameraPosture\.fovRadians,\s*aspect,/,
  "temporary sprint FOV widening cannot stretch the first-person arm and held item");
assert.match(engine, /uniform1f\(atmosphereFovLocation, Math\.tan\(cameraPosture\.fovRadians \/ 2\)\)/,
  "the sky and world share the same smoothed sprint-FOV projection");
assert.ok(engine.includes("const eye = cameraEye(renderEye);"), "rendering consumes the bobbed visual camera origin through retained scratch");
assert.ok(engine.includes("interactionEye(raycastEye)"), "block targeting uses the posture eye without cosmetic bob or allocation");
assert.ok(engine.includes("const eye = interactionEye();"), "combat uses the same Lakebed-valid posture eye");
assert.ok(engine.includes("postureTargetsForMovement(movementMode).eyeHeight"), "interaction rays use one of Lakebed's discrete accepted posture heights");
assert.ok(engine.includes("advanceHeadBob("), "grounded displacement advances the smoothed head-bob state");
assert.ok(engine.includes("reducedMotionQuery?.matches !== true"), "reduced-motion preference suppresses camera gait");
const bobAdvance = engine.slice(engine.indexOf("advanceHeadBob("), engine.indexOf("if (grounded && movedHorizontally", engine.indexOf("advanceHeadBob(")));
assert.ok(bobAdvance.includes("movedHorizontally"), "bob phase consumes collision-accepted displacement, not requested speed or wall time");
assert.ok(bobAdvance.includes("grounded"), "airborne movement cannot advance the ground gait");
assert.ok(bobAdvance.includes("movementMode"), "walk, sprint, and sneak keep independent gait profiles");
assert.ok(bobAdvance.includes("cameraBob,") && bobAdvance.trimEnd().endsWith(");"),
  "the frame loop updates caller-owned bob state without transient allocation");
assert.equal(engine.match(/const interactionBob: HeadBobOffsets = \{ x: 0, y: 0 \};/g)?.length, 1,
  "interaction rays retain one immutable zero-bob origin for crosshair and multiplayer envelopes");
assert.ok(engine.includes("writePlayerEye(pose.x, pose.y, pose.z, pose.yaw, cameraPosture.eyeHeight, cameraBob"),
  "visual camera translation and view direction still share the retained camera eye");
assert.ok(engine.includes("resetMovementView();"), "pointer loss and reconciliation reset transient camera state");
assert.ok(engine.includes("const mustRemainSneaking = collides"), "resets preserve crouch under a low ceiling");
assert.ok(engine.includes("playerViewSuspended = true"), "death resets transient view state exactly once");
const deathResetStart = engine.indexOf("if (playerHealth <= 0)");
const deathReset = engine.slice(deathResetStart, engine.indexOf("playerViewSuspended = false", deathResetStart));
const pointerReset = engine.slice(engine.indexOf("function onPointerLockChange"), engine.indexOf("function onContextMenu"));
const pauseReset = engine.slice(engine.indexOf("setPaused(nextPaused)"), engine.indexOf("isPaused()"));
assert.ok(deathReset.includes("clearHeldMovementInput();"), "death releases sprint before another movement frame");
assert.ok(pointerReset.includes("releaseTransientInput();"), "pointer-lock loss releases sprint and every other held action");
assert.ok(pauseReset.includes("clearHeldMovementInput();"), "opening a menu releases sprint");
assert.ok(pauseReset.includes("resetMovementView();"), "opening a menu hard-resets residual camera gait");
assert.ok(!engine.includes("pose.y + 1.62"), "no stale fixed interaction eye remains in the engine");
assert.ok(client.includes('canSprint: () => realtimeGameModeRef.current === "creative" || hungerRef.current > 6'),
  "survival hunger gates Ctrl sprint while server-granted Creative bypasses hunger");
assert.ok(client.includes("activityHalfUnitsForDisplacement") === false, "the client cannot author survival exertion");
assert.ok(!client.includes("tickSurvival("), "the client no longer advances survival health locally");
assert.ok(!client.includes("recentlyActiveUntilRef"), "the old pose-update activity approximation is removed");

console.log("lakecraft movement integration tests: ok");
