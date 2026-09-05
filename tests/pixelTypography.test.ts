import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const font = readFileSync(new URL("../client/pixelTypography.ts", import.meta.url), "utf8");
const generated = readFileSync(new URL("../client/components/generated/minecraftAsciiFont.ts", import.meta.url), "utf8");
const generator = readFileSync(new URL("../scripts/generate-minecraft-ascii-font.mjs", import.meta.url), "utf8");
const hud = readFileSync(new URL("../client/components/HudStyles.tsx", import.meta.url), "utf8");
const lobby = readFileSync(new URL("../client/lobby/LobbyStyles.tsx", import.meta.url), "utf8");
const notices = readFileSync(new URL("../THIRD_PARTY_NOTICES.md", import.meta.url), "utf8");

assert.ok(font.includes('data:font/ttf;base64,${MINECRAFT_ASCII_TTF_BASE64}') && font.includes('font-family:"Lakecraft Pixel"'),
  "the shared pixel face is a self-contained TrueType font rather than a runtime request");
assert.equal(font.includes("fonts.gstatic.com"), false);
assert.match(font, /MINECRAFT_ASCII_TTF_BASE64/);
assert.match(generated, /Generated from the user-owned Minecraft 26\.2 bitmap font atlases/);
assert.match(generator, /assets\/minecraft\/textures\/\$\{provider\.file/);
assert.ok(generator.includes('entry.endsWith("ascii.png")') && generator.includes('entry.endsWith("nonlatin_european.png")'),
  "the generator resolves both installed Minecraft bitmap providers");
const payload = generated.match(/= "([A-Za-z0-9+/=]+)"/)?.[1];
assert.ok(payload, "the generated font contains one inline payload");
const bytes = Buffer.from(payload, "base64");
assert.equal(bytes.readUInt32BE(0), 0x00010000, "the generated payload is a TrueType sfnt");
assert.ok(bytes.includes(Buffer.from("Minecraft ASCII", "utf16le").swap16()),
  "the font names its exact local-atlas provenance");
function tableOffset(tag: string): number {
  const count = bytes.readUInt16BE(4);
  for (let index = 0; index < count; index += 1) {
    const at = 12 + index * 16;
    if (bytes.toString("ascii", at, at + 4) === tag) return bytes.readUInt32BE(at + 8);
  }
  throw new Error(`Missing ${tag} table.`);
}
function cmapSupports(code: number): boolean {
  const cmap = tableOffset("cmap"), subtable = cmap + bytes.readUInt32BE(cmap + 8);
  assert.equal(bytes.readUInt16BE(subtable), 4, "the generated font uses a deterministic format-4 cmap");
  const segmentCount = bytes.readUInt16BE(subtable + 6) / 2;
  const ends = subtable + 14, starts = ends + segmentCount * 2 + 2;
  const deltas = starts + segmentCount * 2, ranges = deltas + segmentCount * 2;
  for (let index = 0; index < segmentCount; index += 1) {
    const end = bytes.readUInt16BE(ends + index * 2), start = bytes.readUInt16BE(starts + index * 2);
    if (code < start || code > end) continue;
    const range = bytes.readUInt16BE(ranges + index * 2);
    assert.equal(range, 0, "the generated direct-map cmap remains compact and deterministic");
    return ((code + bytes.readInt16BE(deltas + index * 2)) & 65535) !== 0;
  }
  return false;
}
for (const character of Array.from("°·×–—…→↑↓↔●")) {
  assert.equal(cmapSupports(character.codePointAt(0)!), true,
    `the shared face covers interface punctuation ${character} without a system-font fallback`);
}
const hhea = tableOffset("hhea");
const ascender = bytes.readInt16BE(hhea + 4), descender = bytes.readInt16BE(hhea + 6);
assert.deepEqual([ascender, descender], [896, -128], "font metrics preserve Minecraft's 7px ascent and 1px descender");
const loca = tableOffset("loca"), glyf = tableOffset("glyf"), maxp = tableOffset("maxp");
const glyphCount = bytes.readUInt16BE(maxp + 4);
for (let glyph = 1; glyph < glyphCount; glyph += 1) {
  const at = glyf + bytes.readUInt32BE(loca + glyph * 4);
  if (bytes.readInt16BE(at) === 0) continue;
  const yMin = bytes.readInt16BE(at + 4), yMax = bytes.readInt16BE(at + 8);
  assert.ok(yMin >= descender && yMax <= ascender,
    `glyph ${glyph} vertical bounds ${yMin}..${yMax} stay inside ${descender}..${ascender}`);
}
assert.ok(hud.includes('import { LAKECRAFT_PIXEL_FONT_CSS }') && lobby.includes('import { LAKECRAFT_PIXEL_FONT_CSS }'),
  "HUD and menu surfaces share one coherent embedded font definition");
assert.match(font, /--lc-pixel-font:[^}]+;--lc-input-vpad:4px}[^`]+padding-block:var\(--lc-input-vpad\)!important/,
  "native inputs use symmetric padding now that every glyph fits the font's declared vertical metrics");
assert.ok(lobby.includes(".lc-username-menu input{--lc-input-vpad:5px")
  && readFileSync(new URL("../client/components/InventoryDrawer.tsx", import.meta.url), "utf8").includes('style="--lc-input-vpad:9px"'),
"auth/dialog and Creative inputs retain their original total padding through the shared baseline contract");
assert.ok(notices.includes("interface font") && notices.includes("Minecraft Java Edition 26.2") && notices.includes("font-atlas pixel"),
  "embedded font provenance remains explicit");

console.log("embedded Lakecraft pixel typography tests passed");
