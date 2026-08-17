import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  MINECRAFT_HOTBAR_PNG_BASE64,
  MINECRAFT_HOTBAR_SELECTION_PNG_BASE64,
} from "../client/components/generated/minecraftHotbarTextures.ts";
import { LAKE_BED_EDITION_TITLE_WEBP_BASE64 } from "../client/lobby/generated/lakeBedEditionTitle.ts";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const sha256 = (base64: string) => createHash("sha256").update(Buffer.from(base64, "base64")).digest("hex");
const lobby = source("../client/lobby/LobbyScreen.tsx");
const styles = source("../client/lobby/LobbyStyles.tsx");
const title = source("../client/lobby/TitleLogo.tsx");
const options = source("../client/components/OptionsDialog.tsx");
const hudStyles = source("../client/components/HudStyles.tsx");

assert.equal(sha256(LAKE_BED_EDITION_TITLE_WEBP_BASE64), "f3a68a4cce10f87240488fbe405f2796d3e75904f1f0ff1ba53d39283c36950b",
  "the reviewed transparent ImageGen logo derivative stays exact");
assert.match(title, /alt="Minecraft — Lake Bed Edition"/);
assert.match(title, /height="302"[\s\S]*width="1400"/);
assert.ok(lobby.includes("<TitleLogo />"), "the main home screen uses the generated title asset");
assert.match(styles, /\.lc-title-logo img\{[^}]*max-height:min\(25vh,244px\)[^}]*width:min\(820px,74vw\)/,
  "the approved logo is scaled down without regenerating or distorting the asset");
assert.ok(lobby.includes('<footer className="lc-title-footer"><span /><span>craft.lakebed.app</span></footer>'),
  "the production URL occupies the home screen's bottom-right footer");
assert.equal(lobby.slice(lobby.lastIndexOf('<main className="lc-title-screen">')).includes("LAKECRAFT</h1>"), false,
  "the old CSS letter approximation is gone from the home screen");
assert.match(styles, /\.lc-title-screen>\.lc-account-panel\{bottom:9px;left:9px;top:auto\}/,
  "home account/auth controls occupy the requested bottom-left corner");
assert.match(styles, /\.lc-menu-button:is\(button\)\{align-items:center;display:flex;justify-content:center\}/,
  "title and browser buttons center their labels by box geometry");
assert.match(options, /\.lc-options button\{align-items:center;cursor:pointer;display:flex;justify-content:center;padding:2px 16px 0\}/,
  "Options buttons share the corrected optical vertical centering");

assert.equal(sha256(MINECRAFT_HOTBAR_PNG_BASE64), "57aad603aafc75cea079d8db04b3029c1b1b5501eb0799971ccaf858876f52a7");
assert.equal(sha256(MINECRAFT_HOTBAR_SELECTION_PNG_BASE64), "8c1e1cd977cce0c3a2aaf04036af4904426dafd1a6f4db9665b0d8be1468e80a");
assert.match(hudStyles, /MINECRAFT_HOTBAR_PNG_BASE64/);
assert.match(hudStyles, /MINECRAFT_HOTBAR_SELECTION_PNG_BASE64/);
assert.match(hudStyles, /\.lc-hotbar \.lc-item-icon__svg\{height:min\(30px,calc\(100% - 8px\)\)/,
  "hotbar items retain breathing room inside the exact 40px slots");

console.log("generated title, relocated account, centered button, and exact hotbar texture checks passed");
