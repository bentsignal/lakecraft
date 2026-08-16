import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const surface = source("../client/gameplay/GameplaySessionSurface.tsx");
const multiplayer = source("../client/index.tsx");
const singleplayer = source("../client/singleplayer/SinglePlayerApp.tsx");
const pointer = source("../client/gameplay/pointerSession.ts");

for (const [name, value] of [
  ["shared gameplay surface", surface],
  ["multiplayer session", multiplayer],
  ["single-player session", singleplayer],
  ["pointer-session state machine", pointer],
] as const) {
  assert.doesNotMatch(value, /Click to Play|Capture the mouse|pointerCaptureNeeded|showCaptureAffordance/,
    `${name} cannot contain or trigger the retired pointer-capture interstitial`);
}

const reveal = multiplayer.slice(
  multiplayer.indexOf("const revealWorldPresentation = () =>"),
  multiplayer.indexOf("revealWorldPresentationRef.current = revealWorldPresentation"),
);
assert.match(reveal, /waitForWorldPresentation\(\)/,
  "chunk completion still waits for the authoritative mesh presentation gate");
assert.doesNotMatch(reveal, /setPointer|pointerCapture|else\s*\{/,
  "later chunk-ready callbacks cannot mutate pointer UI or enter a fallback branch");
assert.match(reveal, /pointerLockElement === document\.documentElement/,
  "the one-time entry handoff remains narrowly scoped to the document lock");

console.log("pointer-capture overlay removal tests passed");
