import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const asset = source("../client/components/generated/minecraftInventoryTexture.ts");
const generator = source("../scripts/generate-minecraft-inventory-texture.mjs");
const styles = source("../client/components/HudStyles.tsx");
const drawer = source("../client/components/InventoryDrawer.tsx");
const payload = asset.match(/= "([A-Za-z0-9+/=]+)"/)?.[1];

assert.ok(!styles.includes(".lc-item-icon__svg { display: block; filter:"),
  "slot items have no asymmetric CSS shadow shifting their visible pixels down and right");

assert.ok(payload, "the installed inventory chrome has one checked-in payload");
const png = Buffer.from(payload, "base64");
assert.equal(png.toString("hex", 0, 8), "89504e470d0a1a0a", "inventory chrome remains a PNG");
assert.equal(png.readUInt32BE(16), 256, "canonical inventory source width remains 256px");
assert.equal(png.readUInt32BE(20), 256, "canonical inventory source height remains 256px");
assert.equal(createHash("sha256").update(png).digest("hex"),
  "c2f850076ad7ebd7a1b27d017fe5f66ac388f54de374de988cb79f86b1d59a65",
  "the survival panel exactly matches Minecraft 26.2 inventory.png");
assert.ok(generator.includes("assets/minecraft/textures/gui/container/inventory.png")
  && generator.includes("Unexpected Minecraft 26.2 inventory texture hash"),
"regeneration is pinned to the exact installed source rather than an arbitrary PNG");
assert.match(styles, /background-image:url\("data:image\/png;base64,\$\{MINECRAFT_INVENTORY_PNG_BASE64\}"\)/,
  "survival inventory renders the exact installed panel, not reconstructed CSS chrome");
for (const token of ["height:498px", "width:528px", "grid-template-columns:repeat(9,54px)", "inset:252px auto auto 24px"]) {
  assert.ok(styles.includes(token), `three-times pixel geometry stays aligned: ${token}`);
}
assert.ok(styles.includes("grid-template-columns:54px 147px")
  && styles.includes("left:24px") && styles.includes("top:24px")
  && styles.includes("height:210px") && styles.includes("width:147px"),
"the player canvas stays inside the exact 49x70-pixel black viewport at 3x rather than painting over the chrome");
assert.match(styles, /transform:scale\(min\(var\(--lc-inventory-width-scale\),var\(--lc-inventory-height-scale\)\)\)/,
  "survival inventory scales against both viewport axes rather than clipping on short landscape screens");
for (const breakpoint of ["max-width:400px", "max-height:420px", "max-height:290px"]) {
  assert.ok(styles.includes(breakpoint), `responsive exact-inventory coverage includes ${breakpoint}`);
}
assert.match(styles, /lc-inventory-titlebar h2\{clip-path:inset\(50%\)/,
  "removing non-Minecraft title chrome preserves the dialog's accessible name");
assert.match(drawer, /<PlayerSkinPreview equipment=\{workspace\.equipment\} open=\{open\} pointer=\{\[pointer\.x, pointer\.y\]\} \/>/,
  "the canonical selected skin remains live and cursor-aware inside the exact panel");
const preview = source("../client/components/PlayerSkinPreview.tsx");
assert.ok(preview.includes('height={210}') && preview.includes('width={147}')
  && preview.includes("createPlayerSkinRenderer(gl,")
  && preview.includes("inventoryPreviewViewProjection(canvas.width / canvas.height)"),
"the official portrait viewport renders the shared third-person 3D skin without stretching it");
assert.ok(preview.includes('getExtension("WEBGL_lose_context")?.loseContext()'),
  "closing the inventory explicitly retires its short-lived WebGL context without evicting the world renderer");
assert.match(styles, /\.lc-armor-slot>\.lc-armor-slot__label/);
assert.match(styles, /\.lc-armor-slot \.lc-item-glyph \{ inset:0;min-height:46px;position:absolute; \}/,
  "armor labels cannot accidentally offset the centered item-glyph container");
assert.match(styles, />\.lc-inventory-upper::after\{background:#c6c6c6;content:"";height:60px;left:228px;[^}]*top:183px;/,
  "the unsupported offhand slot and its one-pixel texture border are cleanly masked at 3x");
assert.match(styles, /\.lc-crafting-panel\{left:291px;position:absolute;top:18px;width:225px\}/,
  "the Crafting label begins at source coordinate 97,6 in the three-times inventory texture");
assert.match(styles, /\.lc-crafting-panel h3\{font-size:15px;margin:0 0 21px\}/,
  "the field label leaves the exact vertical gap to the crafting matrix at source y=18");
assert.match(styles, /\.lc-crafting-workspace\{gap:18px;margin-left:3px\}/,
  "the crafting matrix begins at source x=98 while preserving 18px slot tracks");
assert.match(styles, /\.lc-crafting-result\{top:3px\}/,
  "the result target aligns to source y=28 instead of sitting one source pixel high");
assert.match(styles, /\.lc-crafting-arrow\{visibility:hidden;width:24px\}/,
  "the hidden DOM arrow leaves the exact source-coordinate gap to the result slot at x=154");
assert.match(styles, /\.lc-inventory-window\.is-crafting-table \.lc-crafting-workspace \{ justify-content: center; \}/,
  "narrow crafting-table controls remain centered without shifting the survival inventory controls off their textured slots");
assert.doesNotMatch(styles, /(?<!is-crafting-table )\.lc-crafting-workspace \{ justify-content: center; \}/,
  "narrow survival crafting hit targets remain pinned to the fixed inventory texture");
assert.match(styles, /\.lc-item-icon__svg\{height:42px;transform:translate\(-3px,-3px\);width:42px\}/,
  "inventory item cells preserve centered Minecraft-like padding inside the 48px slot interior");

console.log("Minecraft inventory chrome checks passed");
