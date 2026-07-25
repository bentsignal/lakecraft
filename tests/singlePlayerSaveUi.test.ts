import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path: string): string => readFileSync(new URL(path, import.meta.url), "utf8");
const pauseMenu = source("../client/components/PauseMenu.tsx");
const gameHud = source("../client/components/GameHud.tsx");
const styles = source("../client/components/HudStyles.tsx");
const singlePlayer = source("../client/singleplayer/SinglePlayerApp.tsx");

for (const prop of [
  "onSave?: () => void",
  "saveStatusText?: string",
  "lastSavedText?: string",
  "saveDisabled?: boolean",
  "saveInProgress?: boolean",
  "disconnectLabel?: string",
]) {
  assert.ok(pauseMenu.includes(prop), `PauseMenu exposes the optional ${prop} seam`);
  assert.ok(gameHud.includes(prop), `GameHud forwards the optional ${prop} seam`);
}
assert.ok(pauseMenu.includes('title?: string'), "PauseMenu title can describe a single-player pause screen");
assert.ok(gameHud.includes('pauseTitle?: string'), "GameHud exposes a pause-specific title without changing other HUD labels");

assert.ok(pauseMenu.includes('title = "Game Menu"'), "multiplayer retains the existing Game Menu title by default");
assert.ok(pauseMenu.includes('disconnectLabel = "Disconnect"'), "multiplayer retains the existing Disconnect action by default");
assert.ok(pauseMenu.includes('const showSaveControls = Boolean(onSave || saveStatusText || lastSavedText)'), "save UI stays absent when multiplayer omits save props");
assert.ok(pauseMenu.includes('saveInProgress ? "Saving…" : "Save World"'), "the manual action has clear idle and saving labels");
assert.ok(pauseMenu.includes('disabled={!onSave || saveDisabled || saveInProgress}'), "manual save is guarded while unavailable, disabled, or active");

assert.ok(pauseMenu.includes('role="status"'), "save feedback has an accessible status role");
assert.ok(pauseMenu.includes('aria-live="polite"'), "save feedback is announced without interrupting gameplay");
assert.ok(pauseMenu.includes('aria-atomic="true"'), "saving and last-saved feedback is announced together");
assert.ok(pauseMenu.includes('aria-describedby="lc-game-menu-save-status"'), "the manual save action references its feedback");
assert.ok(pauseMenu.includes('aria-busy={saveInProgress || undefined}'), "the pause dialog exposes in-progress state");

assert.ok(styles.includes('.lc-game-menu__save { display: grid'), "save controls follow the existing bounded menu layout");
assert.ok(styles.includes('min-height: 16px'), "status feedback reserves space instead of shifting the overlay");
assert.ok(styles.includes('.lc-game-menu__last-saved { color: #aaa; }'), "secondary timestamp text stays visually subordinate");
assert.ok(styles.includes('overflow-y: auto'), "the taller pause menu remains reachable on short viewports");

assert.ok(singlePlayer.includes("loadSinglePlayerSave(localStorage"), "the journal is loaded before local engine state is created");
assert.ok(singlePlayer.includes("saveSinglePlayerSnapshot(localStorage"), "manual, autosave, and exit saves share the verified journal writer");
assert.ok(singlePlayer.includes("engine.importRuntimeSnapshot(initialRuntimeRef.current)"), "pose, health, time, and mobs resume through the strict engine importer");
assert.ok(singlePlayer.includes("runtime: engineRef.current?.exportRuntimeSnapshot()"), "each committed snapshot captures current engine-owned state");
assert.ok(singlePlayer.includes("sampleSaveCadence"), "autosaves use active-play cadence instead of a wall-clock write loop");
assert.ok(singlePlayer.includes('performSaveRef.current("autosave")'), "a due cadence sample executes one autosave");
assert.ok(singlePlayer.includes("engineRef.current?.setPaused(paused)"), "menus and backgrounding pause the local engine");
assert.ok(singlePlayer.includes("setLocalFusesPausedRef.current(paused)"), "the same pause boundary freezes local TNT fuses");
assert.ok(singlePlayer.includes("timer.remainingMs = Math.max(0"), "paused TNT retains bounded remaining fuse time");
assert.ok(singlePlayer.includes('window.addEventListener("pagehide", saveBeforeLeaving)'), "page exit gets a final synchronous save attempt");
assert.ok(singlePlayer.includes("return finish(createDefaultSinglePlayerSnapshot(7_319, now), load, true)"), "corrupt or future data is protected from permissive overwrite");
assert.equal(singlePlayer.includes('localStorage.setItem("lakecraft.singleplayer.v1"'), false, "the old unverified one-key writer is gone");

console.log("single-player save UI source tests passed");
