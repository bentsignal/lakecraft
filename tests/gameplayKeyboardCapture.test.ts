import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GAMEPLAY_KEYBOARD_LOCK_CODES } from "../client/gameplayKeyboardCapture.ts";

assert.deepEqual(GAMEPLAY_KEYBOARD_LOCK_CODES, ["KeyW", "Escape"],
  "Keyboard Lock protects Ctrl+W and lets chat own Escape without leaving fullscreen");

const capture = readFileSync(new URL("../client/gameplayKeyboardCapture.ts", import.meta.url), "utf8");
const handoff = readFileSync(new URL("../client/pointerLockHandoff.ts", import.meta.url), "utf8");
const singlePlayer = readFileSync(new URL("../client/singleplayer/SinglePlayerApp.tsx", import.meta.url), "utf8");
const multiplayer = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");

assert.ok(capture.includes('root.requestFullscreen({ navigationUI: "hide" })'),
  "Ctrl+W protection enters the JavaScript fullscreen mode required by Keyboard Lock");
assert.ok(capture.indexOf("if (!keyboardLockController()) return false;") < capture.indexOf("root.requestFullscreen"),
  "browsers without Keyboard Lock stay windowed instead of entering a useless fullscreen mode");
assert.ok(capture.includes("keyboard.lock(GAMEPLAY_KEYBOARD_LOCK_CODES)"),
  "fullscreen capture requests the physical W key so Ctrl+W reaches the game");
assert.ok(capture.includes("document.fullscreenElement !== root") && capture.includes("document.exitFullscreen()"),
  "a denied key lock rolls back only the fullscreen session started for that request");
assert.ok(capture.includes(".catch(() => false)"),
  "unsupported or denied fullscreen/keyboard requests fail without blocking play");
assert.ok(handoff.indexOf("requestPointerLock()") < handoff.indexOf("requestGameplayKeyboardCapture()"),
  "the world Play gesture requests mouse capture before fullscreen consumes transient activation");
const resume = singlePlayer.slice(
  singlePlayer.indexOf("function requestGameplayPointerLock"),
  singlePlayer.indexOf("function armGameplayResumeAfterEscape"),
);
assert.ok(resume.indexOf("applyPointerSessionEvent") < resume.indexOf("requestGameplayKeyboardCapture()"),
  "Back to Game requests mouse capture before restoring fullscreen Ctrl+W protection");
assert.ok(singlePlayer.includes("releaseGameplayKeyboardCapture();"),
  "leaving the world releases the key lock and fullscreen session");
const multiplayerEntry = multiplayer.slice(multiplayer.indexOf("function enterWorld"), multiplayer.indexOf("useEffect", multiplayer.indexOf("function enterWorld")));
assert.ok(multiplayerEntry.includes("requestDocumentPointerLockHandoff()") && multiplayerEntry.includes("requestGameplayKeyboardCapture()"),
  "multiplayer uses the same entry gesture for mouse, fullscreen, Ctrl+W, and chat Escape capture");

console.log("lakecraft gameplay keyboard capture tests: ok");
