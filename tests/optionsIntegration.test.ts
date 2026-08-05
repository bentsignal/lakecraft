import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path: string): string => readFileSync(new URL(path, import.meta.url), "utf8");
const app = source("../client/index.tsx");
const singlePlayer = source("../client/singleplayer/SinglePlayerApp.tsx");
const engine = source("../client/game/voxelEngine.ts");
const engineTypes = source("../client/game/types.ts");
const hud = source("../client/components/GameHud.tsx");
const pause = source("../client/components/PauseMenu.tsx");
const dialog = source("../client/components/OptionsDialog.tsx");
const lobby = source("../client/lobby/LobbyScreen.tsx");
const menuButton = source("../client/lobby/menuButton.tsx");
const settings = source("../client/settings.ts");

assert.ok(lobby.includes("<OptionsDialog") && hud.includes("<OptionsDialog"), "title and Game Menu share one Options component");
assert.equal(lobby.includes("onOpenSettings"), false, "title Options is not an inert callback prop");
assert.equal(lobby.includes(">About<"), false, "the dead title About action cannot accept clicks");
assert.equal(app.includes("Controls and graphics settings are coming next"), false, "multiplayer has no placeholder Options toast");
assert.equal(singlePlayer.includes("More single-player settings are next"), false, "single-player has no placeholder Options toast");

assert.ok(hud.includes("open={pauseOpen && !optionsOpen && !deathScreenOpen}"), "Options replaces rather than overlaps the Game Menu dialog");
assert.ok(hud.includes("open={optionsOpen && pauseOpen && !deathScreenOpen}"), "Options preserves the paused world boundary");
assert.equal(pause.includes("Sound:"), false, "sound belongs to Options rather than a duplicate pause action");

const multiplayerKeys = app.slice(app.indexOf("const onKey = (event: KeyboardEvent)"), app.indexOf("const onKeyUp", app.indexOf("const onKey = (event: KeyboardEvent)")));
assert.ok(multiplayerKeys.indexOf("if (optionsOpen)") < multiplayerKeys.indexOf("if (pauseOpen)"), "multiplayer Options owns Escape before Game Menu resume");
const singlePlayerKeys = singlePlayer.slice(singlePlayer.indexOf("const onKeyDown = (event: KeyboardEvent)"), singlePlayer.indexOf("window.addEventListener", singlePlayer.indexOf("const onKeyDown = (event: KeyboardEvent)")));
assert.ok(singlePlayerKeys.indexOf("if (optionsOpen)") < singlePlayerKeys.indexOf("if (pointerSessionRef.current.pauseOpen)"), "single-player Options owns Escape before Game Menu resume");

assert.ok(dialog.includes('role="dialog"') && dialog.includes('aria-modal="true"'), "Options exposes modal dialog semantics");
assert.ok(dialog.includes('aria-label="Mouse sensitivity"') && dialog.includes("aria-valuetext"), "the sensitivity range has a stable accessible value");
assert.ok(dialog.includes('aria-label="Render distance"') && dialog.includes("renderDistance !== undefined"),
  "single-player can opt into a shared accessible render-distance slider without exposing it in multiplayer");
assert.ok(dialog.includes('max="12"'), "the single-player slider exposes the twelve-chunk playtest ceiling");
assert.ok(dialog.includes('event.key !== "Tab"') && dialog.includes("event.shiftKey"), "keyboard focus is trapped in either tab direction");
assert.ok(dialog.includes("returnFocusId") && pause.includes('id="lc-game-menu-options"')
  && lobby.includes('"lc-title-options"') && menuButton.includes("id={id}"),
  "closing Options restores its originating control");

assert.ok(engineTypes.includes("getMouseLookSensitivity?: () => number"), "the engine exposes a local live sensitivity seam");
assert.ok(engine.includes("options.getMouseLookSensitivity?.()"), "pointer movement samples the current sensitivity without recreating the engine");
assert.ok(app.includes("mouseLookScale(clientSettingsRef.current.mouseSensitivity)"), "multiplayer reads sensitivity from a live ref");
assert.ok(singlePlayer.includes("mouseLookScale(clientSettingsRef.current.mouseSensitivity)"), "single-player reads sensitivity from a live ref");
assert.ok(singlePlayer.includes("engineRef.current?.setRenderDistance(renderDistance)"), "single-player reconciles a changed render radius immediately");
assert.ok(singlePlayer.includes("audioRef.current = audio"), "single-player retains its audio surface for immediate mute updates");

for (const localOnly of [settings, dialog]) {
  assert.doesNotMatch(localOnly, /from\s+["']lakebed\//, "Options implementation cannot import Lakebed");
  assert.doesNotMatch(localOnly, /\bfetch\s*\(/, "Options implementation cannot generate HTTP traffic");
}

console.log("shared title, single-player, and multiplayer Options integration tests passed");
