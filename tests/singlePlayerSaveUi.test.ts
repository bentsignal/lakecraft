import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path: string): string => readFileSync(new URL(path, import.meta.url), "utf8");
const pauseMenu = source("../client/components/PauseMenu.tsx");
const gameHud = source("../client/components/GameHud.tsx");
const styles = source("../client/components/HudStyles.tsx");
const singlePlayer = source("../client/singleplayer/SinglePlayerApp.tsx");

for (const prop of [
  "autosaveStatusText?: string",
  "lastAutosavedText?: string",
  "disconnectDisabled?: boolean",
  "onResetWorld?: () => void",
  "disconnectLabel?: string",
]) {
  assert.ok(pauseMenu.includes(prop), `PauseMenu exposes the optional ${prop} seam`);
  assert.ok(gameHud.includes(prop), `GameHud forwards the optional ${prop} seam`);
}
assert.ok(pauseMenu.includes('title?: string'), "PauseMenu title can describe a single-player pause screen");
assert.ok(gameHud.includes('pauseTitle?: string'), "GameHud exposes a pause-specific title without changing other HUD labels");

assert.ok(pauseMenu.includes('title = "Game Menu"'), "multiplayer retains the existing Game Menu title by default");
assert.ok(pauseMenu.includes('disconnectLabel = "Disconnect"'), "multiplayer retains the existing Disconnect action by default");
assert.ok(pauseMenu.includes('const showAutosaveStatus = Boolean(autosaveStatusText || lastAutosavedText)'),
  "autosave feedback stays absent when multiplayer omits local-world props");
assert.doesNotMatch(pauseMenu, /Save World|Saving…|onSave/, "the pause menu has no manual-save action or stale label");
assert.ok(pauseMenu.includes("disconnectDisabled && onResetWorld"), "recovery is only offered while unsafe storage has saving locked");
assert.ok(pauseMenu.includes("Reset Local World…"), "the destructive recovery action is explicit");

assert.ok(pauseMenu.includes('role="status"'), "save feedback has an accessible status role");
assert.ok(pauseMenu.includes('aria-live="polite"'), "save feedback is announced without interrupting gameplay");
assert.ok(pauseMenu.includes('aria-atomic="true"'), "saving and last-saved feedback is announced together");
assert.ok(pauseMenu.includes('aria-describedby={showAutosaveStatus ? "lc-game-menu-autosave-status" : undefined}'),
  "Save and Quit directly references its autosave timestamp and failure feedback");
assert.ok(pauseMenu.indexOf("Back to Game") < pauseMenu.indexOf("Options…")
  && pauseMenu.indexOf("Options…") < pauseMenu.indexOf("{disconnectLabel}")
  && pauseMenu.indexOf("{disconnectLabel}") < pauseMenu.indexOf("lastAutosavedText ?"),
  "Back, Options, and Save and Quit stay together with the timestamp immediately after them");

assert.equal(styles.includes(".lc-game-menu__save"), false, "the separated manual-save block is removed");
assert.ok(styles.includes('min-height: 16px'), "status feedback reserves space instead of shifting the overlay");
assert.ok(styles.includes('.lc-game-menu__last-autosaved { color: #aaa; }'), "secondary timestamp text stays visually subordinate");
assert.equal(styles.includes(".lc-game-menu__disconnect { margin-top"), false, "Save and Quit has no separated top spacing");
assert.ok(styles.includes('overflow-y: auto'), "the taller pause menu remains reachable on short viewports");

assert.ok(singlePlayer.includes("loadSinglePlayerSave(storage"), "the journal is loaded before local engine state is created");
assert.ok(singlePlayer.includes("saveSinglePlayerSnapshot(storage"), "autosave and exit saves share the verified journal writer");
assert.ok(singlePlayer.includes("engine.importRuntimeSnapshot(initialRuntimeRef.current)"), "pose, health, time, and mobs resume through the strict engine importer");
assert.ok(singlePlayer.includes("runtime: engineRef.current?.exportRuntimeSnapshot()"), "each committed snapshot captures current engine-owned state");
assert.ok(singlePlayer.includes("sampleSaveCadence"), "autosaves use active-play cadence instead of a wall-clock write loop");
assert.ok(singlePlayer.includes('if (active && next.autosaveDue) performSaveRef.current("autosave")'),
  "a due autosave is never invoked while pause, death, inventory, or background makes play inactive");
assert.ok(singlePlayer.includes("useState<number | null>(null)"),
  "creation and loaded journal saves do not masquerade as periodic autosaves");
assert.ok(singlePlayer.includes('if (reason === "autosave") setLastAutosavedAt(now)'),
  "only a successful periodic autosave advances the displayed autosave timestamp");
assert.match(singlePlayer, /const returnToTitle = \(\) => \{\s+if \(!persist\("quit"\)\) return;\s+quitSavedRef\.current = true;[\s\S]*?onExit\(\);/,
  "Save and Quit cannot navigate until the synchronous verified journal commit succeeds");
assert.ok(singlePlayer.includes('disconnectDisabled={saveLockedRef.current}'),
  "Save and Quit is disabled when the app cannot truthfully finalize a save");
assert.ok(singlePlayer.includes("Last autosaved "), "the pause timestamp uses autosave-only language");
assert.doesNotMatch(singlePlayer, /persist\("manual"\)|"manual" \|/, "single-player exposes no manual-save code path");
assert.ok(singlePlayer.includes("engineRef.current?.setPaused(paused)"), "menus and backgrounding pause the local engine");
assert.ok(singlePlayer.includes("setLocalFusesPausedRef.current(paused)"), "the same pause boundary freezes local TNT fuses");
assert.ok(singlePlayer.includes("timer.remainingMs = Math.max(0"), "paused TNT retains bounded remaining fuse time");
assert.ok(singlePlayer.includes('window.addEventListener("pagehide", saveBeforeLeaving)'), "page exit gets a final synchronous save attempt");
assert.ok(singlePlayer.includes("createDefaultSinglePlayerSnapshot(world.seed, world.createdAt, world.id)"),
  "corrupt or future data falls back only to the selected world's immutable creation metadata");
assert.ok(singlePlayer.includes("snapshot.world.gameMode = world.initialGameMode"),
  "a locked fallback retains the selected world's explicit initial mode");
assert.ok(singlePlayer.includes("migrateLegacy: false, worldId: world.id"),
  "ordinary world loading is namespaced and never performs a silent legacy migration");
assert.ok(singlePlayer.includes("window.confirm("), "destructive world recovery requires explicit confirmation");
assert.ok(singlePlayer.includes("resetSinglePlayerSave(storage, { worldId: world.id })"),
  "confirmed recovery uses the verified journal reset helper for only the active world");
assert.ok(singlePlayer.includes('console.error("[Lakecraft save] Snapshot commit rejected."'), "exact save diagnostics remain available to developers");
assert.ok(singlePlayer.includes("result.mutationStarted"), "reset feedback distinguishes unchanged preflight failures from partial resets");
assert.ok(singlePlayer.includes("Your saved world data was left unchanged."), "failed preflight never falsely implies destructive recovery");
assert.equal(singlePlayer.includes('localStorage.setItem("lakecraft.singleplayer.v1"'), false, "the old unverified one-key writer is gone");

console.log("single-player save UI source tests passed");
