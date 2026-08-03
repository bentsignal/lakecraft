import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  COMMAND_ESCAPE_LOCK_LOSS_SUPPRESS_MS,
  POINTER_LOCK_ESCAPE_DEDUP_MS,
  beginSinglePlayerPointerLockAttempt,
  createSinglePlayerPointerSessionState,
  orchestrateSinglePlayerInventoryClose,
  releaseBlockedSinglePlayerPointerLockGrant,
  singlePlayerInventoryCloseUsesTrustedRecapture,
  singlePlayerSilentRecaptureKey,
  transitionSinglePlayerPointerSession,
  type SinglePlayerPointerSessionEvent,
  type SinglePlayerPointerSessionState,
} from "../client/singleplayer/sessionState.ts";
import { requestPointerLockForTarget } from "../client/game/voxelEngine.ts";

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

let settleTrustedRequest: ((locked: boolean) => void) | undefined;
let pauseVisible = true;
let pointerCaptureNeeded = true;
const trustedRequestTrace: string[] = [];
beginSinglePlayerPointerLockAttempt(
  () => {
    trustedRequestTrace.push("request");
    return new Promise<boolean>((resolve) => { settleTrustedRequest = resolve; });
  },
  () => {
    trustedRequestTrace.push("resume");
    pauseVisible = false;
    pointerCaptureNeeded = false;
  },
  (locked) => { pointerCaptureNeeded = !locked; },
);
assert.deepEqual(trustedRequestTrace, ["request", "resume"],
  "Back to Game requests Pointer Lock before replacing the trusted-click UI");
assert.equal(pauseVisible, false);
assert.equal(pointerCaptureNeeded, false, "an in-flight trusted request never flashes Click to Play");
settleTrustedRequest?.(true);
await Promise.resolve();
assert.equal(pointerCaptureNeeded, false, "a successful trusted request resumes without Click to Play");

let rejectTrustedRequest: ((locked: boolean) => void) | undefined;
beginSinglePlayerPointerLockAttempt(
  () => new Promise<boolean>((resolve) => { rejectTrustedRequest = resolve; }),
  () => { pointerCaptureNeeded = false; },
  (locked) => { pointerCaptureNeeded = !locked; },
);
rejectTrustedRequest?.(false);
await Promise.resolve();
assert.equal(pointerCaptureNeeded, true, "a genuine denial exposes the recoverable Click to Play fallback");

for (const supersession of ["pause", "ui"] as const) {
  let lateGrantReleased = false;
  const released = releaseBlockedSinglePlayerPointerLockGrant(
    true,
    supersession === "ui",
    supersession === "pause",
    true,
    () => { lateGrantReleased = true; },
  );
  assert.equal(released, true, `${supersession} supersession rejects the delayed browser grant`);
  assert.equal(lateGrantReleased, true, `${supersession} supersession immediately releases delayed capture`);

  let resolveDelayedGrant: ((locked: boolean) => void) | undefined;
  let requestGeneration = 1;
  const attemptGeneration = requestGeneration;
  let delayedReleaseCount = 0;
  let currentPauseOpen = false;
  let currentUiBlocked = false;
  beginSinglePlayerPointerLockAttempt(
    () => new Promise<boolean>((resolve) => { resolveDelayedGrant = resolve; }),
    () => { pointerCaptureNeeded = false; },
    (locked) => {
      if (attemptGeneration !== requestGeneration) {
        releaseBlockedSinglePlayerPointerLockGrant(
          locked,
          currentUiBlocked,
          currentPauseOpen,
          true,
          () => { delayedReleaseCount += 1; },
        );
      }
    },
  );
  requestGeneration += 1;
  currentPauseOpen = supersession === "pause";
  currentUiBlocked = supersession === "ui";
  resolveDelayedGrant?.(true);
  await Promise.resolve();
  assert.equal(delayedReleaseCount, 1, `${supersession} releases a promise grant delivered after supersession`);
  assert.equal(currentPauseOpen, supersession === "pause", `${supersession} delayed grant preserves pause state`);
  assert.equal(currentUiBlocked, supersession === "ui", `${supersession} delayed grant preserves UI state`);
}
assert.equal(
  releaseBlockedSinglePlayerPointerLockGrant(true, false, false, true, () => assert.fail("active grant released")),
  false,
  "the original one-click grant remains captured while gameplay is active",
);

type PointerListener = () => void;
const pointerListeners = new Map<string, Set<PointerListener>>();
let pointerElement: unknown = null;
let pointerRequestCount = 0;
let fallback: (() => void) | undefined;
const pointerDocument = {
  get pointerLockElement() { return pointerElement; },
  addEventListener(type: string, listener: PointerListener) {
    const listeners = pointerListeners.get(type) ?? new Set<PointerListener>();
    listeners.add(listener);
    pointerListeners.set(type, listeners);
  },
  removeEventListener(type: string, listener: PointerListener) {
    pointerListeners.get(type)?.delete(listener);
  },
};
const pointerWindow = {
  setTimeout(callback: () => void) { fallback = callback; return 1; },
  clearTimeout() { fallback = undefined; },
};
const pointerTarget = { requestPointerLock() { pointerRequestCount += 1; } };
let lifecycleSettled = false;
const lifecycleRequest = requestPointerLockForTarget(pointerTarget, pointerDocument, pointerWindow)
  .then((locked) => { lifecycleSettled = true; return locked; });
assert.equal(pointerRequestCount, 1);
for (const listener of pointerListeners.get("pointerlockchange") ?? []) listener();
await Promise.resolve();
assert.equal(lifecycleSettled, false, "the trailing Escape unlock cannot reject a newer request");
pointerElement = pointerTarget;
for (const listener of pointerListeners.get("pointerlockchange") ?? []) listener();
assert.equal(await lifecycleRequest, true, "the later target lock settles the same request successfully");

pointerElement = null;
const denialRequest = requestPointerLockForTarget(pointerTarget, pointerDocument, pointerWindow);
for (const listener of pointerListeners.get("pointerlockerror") ?? []) listener();
assert.equal(await denialRequest, false, "pointerlockerror still provides an explicit recoverable denial");
assert.equal(fallback, undefined, "settled attempts always remove their denial timer");

pointerElement = null;
let mounted = true;
let unmountReleaseCount = 0;
const unmountRequest = requestPointerLockForTarget(
  pointerTarget,
  pointerDocument,
  pointerWindow,
  250,
  () => mounted,
  () => {
    unmountReleaseCount += 1;
    pointerElement = null;
  },
);
mounted = false;
pointerElement = pointerTarget;
for (const listener of pointerListeners.get("pointerlockchange") ?? []) listener();
assert.equal(await unmountRequest, false, "a delayed grant after engine teardown is rejected");
assert.equal(unmountReleaseCount, 1, "engine teardown releases a late native Pointer Lock grant");

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

assert.equal(singlePlayerInventoryCloseUsesTrustedRecapture("KeyE"), true,
  "E is an ordinary trusted activation and closes inventory with an immediate capture request");
assert.equal(singlePlayerInventoryCloseUsesTrustedRecapture(undefined), true,
  "the inventory Done button closes with an immediate trusted capture request");
assert.equal(singlePlayerInventoryCloseUsesTrustedRecapture("Escape"), false,
  "Escape is the browser's reserved unlock gesture and must defer recapture");

for (const closeGesture of ["KeyE", undefined] as const) {
  let uiBlocked = true;
  let inventoryVisible = true;
  let fastGrantReleased = false;
  let settled: boolean | undefined;
  const trace: string[] = [];
  const path = orchestrateSinglePlayerInventoryClose(
    closeGesture,
    () => {
      trace.push("prepare");
      uiBlocked = false;
    },
    (onStarted) => beginSinglePlayerPointerLockAttempt(
      () => {
        trace.push("request");
        // Model a pointerlockchange delivered synchronously by the browser,
        // before Preact can remove the inventory from the DOM.
        fastGrantReleased = releaseBlockedSinglePlayerPointerLockGrant(
          true,
          uiBlocked,
          false,
          true,
          () => { trace.push("release"); },
        );
        trace.push("fast-grant");
        return true;
      },
      onStarted,
      (locked) => { settled = locked; },
    ),
    () => {
      trace.push("close");
      inventoryVisible = false;
    },
    () => assert.fail("E/Done must not arm deferred Escape recovery"),
  );
  assert.equal(path, "trusted");
  assert.deepEqual(trace, ["prepare", "request", "fast-grant", "close"],
    `${closeGesture ?? "Done"} prepares the gate and requests capture before closing inventory`);
  assert.equal(fastGrantReleased, false, `${closeGesture ?? "Done"} accepts a fast valid grant`);
  assert.equal(inventoryVisible, false);
  await Promise.resolve();
  assert.equal(settled, true, `${closeGesture ?? "Done"} settles the immediate grant`);
}

let resolveInventoryDenial: ((locked: boolean) => void) | undefined;
let denialInventoryVisible = true;
let denialCaptureNeeded = false;
orchestrateSinglePlayerInventoryClose(
  "KeyE",
  () => undefined,
  (onStarted) => beginSinglePlayerPointerLockAttempt(
    () => new Promise<boolean>((resolve) => { resolveInventoryDenial = resolve; }),
    onStarted,
    (locked) => { denialCaptureNeeded = !locked; },
  ),
  () => { denialInventoryVisible = false; },
  () => assert.fail("E must not arm Escape recovery"),
);
assert.equal(denialInventoryVisible, false, "inventory closes while the E request is pending");
assert.equal(denialCaptureNeeded, false, "pending E request does not flash the fallback");
resolveInventoryDenial?.(false);
await Promise.resolve();
assert.equal(denialCaptureNeeded, true, "a genuine E denial exposes the recoverable fallback");

for (const supersession of ["ui", "pause"] as const) {
  let generation = 1;
  let resolveInventoryGrant: ((locked: boolean) => void) | undefined;
  let uiBlocked = false;
  let pauseOpen = false;
  let releaseCount = 0;
  orchestrateSinglePlayerInventoryClose(
    "KeyE",
    () => { uiBlocked = false; },
    (onStarted) => {
      const requestGeneration = generation;
      beginSinglePlayerPointerLockAttempt(
        () => new Promise<boolean>((resolve) => { resolveInventoryGrant = resolve; }),
        onStarted,
        (locked) => {
          if (requestGeneration !== generation) {
            releaseBlockedSinglePlayerPointerLockGrant(
              locked,
              uiBlocked,
              pauseOpen,
              true,
              () => { releaseCount += 1; },
            );
          }
        },
      );
    },
    () => undefined,
    () => assert.fail("E must not arm Escape recovery"),
  );
  generation += 1;
  uiBlocked = supersession === "ui";
  pauseOpen = supersession === "pause";
  resolveInventoryGrant?.(true);
  await Promise.resolve();
  assert.equal(releaseCount, 1, `${supersession} supersession releases the delayed inventory grant`);
}

const escapeTrace: string[] = [];
const escapePath = orchestrateSinglePlayerInventoryClose(
  "Escape",
  () => assert.fail("Escape cannot prepare a trusted recapture"),
  () => assert.fail("Escape cannot request immediate Pointer Lock"),
  () => { escapeTrace.push("close"); },
  () => { escapeTrace.push("arm"); },
);
assert.equal(escapePath, "deferred_escape");
assert.deepEqual(escapeTrace, ["close", "arm"], "Escape closes before arming silent movement recapture");

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
const inventoryClose = singlePlayerSource.slice(
  singlePlayerSource.indexOf("function closeInventoryAndResume"),
  singlePlayerSource.indexOf("function warnWorldEditCapacity"),
);
assert.ok(inventoryClose.includes("orchestrateSinglePlayerInventoryClose("),
  "production inventory close uses the executable gesture orchestrator");
assert.ok(inventoryClose.includes("armGameplayResumeAfterEscape(performance.now())"),
  "inventory Escape shares the no-overlay silent recapture state machine");
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
assert.match(singlePlayerSource, /if \(transition\.openPause\) \{\s+supersedePointerLockRequest\(\);/,
  "opening Game Menu invalidates an in-flight trusted request");
assert.match(singlePlayerSource, /function releasePointerLockForUi[\s\S]{0,300}supersedePointerLockRequest\(\);/,
  "inventory, chat, container, sleep, and death UI invalidate in-flight requests");
assert.match(singlePlayerSource, /return \(\) => \{\s+pointerSessionMountedRef\.current = false;\s+supersedePointerLockRequest\(\);/,
  "unmount invalidates the app-level pointer request before destroying the engine");
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
