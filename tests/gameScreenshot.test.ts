import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gameScreenshotFilename } from "../client/singleplayer/gameScreenshot.ts";

assert.equal(
  gameScreenshotFilename(Date.UTC(2026, 7, 7, 14, 5, 9)),
  "lakecraft-2026-08-07_14-05-09.png",
  "screenshots receive a sortable filesystem-safe timestamp",
);

const helper = readFileSync(new URL("../client/singleplayer/gameScreenshot.ts", import.meta.url), "utf8");
const app = readFileSync(new URL("../client/singleplayer/SinglePlayerApp.tsx", import.meta.url), "utf8");
const engine = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");

assert.match(app, /event\.code === "F2"[\s\S]{0,500}engine\.captureScreenshot\(\)[\s\S]{0,160}copyGameScreenshot\(png\)/,
  "F2 starts capture and clipboard delivery without an intervening await");
assert.match(helper, /new ClipboardItem\(\{ "image\/png": png \}\)/,
  "the clipboard receives the next-frame PNG promise from the original key gesture");
assert.match(helper, /link\.download = filename[\s\S]{0,100}link\.click\(\)/,
  "every screenshot also has a reliable Downloads fallback");
assert.match(engine, /if \(pendingScreenshot\)[\s\S]{0,260}canvas\.toBlob/,
  "capture runs immediately after a complete retained WebGL render");
assert.ok(app.indexOf('event.code === "F2"') < app.indexOf("consumeSinglePlayerCommandSurfaceEscape("),
  "screenshot handling remains available before command and gameplay key routing");

console.log("pointer-lock-safe F2 screenshot workflow tests passed");
