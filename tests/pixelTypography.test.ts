import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const font = readFileSync(new URL("../client/pixelTypography.ts", import.meta.url), "utf8");
const hud = readFileSync(new URL("../client/components/HudStyles.tsx", import.meta.url), "utf8");
const lobby = readFileSync(new URL("../client/lobby/LobbyStyles.tsx", import.meta.url), "utf8");
const notices = readFileSync(new URL("../THIRD_PARTY_NOTICES.md", import.meta.url), "utf8");

assert.ok(font.includes('data:font/woff2;base64,') && font.includes('font-family:"Lakecraft Pixel"'),
  "the shared pixel face is a self-contained WOFF2 rather than a runtime request");
assert.equal(font.includes("fonts.gstatic.com"), false);
assert.ok(hud.includes('import { LAKECRAFT_PIXEL_FONT_CSS }') && lobby.includes('import { LAKECRAFT_PIXEL_FONT_CSS }'),
  "HUD and menu surfaces share one coherent embedded font definition");
assert.ok(notices.includes("No font file is fetched at runtime") && notices.includes("SIL Open Font License 1.1"),
  "embedded font provenance and license remain explicit");

console.log("embedded Lakecraft pixel typography tests passed");
