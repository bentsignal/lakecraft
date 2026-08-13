import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gameScreenshotFilename } from "../client/gameplayScreenshot.ts";

assert.equal(
  gameScreenshotFilename(Date.UTC(2026, 7, 7, 14, 5, 9)),
  "lakecraft-2026-08-07_14-05-09.png",
  "screenshots receive a sortable filesystem-safe timestamp",
);

const helper = readFileSync(new URL("../client/gameplayDiagnostics.tsx", import.meta.url), "utf8")
  + readFileSync(new URL("../client/gameplayScreenshot.ts", import.meta.url), "utf8");
const app = readFileSync(new URL("../client/singleplayer/SinglePlayerApp.tsx", import.meta.url), "utf8");
const multiplayer = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");
const engine = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");

assert.match(helper, /event\.code !== "F2"[\s\S]{0,300}engine\.captureScreenshot\(\)[\s\S]{0,160}copyGameScreenshot\(png\)/,
  "shared F2 handling starts capture and clipboard delivery without an intervening await");
assert.ok(app.includes("handleGameplayScreenshotKey") && multiplayer.includes("handleGameplayScreenshotKey"),
  "single-player and multiplayer use the same screenshot controller");
assert.match(helper, /new ClipboardItem\(\{ "image\/png": png \}\)/,
  "the clipboard receives the next-frame PNG promise from the original key gesture");
assert.match(helper, /link\.download = filename[\s\S]{0,100}link\.click\(\)/,
  "every screenshot also has a reliable Downloads fallback");
assert.match(engine, /if \(pendingScreenshot\)[\s\S]{0,260}canvas\.toBlob/,
  "capture runs immediately after a complete retained WebGL render");
assert.ok(app.indexOf("handleGameplayScreenshotKey") < app.indexOf("consumeSinglePlayerCommandSurfaceEscape("),
  "screenshot handling remains available before command and gameplay key routing");

console.log("pointer-lock-safe F2 screenshot workflow tests passed");
