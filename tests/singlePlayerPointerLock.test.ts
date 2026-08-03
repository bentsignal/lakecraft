import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  COMMAND_ESCAPE_LOCK_LOSS_SUPPRESS_MS,
  POINTER_LOCK_ESCAPE_DEDUP_MS,
  createSinglePlayerPointerSessionState,
  singlePlayerSilentRecaptureKey,
  transitionSinglePlayerPointerSession,
  type SinglePlayerPointerSessionEvent,
  type SinglePlayerPointerSessionState,
} from "../client/singleplayer/sessionState.ts";

function run(
  state: SinglePlayerPointerSessionState,
  event: SinglePlayerPointerSessionEvent,
) {
  return transitionSinglePlayerPointerSession(state, event);
}

function assertSourceOrder(source: string, before: string, after: string, message: string): void {
  const beforeIndex = source.indexOf(before);
  const afterIndex = source.indexOf(after);
  assert.ok(beforeIndex >= 0, `${message}: missing ${before}`);
  assert.ok(afterIndex >= 0, `${message}: missing ${after}`);
  assert.ok(beforeIndex < afterIndex, message);
}

assert.throws(
  () => assertSourceOrder(
    "setSinglePlayer(true);",
    "requestDocumentPointerLockHandoff()",
    "setSinglePlayer(true)",
    "negative missing-request fixture",
  ),
  /missing requestDocumentPointerLockHandoff/,
  "an absent pointer request cannot satisfy an ordering assertion through -1 indexes",
);

const active = createSinglePlayerPointerSessionState(true);
const keyFirst = run(active, { type: "escape", now: 100, uiBlocked: false });
assert.equal(keyFirst.openPause, true, "keydown-first Escape opens Game Menu once");
assert.equal(keyFirst.state.intentionalReleasePending, true, "keydown-first Escape classifies its resulting unlock");
const keyFirstLoss = run(keyFirst.state, { type: "lock_change", locked: false, now: 101, uiBlocked: false });
assert.equal(keyFirstLoss.openPause, false, "keydown-first pointerlockchange cannot open a duplicate menu");
assert.equal(keyFirstLoss.state.pauseOpen, true, "keydown-first pointerlockchange leaves Game Menu open");

const lossFirst = run(active, { type: "lock_change", locked: false, now: 200, uiBlocked: false });
assert.equal(lossFirst.openPause, true, "pointerlockchange-first Escape opens Game Menu once");
const lossFirstKey = run(lossFirst.state, { type: "escape", now: 201, uiBlocked: false });
assert.equal(lossFirstKey.openPause, false, "the matching late keydown cannot open a duplicate menu");
assert.equal(lossFirstKey.closePause, false, "the matching late keydown cannot immediately close Game Menu");
assert.equal(lossFirstKey.requestPointerLock, false, "the matching late keydown cannot immediately recapture");
assert.equal(lossFirstKey.state.pauseOpen, true);

const laterEscape = run(lossFirstKey.state, {
  type: "escape",
  now: 200 + POINTER_LOCK_ESCAPE_DEDUP_MS + 1,
  uiBlocked: false,
});
assert.equal(laterEscape.closePause, true, "a later deliberate Escape resumes");
assert.equal(laterEscape.requestPointerLock, true, "keyboard resume reuses its key gesture for capture");

for (const surface of ["inventory", "container", "death", "sleep", "title", "teardown"]) {
  const release = run(active, { type: "intentional_release" });
  const loss = run(release.state, { type: "lock_change", locked: false, now: 300, uiBlocked: true });
  assert.equal(loss.openPause, false, `${surface} pointer release never opens Game Menu`);
  assert.equal(loss.state.intentionalReleasePending, false, `${surface} release token is consumed exactly once`);
}

const duplicateLoss = run(keyFirstLoss.state, {
  type: "lock_change",
  locked: false,
  now: 400,
  uiBlocked: false,
});
assert.equal(duplicateLoss.openPause, false, "duplicate pointerlockchange never adds another pause transition");

const resumeClick = run(keyFirstLoss.state, { type: "resume" });
assert.equal(resumeClick.closePause, true, "Back to Game closes Game Menu");
assert.equal(resumeClick.requestPointerLock, true, "Back to Game requests lock in the click handler");
const recaptured = run(resumeClick.state, { type: "lock_change", locked: true, now: 500, uiBlocked: false });
assert.equal(recaptured.state.locked, true);
assert.equal(recaptured.showCaptureAffordance, false, "successful recapture removes the fallback affordance");
const denied = run(resumeClick.state, { type: "lock_change", locked: false, now: 501, uiBlocked: false });
assert.equal(denied.showCaptureAffordance, true, "denied or lost capture exposes one explicit recovery action");

/**
 * Real Chrome trace from the command input: keydown(Escape) closes Preact UI,
 * a lock-acquired callback may land, then the same browser Escape action emits
 * pointer-lock loss. DOM propagation cancellation cannot stop that browser
 * lifecycle, so the state token must survive the intermediate locked callback.
 */
for (const commandResultRendered of [false, true]) {
  const chatRelease = run(active, { type: "intentional_release" });
  const chatUnlocked = run(chatRelease.state, {
    type: "lock_change",
    locked: false,
    now: 1_000,
    // React can still expose the previous render while pointerlockchange lands.
    uiBlocked: false,
  });
  assert.equal(chatUnlocked.openPause, false, "opening focused chat never pauses");

  // Rendering a command result changes chat data, not pointer-session state.
  const beforeClose = commandResultRendered ? { ...chatUnlocked.state } : chatUnlocked.state;
  const close = run(beforeClose, { type: "close_ui_escape", now: 1_100 });
  assert.equal(close.openPause, false, "one chat Escape closes without Game Menu");
  assert.equal(close.requestPointerLock, false, "keydown waits until Chrome finishes its native Escape processing");
  assert.equal(close.showCaptureAffordance, false, "closing chat never flashes Click to Play");

  const repeat = run(close.state, { type: "escape", now: 1_101, repeat: true, uiBlocked: false });
  assert.equal(repeat.openPause, false, "the held Escape repeat cannot spend the suppression token or pause");
  const recapturedByGameplay = run(repeat.state, { type: "lock_change", locked: true, now: 1_102, uiBlocked: false });
  assert.equal(recapturedByGameplay.state.locked, true);
  assert.equal(recapturedByGameplay.state.intentionalReleasePending, true,
    "the suppression token survives silent gameplay recapture until delayed native loss is absent");
}

for (const code of ["KeyW", "KeyA", "KeyS", "KeyD", "Space", "ShiftLeft", "ControlRight"]) {
  assert.equal(singlePlayerSilentRecaptureKey(code), true, `${code} is an eligible gameplay activation`);
}
for (const code of ["Escape", "Slash", "KeyT", "Enter", "KeyE", "KeyQ"]) {
  assert.equal(singlePlayerSilentRecaptureKey(code), false, `${code} cannot spend silent gameplay recapture`);
}
assert.equal(singlePlayerSilentRecaptureKey("KeyW", true), false, "key repeat cannot duplicate a lock request");

const closeThenGameplay = run(createSinglePlayerPointerSessionState(false), { type: "close_ui_escape", now: 2_000 });
const gameplayLock = run(closeThenGameplay.state, { type: "lock_change", locked: true, now: 2_010, uiBlocked: false });
const ordinaryGameplayEscape = run(gameplayLock.state, { type: "escape", now: 2_100, uiBlocked: false });
assert.equal(ordinaryGameplayEscape.openPause, true, "the next deliberate gameplay Escape still opens Game Menu");

const rapidFirstClose = run(createSinglePlayerPointerSessionState(false), { type: "close_ui_escape", now: 3_000 });
const rapidReopen = run(rapidFirstClose.state, { type: "intentional_release" });
assert.equal(rapidReopen.state.ignoreEscapeUntil, Number.NEGATIVE_INFINITY, "rapid reopen clears the prior close token");
const rapidSecondClose = run(rapidReopen.state, { type: "close_ui_escape", now: 3_010 });
assert.equal(
  rapidSecondClose.state.ignoreEscapeUntil,
  3_010 + COMMAND_ESCAPE_LOCK_LOSS_SUPPRESS_MS,
  "rapid close arms one fresh bounded token",
);
const expiredTransientLock = run(rapidSecondClose.state, { type: "lock_change", locked: true, now: 3_011, uiBlocked: false });
const expiredLoss = run(expiredTransientLock.state, {
  type: "lock_change",
  locked: false,
  now: 3_010 + COMMAND_ESCAPE_LOCK_LOSS_SUPPRESS_MS + 1,
  uiBlocked: false,
});
assert.equal(expiredLoss.openPause, true, "a later unrelated lock loss cannot be hidden by a stale chat token");

const engineSource = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");
const pointerLossHandler = engineSource.slice(
  engineSource.indexOf("function onPointerLockChange"),
  engineSource.indexOf("function onContextMenu"),
);
assert.ok(pointerLossHandler.includes("releaseTransientInput();"), "every pointer-lock loss clears all transient input");
const transientRelease = engineSource.slice(
  engineSource.indexOf("function releaseTransientInput"),
  engineSource.indexOf("function onWindowBlur"),
);
for (const cleanup of [
  "clearHeldMovementInput();",
  "cancelPrimaryActionHold();",
  "cancelSecondaryPlacementHold(true);",
  "clearRangedCharge(true);",
]) {
  assert.ok(transientRelease.includes(cleanup), `pointer-lock loss prevents stuck input via ${cleanup}`);
}

const appSource = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");
const entryHandler = appSource.slice(
  appSource.indexOf("function joinSingleplayer"),
  appSource.indexOf("return singlePlayer", appSource.indexOf("function joinSingleplayer")),
);
assert.equal(entryHandler.includes("requestPointerLock"), false,
  "opening the world browser does not transiently capture the pointer");
assert.equal(entryHandler.includes("window.location.search ="), false, "entry no longer discards user activation through navigation");

const browserSource = readFileSync(new URL("../client/singleplayer/LocalWorldBrowser.tsx", import.meta.url), "utf8");
const playHandler = browserSource.slice(
  browserSource.indexOf("  function play"),
  browserSource.indexOf("\n  function ", browserSource.indexOf("  function play") + 1),
);
assertSourceOrder(
  playHandler,
  "resolveLocalWorldPlay(storage, entry, result)",
  "onPlay(playable, requestDocumentPointerLockHandoff())",
  "Play validates the exact world before requesting pointer capture in its click handler",
);

const handoffSource = readFileSync(new URL("../client/pointerLockHandoff.ts", import.meta.url), "utf8");
assertSourceOrder(
  handoffSource,
  'typeof document.documentElement.requestPointerLock !== "function"',
  "try {",
  "pointer capture checks browser support before its guarded request",
);
const guardedRequest = handoffSource.slice(handoffSource.indexOf("try {"), handoffSource.indexOf("catch {"));
assertSourceOrder(
  guardedRequest,
  "document.documentElement.requestPointerLock()",
  ".catch(() => undefined)",
  "the Play-gesture request handles asynchronous rejection before reporting handoff",
);
assertSourceOrder(
  handoffSource,
  "return true;",
  "catch {",
  "a successful synchronous request reports handoff before the failure branch",
);
assert.ok(handoffSource.includes("catch {\n    return false;"),
  "synchronous request failures report a false handoff without mounting an optimistic capture");

const singlePlayerSource = readFileSync(new URL("../client/singleplayer/SinglePlayerApp.tsx", import.meta.url), "utf8");
const chatEscapeClose = singlePlayerSource.slice(
  singlePlayerSource.indexOf("function closeCommandConsoleFromEscape"),
  singlePlayerSource.indexOf("function selectHotbar"),
);
assert.ok(chatEscapeClose.includes("armGameplayResumeAfterEscape"));
assert.equal(chatEscapeClose.includes("requestGameplayPointerLock"), false,
  "chat Escape cannot race Chrome with an impossible direct recapture request");
assert.equal(singlePlayerSource.includes('type: "resume_after_escape_keyup"'), false,
  "Escape itself is never treated as a Pointer Lock user activation");
assert.match(singlePlayerSource, /silentPointerRecaptureRef\.current && singlePlayerSilentRecaptureKey[\s\S]{0,180}requestEnginePointerLock\(true\)/,
  "the next eligible gameplay key silently requests capture without consuming its engine event");
assert.ok(singlePlayerSource.includes("allowUnlockedKeyboardInput: () => silentPointerRecaptureRef.current"),
  "the initiating movement key remains live while Chrome grants capture asynchronously");
assert.ok(singlePlayerSource.includes('if (keyboardCode === "Escape") armGameplayResumeAfterEscape(performance.now())'),
  "inventory Escape shares the same silent recapture state machine");
assert.match(singlePlayerSource, /cancelRangedActionForEscape\(\)[\s\S]{0,300}armGameplayResumeAfterEscape/,
  "bow Escape cancels the draw before arming silent gameplay recapture");
assert.ok(singlePlayerSource.includes("Click to Play"), "failed handoff has one explicit pointer-capture affordance");
const escapeArm = singlePlayerSource.slice(
  singlePlayerSource.indexOf("function armGameplayResumeAfterEscape"),
  singlePlayerSource.indexOf("function warnWorldEditCapacity"),
);
assert.equal(escapeArm.includes("setPointerCaptureNeeded(true)"), false,
  "Escape-close never exposes the blocking Click to Play interstitial");
assert.ok(escapeArm.includes("silentPointerRecaptureRef.current = true"));
assert.ok(
  singlePlayerSource.includes("onResume={() => { setOptionsOpen(false); requestGameplayPointerLock(); }}"),
  "Back to Game recaptures directly from its click callback",
);
const initialPause = singlePlayerSource.slice(
  singlePlayerSource.indexOf("const initiallyPaused = singlePlayerGameplayPaused"),
  singlePlayerSource.indexOf("engine.start();"),
);
assert.ok(initialPause.includes("pointerCaptureNeeded"), "the initial Click to Play fallback freezes the engine and local fuses");
const ongoingPause = singlePlayerSource.slice(
  singlePlayerSource.indexOf("const paused = singlePlayerGameplayPaused", singlePlayerSource.indexOf("engine.start();")),
  singlePlayerSource.indexOf("if (deathScreenOpen) setOptionsOpen(false)"),
);
assert.ok(singlePlayerSource.includes("const worldModalOpen = containerOpen || sleepingBed !== null;"),
  "only simulation-blocking world modals feed the pause predicate");
assert.ok(singlePlayerSource.includes("const uiModalOpen = worldModalOpen || commandOpen;"),
  "chat remains a UI/input blocker without freezing the simulation");
assert.ok(ongoingPause.includes("pointerCaptureNeeded"), "denied capture remains an ongoing engine and fuse pause input");
assert.ok(
  ongoingPause.includes("[pauseOpen, inventoryOpen, worldModalOpen, deathScreenOpen, commandOpen, pointerCaptureNeeded]"),
  "successful capture reruns the ongoing pause effect immediately",
);
assert.match(singlePlayerSource, /setPointerCaptureNeeded\([\s\S]{0,160}!pointerSessionRef\.current\.pauseOpen,[\s\S]{0,20}\);/,
  "the lock-loss callback cannot overwrite capture-needed after opening Game Menu");
const survivalSample = singlePlayerSource.slice(
  singlePlayerSource.indexOf("const sample = () =>"),
  singlePlayerSource.indexOf("const onVisibilityChange"),
);
assert.ok(
  survivalSample.includes("const active = !singlePlayerGameplayPaused({")
    && survivalSample.includes("pointerCaptureNeeded")
    && survivalSample.includes("sampleSaveCadence(saveCadenceRef.current, now, active)"),
  "Click to Play fallback cannot advance survival or the active autosave cadence",
);

console.log("single-player pointer-lock ordering and input-release tests passed");
