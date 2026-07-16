import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../client/components/FirstPersonBow.tsx", import.meta.url), "utf8");
const svg = source.slice(source.indexOf('<svg viewBox="0 0 80 80">'), source.indexOf("</svg>"));

assert.ok(source.includes("const nockX = 62 - stage * 8"), "charge stages pull the string away from the bow instead of relaxing it");
assert.ok(source.includes("const arrowTailX = nockX + 2"), "the arrow remains visibly nocked while the string draws");
assert.deepEqual([0, 1, 2].map((stage) => 62 - stage * 8), [62, 54, 46], "draw stages move monotonically away from the right-side limb");
assert.ok(svg.indexOf("lc-first-person-bow__wood-depth") < svg.indexOf('className="lc-first-person-bow__wood"'),
  "the dark rear limb is painted behind the authored bow face");
assert.ok(source.includes("lc-first-person-bow__wood-edge") && source.includes("M65 10L69 13"),
  "fixed connector facets join the front and rear voxel bow limbs");
assert.ok(source.includes('className="lc-first-person-bow__projectile-depth"') && source.includes('transform="translate(2 2)"'),
  "the nocked arrow has a bounded offset rear silhouette");
assert.equal((source.match(/d=\{arrowShaft\}/g) ?? []).length, 2, "arrow front and depth share one deterministic shaft pose");
assert.equal((source.match(/d=\{fletching\}/g) ?? []).length, 2, "fletching front and depth share one deterministic draw pose");
assert.ok(source.includes('[data-bow-charge-stage="2"]') && source.includes('data-bow-charge-stage={stage}'),
  "the full-charge highlight targets the attribute emitted by the component");
assert.equal(source.includes('[data-charge-stage="2"]'), false, "the stale non-emitted charge selector is removed");
assert.ok(source.includes("if (hidden) return null"), "blocking UI still removes all bow feedback DOM");

console.log("first-person dimensional bow visual checks passed");
