import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { inventoryPreviewLook } from "../client/components/inventoryPreviewLook.ts";

const drawer = readFileSync(new URL("../client/components/InventoryDrawer.tsx", import.meta.url), "utf8");
const preview = readFileSync(new URL("../client/components/PlayerSkinPreview.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../client/components/HudStyles.tsx", import.meta.url), "utf8");

assert.ok(drawer.includes("<PlayerSkinPreview open={open} pointer={[pointer.x, pointer.y]} />"),
  "inventory sends live pointer coordinates to the canonical skin portrait");
assert.ok(preview.includes("loadPersistedPlayerSkin(window.localStorage)"), "portrait loads the user's selected skin");
assert.ok(preview.includes("createLakecraftDefaultSkinPixels()"), "installed standard skin is the no-selection fallback");
assert.ok(preview.includes("}, [open]);"), "skin changes made in the visual lab appear on the next inventory open");
assert.ok(preview.includes("context.transform(1, 0, look[0] * .08")
  && preview.includes("context.rotate(look[0] * .1)"),
"the body and head turn independently toward the cursor without resampling the skin");
assert.ok(preview.includes("context.imageSmoothingEnabled = false"), "skin pixels remain nearest-neighbor crisp");
assert.ok(preview.includes("const parts = ["), "portrait keeps its canonical modern-skin UV table flat and compact");
for (const uv of ["8,8,8,8,24,4", "20,20,8,12,24,36", "44,20,armWidth,12,leftArmX,36", "20,52,4,12,40,84"]) {
  assert.ok(preview.includes(uv), `portrait retains canonical modern-skin UV tuple: ${uv}`);
}
assert.ok(preview.includes("index += 6"));
assert.ok(preview.includes("sample(parts[index], parts[index + 1], parts[index + 2], parts[index + 3], parts[index + 4], parts[index + 5])"));
assert.deepEqual(inventoryPreviewLook([73.5, 105], [0, 0, 147, 210]), [0, 0]);
assert.deepEqual(inventoryPreviewLook([1000, -1000], [0, 0, 147, 210]), [1, -1],
  "cursor look is bounded at the viewport extremes");
assert.match(styles, /\.lc-player-preview \{[^}]*image-rendering:pixelated;[^}]*min-height:192px;/);
assert.equal(styles.includes(".lc-player-preview__head"), false, "obsolete hardcoded CSS Steve is removed");
assert.equal(drawer.includes("lc-armor-score"), false, "preview should not overlay debug-style armor text");

const compactMedia = styles.slice(styles.indexOf("@media (max-width: 560px)"));
assert.ok(compactMedia.includes(".lc-equipment-panel { display: none; }"), "compact inventory still hides the portrait");

console.log("inventory canonical skin preview checks passed");
