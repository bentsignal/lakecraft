import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const glyph = source("../client/components/ItemGlyph.tsx");
const firstPerson = source("../client/components/FirstPersonHeldItem.tsx");
const styles = source("../client/components/HudStyles.tsx");

assert.ok(glyph.includes('new Set<BlockId>(["torch", "door", "bed", "ladder"])'), "thin placeables preserve their authored item silhouettes");
assert.ok(glyph.includes('data-block={blockId}'), "the held voxel exposes selected material identity to its texture rules");
assert.equal((glyph.match(/lc-held-voxel__face--/g) ?? []).length, 3, "held voxel has exactly three bounded face nodes");
assert.ok(glyph.includes('blockId === "grass" ? BLOCKS.dirt.color'), "grass uses a green cap over earthy side faces");
assert.ok(firstPerson.includes("isHeldVoxelBlock(stack.itemId)"), "first-person selection chooses cube presentation by item semantics");
assert.ok(firstPerson.includes("<HeldBlockVoxel blockId={stack.itemId}"), "selected full block drives the voxel material");
assert.ok(firstPerson.includes("<HeldSpriteExtrusion stack={stack}"), "tools, food, materials, and thin placeables gain bounded depth around their pixel sprites");
assert.ok(firstPerson.includes("<ItemIcon compact"), "extruded items keep their original pixel artwork on every slice");
assert.ok(styles.includes("perspective: 420px") && styles.includes("transform-style: preserve-3d"), "cube uses a perspective-preserving 3D scene");
assert.ok(styles.includes("rotateY(-38deg)"), "cube orientation keeps the right face camera-visible under backface culling");
assert.ok(styles.includes("lc-held-voxel__face::after") && styles.includes("--lc-held-cube-size)*.57"), "generic block materials use bounded square pixel flecks instead of stripe-grid placeholders");
assert.ok(styles.includes('data-block="diamond_ore"'), "ore texture rules retain selected ore identity");
assert.ok(styles.includes('data-block="log"') && styles.includes("repeating-radial-gradient"), "logs receive bark sides and a ringed end face");
assert.ok(styles.includes('data-block="glass"') && styles.includes("color-mix"), "glass has a distinct translucent presentation");
assert.ok(styles.includes("height: clamp(150px,19vw,208px)"), "held cube remains large and responsive without unbounded viewport scaling");

console.log("first-person held voxel cube checks passed");
