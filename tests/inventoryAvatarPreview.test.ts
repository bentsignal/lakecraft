import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const drawer = readFileSync(new URL("../client/components/InventoryDrawer.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../client/components/HudStyles.tsx", import.meta.url), "utf8");

const previewStart = drawer.indexOf('<div className="lc-player-preview"');
const previewEnd = drawer.indexOf("</div>", previewStart) + "</div>".length;
const previewMarkup = drawer.slice(previewStart, previewEnd);
const previewCssStart = styles.indexOf(".lc-player-preview {");
const previewCssEnd = styles.indexOf(".lc-inventory-window .lc-crafting-panel", previewCssStart);
const previewCss = styles.slice(previewCssStart, previewCssEnd);

assert.ok(previewStart >= 0 && previewEnd > previewStart, "inventory should retain its player preview");
assert.equal(
  previewMarkup.match(/<span className="lc-player-preview__/g)?.length,
  6,
  "preview should use exactly six lightweight body spans",
);
assert.equal(drawer.includes("lc-armor-score"), false, "preview should not overlay debug-style armor text");
assert.equal(drawer.includes("equippedArmorProtection"), false, "removed armor text should leave no unused import");

for (const token of [
  "perspective: 360px",
  "transform: rotateY(-18deg)",
  "transform-style: preserve-3d",
  ".lc-player-preview > span::after",
  "transform: rotateY(90deg)",
  ".lc-player-preview__head::before",
  "transform: rotateX(90deg)",
]) {
  assert.ok(previewCss.includes(token), `preview should include dimensional treatment: ${token}`);
}

assert.match(previewCss, /\.lc-player-preview__head \{[^}]*height: 40px;[^}]*width: 40px;/);
assert.match(previewCss, /\.lc-player-preview__body \{[^}]*height: 60px;[^}]*width: 40px;/);
assert.match(previewCss, /\.lc-player-preview__arm \{[^}]*height: 60px;[^}]*width: 20px;/);
assert.match(previewCss, /\.lc-player-preview__leg \{[^}]*height: 60px;[^}]*width: 20px;/);
assert.ok(previewCss.includes("#4b2d1c"), "head should include a blocky hair layer");
assert.ok(previewCss.includes("#45658a"), "head should include pixel eyes");

assert.equal(/animation|@keyframes|skin/i.test(previewCss), false, "preview should add no timer or skin pipeline");
assert.equal(/<canvas|<img/i.test(previewMarkup), false, "preview should remain CSS-only");

const compactMedia = styles.slice(styles.indexOf("@media (max-width: 560px)"));
assert.ok(
  compactMedia.includes(".lc-equipment-panel { display: none; }"),
  "compact view should continue hiding the preview instead of crowding the inventory",
);

console.log("inventory avatar preview checks passed");
