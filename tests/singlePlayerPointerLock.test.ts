import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  POINTER_LOCK_ESCAPE_DEDUP_MS,
  createSinglePlayerPointerSessionState,
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
assert.ok(
  entryHandler.indexOf("document.documentElement.requestPointerLock()")
    < entryHandler.indexOf("setSinglePlayer(true)"),
  "Singleplayer uses the originating click before mounting the world",
);
assert.equal(entryHandler.includes("window.location.search ="), false, "entry no longer discards user activation through navigation");

const singlePlayerSource = readFileSync(new URL("../client/singleplayer/SinglePlayerApp.tsx", import.meta.url), "utf8");
assert.ok(singlePlayerSource.includes("Click to Play"), "failed handoff has one explicit pointer-capture affordance");
assert.ok(
  singlePlayerSource.includes("onResume={() => { setOptionsOpen(false); requestGameplayPointerLock(); }}"),
  "Back to Game recaptures directly from its click callback",
);

console.log("single-player pointer-lock ordering and input-release tests passed");
