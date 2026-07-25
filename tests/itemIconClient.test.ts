import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const icon = source("../client/components/ItemGlyph.tsx");
const styles = source("../client/components/HudStyles.tsx");

assert.ok(icon.includes("getItemIconArt(stack.itemId)"), "shared item renderer uses canonical pixel art");
assert.ok(icon.includes('shape-rendering="crispEdges"'), "sprites request hard pixel edges");
assert.ok(icon.includes("art.runs.map"), "sprites render their deterministic pixel-run data");
assert.equal(icon.includes("item.glyph"), false, "legacy unicode glyphs are not rendered");
assert.equal(icon.includes("item.shortLabel"), false, "inventory sprites have no placeholder code labels");
assert.ok(icon.includes("<ItemIcon stack={{ itemId, count: 1 }} compact />"), "ingredient previews share the same icon renderer");
assert.ok(styles.includes("image-rendering: pixelated"), "CSS preserves nearest-neighbor pixel presentation");

console.log("shared pixel item icon client checks passed");
