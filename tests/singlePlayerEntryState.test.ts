import assert from "node:assert/strict";
import {
  SINGLE_PLAYER_INITIAL_PAUSE_OPEN,
  singlePlayerGameplayPaused,
  type SinglePlayerPauseState,
} from "../client/singleplayer/sessionState.ts";

const activeEntry: SinglePlayerPauseState = {
  pauseOpen: SINGLE_PLAYER_INITIAL_PAUSE_OPEN,
  inventoryOpen: false,
  worldModalOpen: false,
  deathScreenOpen: false,
  pointerCaptureNeeded: false,
  documentVisible: true,
};
assert.equal(SINGLE_PLAYER_INITIAL_PAUSE_OPEN, false, "single-player never initializes behind the escape menu");
assert.equal(singlePlayerGameplayPaused(activeEntry), false, "successful pointer capture activates a visible living world");
for (const blocker of ["pauseOpen", "inventoryOpen", "worldModalOpen", "deathScreenOpen", "pointerCaptureNeeded"] as const) {
  assert.equal(singlePlayerGameplayPaused({ ...activeEntry, [blocker]: true }), true, `${blocker} explicitly pauses gameplay`);
}
const deniedCapture = { ...activeEntry, pointerCaptureNeeded: true };
assert.equal(singlePlayerGameplayPaused(deniedCapture), true, "denied or missing pointer lock freezes simulation behind Click to Play");
assert.equal(
  singlePlayerGameplayPaused({ ...deniedCapture, pointerCaptureNeeded: false }),
  false,
  "successful capture immediately restores active gameplay",
);
assert.equal(singlePlayerGameplayPaused({ ...activeEntry, documentVisible: false }), true, "a hidden tab starts safely paused");
assert.equal(singlePlayerGameplayPaused(activeEntry), false, "clearing every modal returns to pointer-ready gameplay");

console.log("single-player deterministic entry pause-state tests passed");
