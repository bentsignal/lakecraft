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
assert.ok(dialog.includes('aria-label="Field of view"') && dialog.includes('min="30"') && dialog.includes('max="110"'),
  "the shared Options screen exposes the full accessible FOV range");
assert.ok(dialog.includes('aria-label="Render distance"') && dialog.includes("RENDER_DISTANCE_MIN"),
  "the shared Options screen exposes the accessible render-distance slider");
assert.ok(dialog.includes("HUD Size:") && dialog.includes('hudSize === "small" ? "medium"')
  && dialog.includes('hudSize === "medium" ? "large" : "small"'),
  "Video Options cycles the shared small, medium, and large HUD setting in ascending order");
assert.ok(dialog.includes("RENDER_DISTANCE_MAX"), "the slider uses the shared tested chunk ceiling");
assert.ok(dialog.includes('["musicVolume", "Music", musicVolume]'), "Music & Sounds exposes a dedicated persistent ambient-music channel");
assert.ok(dialog.includes('event.key !== "Tab"') && dialog.includes("event.shiftKey"), "keyboard focus is trapped in either tab direction");
assert.ok(dialog.includes("returnFocusId") && pause.includes('id="lc-game-menu-options"')
  && lobby.includes('"lc-title-options"') && menuButton.includes("id={id}"),
  "closing Options restores its originating control");

assert.ok(engineTypes.includes("getMouseLookSensitivity?: () => number"), "the engine exposes a local live sensitivity seam");
assert.ok(engineTypes.includes("getFieldOfViewRadians?: () => number"), "the engine exposes a live FOV seam");
assert.ok(engine.includes("options.getMouseLookSensitivity?.()"), "pointer movement samples the current sensitivity without recreating the engine");
assert.ok(engine.includes("options.getFieldOfViewRadians?.()"), "camera posture samples the current FOV without recreating the engine");
const presentation = readFileSync(new URL("../client/gameplay/presentation.ts", import.meta.url), "utf8");
assert.ok(presentation.includes("mouseLookScale(context.getSettings().mouseSensitivity)"), "both modes read sensitivity through the shared live context");
assert.ok(presentation.includes("fieldOfViewRadians(context.getSettings().fovDegrees)"), "both modes read FOV through the shared live context");
assert.ok(app.includes("getSettings: () => clientSettingsRef.current"));
assert.ok(singlePlayer.includes("getSettings: () => clientSettingsRef.current"));
assert.ok(lobby.includes("settings={props.settings}") && lobby.includes("onSettingsChange={props.onSettingsChange}")
  && hud.includes("settings={settings}") && hud.includes("onSettingsChange={onSettingsChange}")
  && app.includes("settings={clientSettings}") && singlePlayer.includes("settings={clientSettings}"),
"title, single-player, and multiplayer all pass the complete persisted settings object through shared Options");
assert.ok(singlePlayer.includes("engineRef.current?.setRenderDistance(next.renderDistance)"), "single-player reconciles a changed render radius immediately");
assert.ok(app.includes("streamingChunkRadius: clientSettingsRef.current.renderDistance")
  && app.includes("engineRef.current?.setRenderDistance(next.renderDistance)"),
"multiplayer initializes and reconciles the same client-selected terrain radius");
assert.ok(singlePlayer.includes("audioRef.current = audio"), "single-player retains its audio surface for immediate mute updates");

for (const localOnly of [settings, dialog]) {
  assert.doesNotMatch(localOnly, /from\s+["']lakebed\//, "Options implementation cannot import Lakebed");
  assert.doesNotMatch(localOnly, /\bfetch\s*\(/, "Options implementation cannot generate HTTP traffic");
}

console.log("shared title, single-player, and multiplayer Options integration tests passed");
