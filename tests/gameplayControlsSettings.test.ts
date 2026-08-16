import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DEFAULT_GAMEPLAY_CONTROL_BINDINGS,
  GAMEPLAY_CONTROL_RESERVED_INPUT_NOTE,
  GAMEPLAY_CONTROL_ACTIONS,
  assignGameplayControlBinding,
  gameplayControlActionForCode,
  gameplayControlConflicts,
  normalizeGameplayControlBindings,
} from "../client/gameplay/controlBindings.ts";
import { DEFAULT_CLIENT_SETTINGS, normalizeClientSettings } from "../client/settings.ts";
import { gameAudioCategory } from "../client/game/audio.ts";

assert.equal(GAMEPLAY_CONTROL_ACTIONS.length, 28, "every shipped gameplay action has one remappable control");
assert.equal(gameplayControlActionForCode(DEFAULT_GAMEPLAY_CONTROL_BINDINGS, "F5"), "perspective");
assert.equal(gameplayControlActionForCode(DEFAULT_GAMEPLAY_CONTROL_BINDINGS, "F3"), "debug");
assert.equal(gameplayControlActionForCode(DEFAULT_GAMEPLAY_CONTROL_BINDINGS, "F1"), "toggleHud");
assert.equal(gameplayControlActionForCode(DEFAULT_GAMEPLAY_CONTROL_BINDINGS, "Tab"), "playerList");
assert.equal(gameplayControlActionForCode(DEFAULT_GAMEPLAY_CONTROL_BINDINGS, "Mouse0"), "attack");
assert.equal(gameplayControlActionForCode(DEFAULT_GAMEPLAY_CONTROL_BINDINGS, "Mouse2"), "use");

const reassigned = assignGameplayControlBinding(DEFAULT_GAMEPLAY_CONTROL_BINDINGS, "inventory", "KeyQ");
assert.equal(reassigned.inventory, "KeyQ");
assert.equal(reassigned.drop, "KeyE", "assigning an occupied key swaps its old owner instead of creating ambiguous input");
assert.equal(gameplayControlConflicts(reassigned).size, 0);
assert.equal(assignGameplayControlBinding(DEFAULT_GAMEPLAY_CONTROL_BINDINGS, "jump", "Mouse0").jump, "Space",
  "mouse buttons remain limited to the two actions the engine can dispatch from pointer events");
assert.deepEqual(normalizeGameplayControlBindings({ moveForward: "invalid", debug: "F4" }), {
  ...DEFAULT_GAMEPLAY_CONTROL_BINDINGS,
  debug: "F4",
});

const normalized = normalizeClientSettings({
  masterVolume: -50, musicVolume: 18.6, blocksVolume: 45.4, hostileVolume: 101, passiveVolume: Number.NaN,
  playersVolume: 0, uiVolume: 72, keyBindings: reassigned,
});
assert.deepEqual(
  [normalized.masterVolume, normalized.musicVolume, normalized.blocksVolume, normalized.hostileVolume, normalized.passiveVolume, normalized.playersVolume, normalized.uiVolume],
  [0, 19, 45, 100, 100, 0, 72],
  "the persistent mixer independently normalizes every meaningful category",
);
assert.equal(normalized.keyBindings.inventory, "KeyQ");
assert.equal(DEFAULT_CLIENT_SETTINGS.keyBindings.perspective, "F5");

assert.equal(gameAudioCategory("blockPlace"), "blocks");
assert.equal(gameAudioCategory("mobHurt", { mob: "cow" }), "passive");
assert.equal(gameAudioCategory("mobHurt", { mob: "zombie" }), "hostile");
assert.equal(gameAudioCategory("playerHurt"), "players");
assert.equal(gameAudioCategory("uiConfirm"), "ui");

const multiplayer = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");
const singleplayer = readFileSync(new URL("../client/singleplayer/SinglePlayerApp.tsx", import.meta.url), "utf8");
const engine = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");
const optionsDialog = readFileSync(new URL("../client/components/OptionsDialog.tsx", import.meta.url), "utf8");
for (const source of [multiplayer, singleplayer]) {
  assert.ok(source.includes("gameplayControlActionForCode(clientSettingsRef.current.keyBindings, event.code)"), "both authorities route UI controls through one persisted map");
  assert.ok(source.includes("setDebugOverlayVisible((visible) => !visible)"), "F3-style diagnostics are locally toggled");
  assert.ok(source.includes("visible: debugOverlayVisible"), "debug coordinates/FPS are hidden until toggled");
  assert.ok(source.includes("clientAudioLevels(clientSettingsRef.current)"), "both authorities initialize the same category mixer");
}
assert.ok(engine.includes('action === "perspective"'), "perspective cycling follows the configured binding");
assert.ok(!engine.includes('event.code === "KeyF" || action === "perspective"'), "remapping perspective removes the old hard-coded F binding");
assert.ok(engine.includes('controlHeld("moveForward")'), "movement is resolved from live remappable bindings");
assert.ok(engine.includes('bypassBlockInteractionForPlacement(\n        controlHeld("sneak")'), "interaction bypass follows the remapped Sneak action");
assert.ok(engine.includes('controlAction(`Mouse${event.button}`)'), "attack/use mouse buttons share the remapping layer");
assert.ok(multiplayer.includes("const globalGameplayShortcutAllowed = !optionsOpen && !pauseOpen && !chatOpen && !inventoryOpen"),
  "typing in chat, search, or options cannot trigger remapped global shortcuts");
assert.ok(optionsDialog.includes('captureAction !== "attack" && captureAction !== "use"'),
  "the controls UI only offers mouse buttons for actions handled by pointer events");
assert.ok(GAMEPLAY_CONTROL_RESERVED_INPUT_NOTE.includes("Mouse wheel always cycles the hotbar")
  && optionsDialog.includes("GAMEPLAY_CONTROL_RESERVED_INPUT_NOTE"),
"Options honestly documents wheel hotbar cycling and browser-reserved keys instead of exposing a nonfunctional remap");

console.log("persistent conflict-safe gameplay controls and category sound settings tests passed");
