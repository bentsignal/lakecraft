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
  documentVisible: true,
};
assert.equal(SINGLE_PLAYER_INITIAL_PAUSE_OPEN, false, "single-player never initializes behind the escape menu");
assert.equal(singlePlayerGameplayPaused(activeEntry), false, "a visible living join is active before the first engine frame");
for (const blocker of ["pauseOpen", "inventoryOpen", "worldModalOpen", "deathScreenOpen"] as const) {
  assert.equal(singlePlayerGameplayPaused({ ...activeEntry, [blocker]: true }), true, `${blocker} explicitly pauses gameplay`);
}
assert.equal(singlePlayerGameplayPaused({ ...activeEntry, documentVisible: false }), true, "a hidden tab starts safely paused");
assert.equal(singlePlayerGameplayPaused(activeEntry), false, "clearing every modal returns to pointer-ready gameplay");

console.log("single-player deterministic entry pause-state tests passed");
